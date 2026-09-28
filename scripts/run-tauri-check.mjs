import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const binary = join(root, 'src-tauri', 'target', 'debug', 'prismoo.exe');
const appVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (!existsSync(binary)) throw new Error(`Build the app first: ${binary}`);

// Force a non-1 device scale factor: the pet canvas is 300*dpr backing pixels
// while the hit test is fed CSS coordinates, and getting that wrong silently
// disables dragging and the right-click menu on every scaled display (it is the
// bug that shipped once). At 100% the two coordinate spaces are identical, so a
// self-check that only runs at 100% cannot see it.
const child = spawn(binary, [], {
  env: {
    ...process.env,
    PRISMOO_SELFCHECK: '1',
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? '--force-device-scale-factor=1.5',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '', errors = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { errors += chunk; });
const timeout = setTimeout(() => { child.kill(); console.error('Prismoo self-check timed out'); process.exitCode = 1; }, 60_000);

child.on('exit', code => {
  clearTimeout(timeout);
  const reports = output.split(/\r?\n/).filter(line => line.startsWith('[selfcheck] '))
    .map(line => JSON.parse(line.slice('[selfcheck] '.length)));
  for (const report of reports) console.log(report);
  const pet = reports.find(report => report.window === 'pet');
  const settings = reports.find(report => report.window === 'settings');
  const close = reports.find(report => report.window === 'settings_close');
  const mask = reports.find(report => report.window === 'mask');
  const petOk = pet?.hasApi && pet?.hasCanvas && pet?.drawnPixels > 0 &&
    pet?.hitTestCorner === false &&
    // Click-through is only released where the pet's pixels are: if this is false
    // the user cannot drag the pet or open its right-click menu.
    Array.isArray(pet?.hitTestPet) && pet.hitTestPet.some(hit => hit === true) &&
    pet?.i18nReady === true &&
    (pet?.state?.skin !== 'custom' || pet?.state?.customReady === true);
  // Two choices now: Bulu and "my image".
  const settingsOk = settings?.hasApi && settings?.skinChoices === 2 &&
    settings?.importButton && settings?.confirmButton && settings?.hasExtraPanels === false &&
    settings?.hasLanguage === true &&
    ['zh', 'en'].includes(settings?.languageValue) &&
    ['退出', 'Quit'].includes(settings?.translatedQuit) &&
    // The updater has to answer with the version this build was compiled as, and
    // the panel has to have painted it.
    settings?.hasUpdatePanel === true && settings?.updateVersion === appVersion &&
    settings?.updateStatus === 'idle' && settings?.updatePanelVersion === `v${appVersion}` &&
    close?.closed === true;
  // The mask editor is the third window: it proves the new capability entry works
  // and that the cutout command answers the renderer.
  const maskOk = mask?.hasApi === true && mask?.hasCanvas === true && mask?.hasStage === true &&
    mask?.hasTools === true && Array.isArray(mask?.tools) && mask.tools.length === 6 &&
    ['抠图微调', 'Refine cutout'].includes(mask?.translatedTitle) && mask?.preview !== undefined;
  if (!petOk || !settingsOk || !maskOk || code !== 0) {
    console.error(errors.trim());
    console.error('Lightweight app self-check failed');
    process.exitCode = 1;
  } else {
    console.log('Lightweight pet and settings windows passed');
  }
});
