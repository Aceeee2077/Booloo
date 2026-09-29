// ============================================================================
// Coarse machine state for the pet's "load awareness" reactions.
//
// Three numbers are enough for what the pet does with them: how busy the CPU is,
// how much memory is in use, and whether the machine is on battery. Nothing here
// is uploaded anywhere or written to disk — the renderer polls `system_load`
// every few seconds and turns the answer into a sweat drop or a nap.
//
// No crate is pulled in for this. `sysinfo` and friends would add a dependency
// (and a network fetch at build time) for three calls that the platform already
// exports, so Windows talks to kernel32 directly and macOS reads its load
// average. The Unix other than macOS has no portable answer here and reports
// "unavailable" instead of making one up.
// ============================================================================

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::State;

/// The previous CPU sample. Windows reports cumulative tick counters, so load is
/// the delta between two calls rather than a value that can be read once.
#[derive(Default)]
pub struct LoadState(Mutex<Option<CpuSample>>);

#[derive(Clone, Copy, PartialEq, Debug)]
struct CpuSample {
    /// Idle ticks since boot.
    idle: u64,
    /// Kernel + user ticks since boot. On Windows the kernel counter *includes*
    /// the idle counter, which is why busy time is `total - idle`.
    total: u64,
}

/// Busy share 0..100 between two samples, or None when nothing moved.
#[cfg(any(target_os = "windows", test))]
fn cpu_percent(previous: CpuSample, current: CpuSample) -> Option<f64> {
    let idle = current.idle.saturating_sub(previous.idle);
    let total = current.total.saturating_sub(previous.total);
    // A zero total means the two calls landed inside the same timer tick; the
    // caller reports null and asks again rather than showing a bogus 0%.
    if total == 0 {
        return None;
    }
    let busy = total.saturating_sub(idle);
    Some((busy as f64 / total as f64 * 100.0).clamp(0.0, 100.0))
}

/// One reading. `None` fields mean "this platform does not report it".
#[derive(Default, Clone, Copy)]
struct Reading {
    cpu: Option<f64>,
    memory: Option<f64>,
    battery_percent: Option<f64>,
    charging: bool,
    /// False on a platform that could not answer at all.
    available: bool,
}

impl Reading {
    fn to_json(&self) -> Value {
        let round = |value: Option<f64>| value.map(|v| (v * 10.0).round() / 10.0);
        json!({
            "available": self.available,
            "cpu": round(self.cpu),
            "memory": round(self.memory),
            "batteryPercent": round(self.battery_percent),
            "charging": self.charging,
        })
    }
}

// ---------- Windows ----------

#[cfg(target_os = "windows")]
mod platform {
    use super::{cpu_percent, CpuSample, Reading};

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    impl FileTime {
        fn ticks(self) -> u64 {
            ((self.high as u64) << 32) | self.low as u64
        }
    }

    /// `MEMORYSTATUSEX`. `dwLength` has to be the struct's own size (64).
    #[repr(C)]
    #[derive(Default)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }

    /// `SYSTEM_POWER_STATUS`. Four bytes then two `u32`s — 12 bytes, align 4.
    #[repr(C)]
    #[derive(Default)]
    struct SystemPowerStatus {
        ac_line_status: u8,
        battery_flag: u8,
        battery_life_percent: u8,
        system_status_flag: u8,
        battery_life_time: u32,
        battery_full_life_time: u32,
    }

    const BATTERY_FLAG_NO_SYSTEM_BATTERY: u8 = 128;
    const UNKNOWN: u8 = 255;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemTimes(idle: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
        fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
        fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
    }

