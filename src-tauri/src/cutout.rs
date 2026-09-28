// ============================================================================
// Automatic cutout — the first pass of the "auto cutout + manual touch-up"
// flow: turn an opaque photo into an alpha plane the mask editor can refine.
//
// The Electron build shipped an ONNX U²-Net session; the lightweight rewrite
// dropped that runtime, and a 170 MB model next to a 6 MB installer is not a
// trade this build makes. Instead the subject is found with a border-seeded
// flood fill over the background colour. It is deliberately conservative — a
// doubtful result keeps the whole picture rather than eating the pet — and the
// mask editor is where the user fixes what is left.
//
// `segment()` is the single seam a model would replace: it returns an alpha
// plane, and everything downstream (feather, guard rails, PNG encoding, the
// brush editor, the save path) works off that plane.
// ============================================================================

/// Longest edge the editor works at. The pet never renders larger than its
/// 300 px window, so 1600 px keeps the cutout crisp while bounding the PNG
/// payload handed to the renderer and the per-stroke undo snapshots.
pub const WORK_MAX_EDGE: u32 = 1600;

/// Default colour distance that still counts as background (0-255 per channel).
pub const DEFAULT_TOLERANCE: u8 = 25;

/// Default edge feather radius in pixels.
pub const DEFAULT_FEATHER: u8 = 1;

/// Result of one automatic pass.
pub struct Cutout {
    /// Per-pixel keep factor: 0 = removed, 255 = kept.
    pub alpha: Vec<u8>,
    /// Kept pixels / total pixels, for the "subject covers N%" hint.
    pub subject_ratio: f32,
    /// The fill removed a usable amount of background.
    pub applied: bool,
    /// The guard fired: `alpha` is fully opaque, so the photo is kept as it is.
    pub rejected: bool,
}

/// Build the initial keep-mask for one image.
pub fn segment(rgba: &[u8], width: u32, height: u32, tolerance: u8, feather: u8) -> Cutout {
    let (w, h) = (width as usize, height as usize);
    let total = w * h;
    if total == 0 || rgba.len() < total * 4 {
        return Cutout {
            alpha: vec![255; total],
            subject_ratio: 1.0,
            applied: false,
            rejected: true,
        };
    }

    let opaque = (0..total).filter(|i| rgba[i * 4 + 3] > 24).count();
    // Art that is already cut out keeps its own alpha: a 100 % opaque mask leaves
    // the stored raster untouched and only the user's brush strokes change it.
    if opaque * 100 < total * 95 {
        return Cutout {
            alpha: vec![255; total],
            subject_ratio: opaque as f32 / total as f32,
            applied: false,
            rejected: false,
        };
    }

    let reference = border_colour(rgba, w, h);
    let tolerance = tolerance.clamp(4, 96) as i32;
    // Compare the squared distance against 3·tol², i.e. a per-channel RMS of tol.
    let limit = 3 * tolerance * tolerance;
    let backgroundish = |index: usize| -> bool {
        let offset = index * 4;
        if rgba[offset + 3] <= 24 {
            return true;
        }
        let dr = rgba[offset] as i32 - reference[0] as i32;
        let dg = rgba[offset + 1] as i32 - reference[1] as i32;
        let db = rgba[offset + 2] as i32 - reference[2] as i32;
        dr * dr + dg * dg + db * db <= limit
    };

    let mut marked = vec![false; total];
    let mut stack: Vec<u32> = Vec::new();
    let seed = |index: usize, marked: &mut Vec<bool>, stack: &mut Vec<u32>| {
        if !marked[index] && backgroundish(index) {
            marked[index] = true;
            stack.push(index as u32);
        }
    };

    for x in 0..w {
        seed(x, &mut marked, &mut stack);
        seed((h - 1) * w + x, &mut marked, &mut stack);
    }
    for y in 1..h.saturating_sub(1) {
        seed(y * w, &mut marked, &mut stack);
        seed(y * w + w - 1, &mut marked, &mut stack);
    }

    while let Some(index) = stack.pop() {
        let index = index as usize;
        let x = index % w;
        let y = index / w;
        if x > 0 {
            seed(index - 1, &mut marked, &mut stack);
        }
        if x + 1 < w {
            seed(index + 1, &mut marked, &mut stack);
        }
        if y > 0 {
            seed(index - w, &mut marked, &mut stack);
        }
        if y + 1 < h {
            seed(index + w, &mut marked, &mut stack);
        }
    }

    let removed = marked.iter().filter(|value| **value).count();
    let kept = total - removed;
    // Reject when the fill ate the subject (nothing is left) or when it removed so
    // little that the photo is almost certainly not a solid-background shot. A
    // rejected pass must never replace a visible photo with an empty canvas.
    if kept < 64.max(total / 200) || removed < total / 100 {
        return Cutout {
            alpha: vec![255; total],
            subject_ratio: kept as f32 / total as f32,
            applied: false,
            rejected: true,
        };
    }

    let mut alpha = vec![255u8; total];
    for (index, background) in marked.iter().enumerate() {
        if *background {
            alpha[index] = 0;
        }
    }
    let radius = (feather as usize).min(6);
    if radius > 0 {
        feather_alpha(&mut alpha, w, h, radius);
    }
    Cutout {
        alpha,
        subject_ratio: kept as f32 / total as f32,
        applied: true,
        rejected: false,
    }
}

/// Median colour of the 1 px border ring.
///
/// The mean of the four corners is what the previous renderer-side keying used
/// and it is fragile: one corner holding a watermark, a table edge or a shadow
/// pulls the reference away from the actual background and the fill then eats
/// half the pet.
fn border_colour(rgba: &[u8], w: usize, h: usize) -> [u8; 3] {
    let mut samples: [Vec<u8>; 3] = [Vec::new(), Vec::new(), Vec::new()];
    let take = |x: usize, y: usize, samples: &mut [Vec<u8>; 3]| {
        let offset = (y * w + x) * 4;
        if rgba[offset + 3] <= 24 {
            return;
        }
        for channel in 0..3 {
            samples[channel].push(rgba[offset + channel]);
        }
    };
    for x in 0..w {
        take(x, 0, &mut samples);
        take(x, h - 1, &mut samples);
    }
    for y in 1..h.saturating_sub(1) {
        take(0, y, &mut samples);
        take(w - 1, y, &mut samples);
    }
    let mut reference = [127u8; 3];
    for channel in 0..3 {
        if samples[channel].is_empty() {
            continue;
        }
        samples[channel].sort_unstable();
        reference[channel] = samples[channel][samples[channel].len() / 2];
    }
    reference
}

/// Separable box blur of the alpha plane — the "hardness / feather" control.
///
/// Edge samples shrink the window instead of clamping to it, so the border of the
/// picture does not get an artificial opaque frame.
fn feather_alpha(alpha: &mut [u8], w: usize, h: usize, radius: usize) {
    if radius == 0 || w == 0 || h == 0 {
        return;
    }
    let mut temp = vec![0u8; alpha.len()];
    let reach = radius.min(w.max(h));
    for y in 0..h {
        let row = y * w;
        let head = reach.min(w - 1);
        let mut sum: u32 = alpha[row..=row + head].iter().map(|v| *v as u32).sum();
        let mut count = (head + 1) as u32;
        for x in 0..w {
            if x > 0 {
                if x + reach < w {
                    sum += alpha[row + x + reach] as u32;
                    count += 1;
                }
                if x > reach {
                    sum -= alpha[row + x - reach - 1] as u32;
                    count -= 1;
                }
            }
            temp[row + x] = (sum / count.max(1)) as u8;
        }
    }
    for x in 0..w {
        let head = reach.min(h - 1);
        let mut sum: u32 = (0..=head).map(|y| temp[y * w + x] as u32).sum();
        let mut count = (head + 1) as u32;
        for y in 0..h {
            if y > 0 {
                if y + reach < h {
                    sum += temp[(y + reach) * w + x] as u32;
                    count += 1;
                }
                if y > reach {
                    sum -= temp[(y - reach - 1) * w + x] as u32;
                    count -= 1;
                }
            }
            alpha[y * w + x] = (sum / count.max(1)) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbaImage;

    /// A white canvas with a coloured square in the middle.
    fn photo(size: u32, background: [u8; 4], subject: [u8; 4], inset: u32) -> Vec<u8> {
        let mut image = RgbaImage::from_pixel(size, size, image::Rgba(background));
        for y in inset..size - inset {
            for x in inset..size - inset {
                image.put_pixel(x, y, image::Rgba(subject));
            }
        }
        image.into_raw()
    }

    #[test]
    fn removes_a_solid_background_and_keeps_the_subject() {
        let rgba = photo(100, [255, 255, 255, 255], [220, 90, 110, 255], 30);
        let cutout = segment(&rgba, 100, 100, DEFAULT_TOLERANCE, 0);
        assert!(cutout.applied);
        assert!(!cutout.rejected);
        assert_eq!(cutout.alpha[0], 0, "the border is background");
        assert_eq!(cutout.alpha[50 * 100 + 50], 255, "the middle is the subject");
        assert!((cutout.subject_ratio - 0.16).abs() < 0.01);
    }

    #[test]
    fn keeps_the_whole_photo_when_there_is_no_background_to_remove() {
        let rgba = photo(100, [255, 255, 255, 255], [250, 250, 250, 255], 30);
        let cutout = segment(&rgba, 100, 100, DEFAULT_TOLERANCE, 0);
        assert!(cutout.rejected);
        assert!(!cutout.applied);
        assert!(cutout.alpha.iter().all(|value| *value == 255));
    }

    #[test]
    fn already_cut_out_art_is_left_alone() {
        let mut rgba = photo(100, [0, 0, 0, 0], [40, 50, 60, 255], 20);
        // Make one subject pixel semi-transparent so the "has alpha" branch is hit.
        rgba[(30 * 100 + 30) * 4 + 3] = 128;
        let cutout = segment(&rgba, 100, 100, DEFAULT_TOLERANCE, 0);
        assert!(!cutout.applied);
        assert!(!cutout.rejected);
        assert!(cutout.alpha.iter().all(|value| *value == 255));
    }

    #[test]
    fn feathering_softens_the_edge() {
        let rgba = photo(100, [255, 255, 255, 255], [220, 90, 110, 255], 30);
        let hard = segment(&rgba, 100, 100, DEFAULT_TOLERANCE, 0);
        let soft = segment(&rgba, 100, 100, DEFAULT_TOLERANCE, 3);
        // One row above the subject: background in the hard mask, half-kept once
        // the edge is feathered.
        let edge = 29 * 100 + 50;
        assert_eq!(hard.alpha[edge], 0);
        assert!(soft.alpha[edge] > 0 && soft.alpha[edge] < 255, "edge = {}", soft.alpha[edge]);
        assert_eq!(soft.alpha[50 * 100 + 50], 255);
    }

    #[test]
    fn a_corner_watermark_does_not_move_the_reference() {
        let mut rgba = photo(100, [255, 255, 255, 255], [220, 90, 110, 255], 30);
        for y in 0..20 {
            for x in 0..20 {
                let offset = (y * 100 + x) * 4;
                rgba[offset..offset + 4].copy_from_slice(&[10, 10, 200, 255]);
            }
        }
        let cutout = segment(&rgba, 100, 100, DEFAULT_TOLERANCE, 0);
        assert!(cutout.applied);
        assert_eq!(cutout.alpha[50 * 100 + 50], 255, "the subject survives the watermark");
    }

    /// The picker accepts png/jpg/jpeg/webp/gif and the Rust pass decodes the file
    /// itself, so those codecs have to be compiled in — a missing feature would
    /// only show up as "unsupported format" in the editor at runtime.
    #[test]
    fn decodes_the_formats_the_picker_accepts() {
        use image::ImageEncoder;

        let webp = std::fs::read(format!(
            "{}/../src/assets/animated-pets/bulu-actions.webp",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap();
        assert_eq!(image::load_from_memory(&webp).unwrap().width(), 1024);

        // JPEG has no alpha channel, so the probe drives it through Rgb8.
        let pixels: Vec<u8> = [200u8, 100, 50].iter().cycle().take(8 * 8 * 3).copied().collect();
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .write_image(&pixels, 8, 8, image::ExtendedColorType::Rgb8)
            .unwrap();
        let decoded = image::load_from_memory(&jpeg).unwrap().to_rgba8();
        assert_eq!((decoded.width(), decoded.height()), (8, 8));
        assert!(decoded.get_pixel(0, 0).0[0] > 150, "a jpeg round trip keeps the subject colour");

        let png = encode_png_probe();
        assert_eq!(image::load_from_memory(&png).unwrap().width(), 2);
    }

    fn encode_png_probe() -> Vec<u8> {
        use image::ImageEncoder;
        let mut out = Vec::new();
        image::codecs::png::PngEncoder::new(&mut out)
            .write_image(&[1u8, 2, 3, 255, 4, 5, 6, 255], 2, 1, image::ExtendedColorType::Rgba8)
            .unwrap();
        out
    }
}