    pub fn cpu_sample() -> Option<CpuSample> {
        let (mut idle, mut kernel, mut user) = (FileTime::default(), FileTime::default(), FileTime::default());
        // SAFETY: three distinct, correctly sized output structs.
        let ok = unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) };
        (ok != 0).then(|| CpuSample { idle: idle.ticks(), total: kernel.ticks() + user.ticks() })
    }

    fn memory_percent() -> Option<f64> {
        let mut status = MemoryStatusEx::default();
        status.length = std::mem::size_of::<MemoryStatusEx>() as u32;
        // SAFETY: `length` is set to the struct size as the API requires.
        let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
        (ok != 0).then(|| status.memory_load as f64)
    }

    fn battery() -> (Option<f64>, bool) {
        let mut status = SystemPowerStatus::default();
        // SAFETY: `status` is the documented 12-byte layout.
        if unsafe { GetSystemPowerStatus(&mut status) } == 0 {
            return (None, false);
        }
        let charging = status.ac_line_status == 1;
        if status.battery_flag & BATTERY_FLAG_NO_SYSTEM_BATTERY != 0 ||
            status.battery_life_percent == UNKNOWN {
            return (None, charging);
        }
        (Some(status.battery_life_percent as f64), charging)
    }

    pub fn read(previous: Option<CpuSample>) -> (Reading, Option<CpuSample>) {
        let sample = cpu_sample();
        let cpu = match (previous, sample) {
            (Some(previous), Some(current)) => cpu_percent(previous, current),
            _ => None,
        };
        let (battery_percent, charging) = battery();
        let memory = memory_percent();
        (
            Reading {
                cpu,
                memory,
                battery_percent,
                charging,
                available: sample.is_some() || memory.is_some() || battery_percent.is_some(),
            },
            sample,
        )
    }
}

// ---------- macOS ----------

#[cfg(target_os = "macos")]
mod platform {
    use super::{CpuSample, Reading};

    extern "C" {
        /// From libSystem; `nelem` is how many averages to fill (1/5/15 min).
        fn getloadavg(loadavg: *mut f64, nelem: i32) -> i32;
    }

    /// macOS has no per-call CPU counter, but the 1-minute load average divided
    /// by the core count is the same "is this machine busy" signal the pet uses.
    /// Memory and battery stay unknown rather than being guessed at.
    pub fn read(_previous: Option<CpuSample>) -> (Reading, Option<CpuSample>) {
        let mut averages = [0.0f64; 3];
        // SAFETY: `averages` holds the three f64 the API writes.
        let ok = unsafe { getloadavg(averages.as_mut_ptr(), 3) };
        if ok < 0 {
            return (Reading::default(), None);
        }
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f64;
        // The load average is already a rate, so nothing is carried between
        // calls and the shared CpuSample stays unused here.
        (Reading {
            cpu: Some((averages[0] / cores * 100.0).clamp(0.0, 100.0)),
            memory: None,
            battery_percent: None,
            charging: false,
            available: true,
        }, None)
    }
}

// ---------- everyone else ----------

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
    use super::{CpuSample, Reading};

    /// Linux and the BSDs would each need their own `/proc` or `sysctl` reader;
    /// until one is written the pet simply stays quiet there.
    pub fn read(_previous: Option<CpuSample>) -> (Reading, Option<CpuSample>) {
        (Reading::default(), None)
    }
}

#[tauri::command]
pub fn system_load(state: State<'_, LoadState>) -> Value {
    let mut previous = state.0.lock().unwrap();
    let (reading, sample) = platform::read(*previous);
    *previous = sample;
    reading.to_json()
}

#[cfg(test)]
mod tests {
    use super::{cpu_percent, CpuSample};

    #[test]
    fn busy_share_comes_from_the_tick_delta() {
        // `total` is kernel + user and already contains the idle ticks, so 1000
        // more ticks of which 250 were idle means 750 busy.
        let before = CpuSample { idle: 1_000, total: 4_000 };
        let after = CpuSample { idle: 1_250, total: 5_000 };
        assert_eq!(cpu_percent(before, after), Some(75.0));
    }

    #[test]
    fn an_idle_machine_reads_zero_busy() {
        let before = CpuSample { idle: 100, total: 200 };
        let after = CpuSample { idle: 200, total: 300 };
        assert_eq!(cpu_percent(before, after), Some(0.0));
    }

    #[test]
    fn a_sample_inside_one_tick_reports_nothing() {
        let sample = CpuSample { idle: 500, total: 900 };
        assert_eq!(cpu_percent(sample, sample), None);
    }

    #[test]
    fn a_counter_that_reset_is_ignored_instead_of_spiking() {
        let before = CpuSample { idle: 9_000, total: 12_000 };
        let after = CpuSample { idle: 10, total: 20 };
        // Saturating subtraction turns a vanished counter into "no measurement",
        // which the renderer treats as "nothing to react to" rather than 100%.
        assert_eq!(cpu_percent(before, after), None);
    }
}
