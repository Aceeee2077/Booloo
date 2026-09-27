import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const binary = join(root, 'src-tauri', 'target', 'debug', 'prismoo.exe');
if (!existsSync(binary)) throw new Error(`Build the app first: ${binary}`);

const child = spawn(binary, [], { env: { ...process.env, PRISMOO_SELFCHECK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', errors = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { errors += chunk; });
const timeout = setTimeout(() => { child.kill(); console.error('Prismoo self-check timed out'); process.exitCode = 1; }, 45_000);

child.on('exit', code => {
  clearTimeout(timeout);
  const reports = output.split(/\r?\n/).filter(line => line.startsWith('[selfcheck] '))
    .map(line => JSON.parse(line.slice('[selfcheck] '.length)));
  for (const report of reports) console.log(report);
  const pet = reports.find(report => report.window === 'pet');
  const settings = reports.find(report => report.window === 'settings');
  const close = reports.find(report => report.window === 'settings_close');
  const petOk = pet?.hasApi && pet?.hasCanvas && pet?.drawnPixels > 0 &&
    pet?.hitTestCorner === false &&
    pet?.i18nReady === true &&
    (pet?.state?.skin !== 'custom' || pet?.state?.customReady === true);
  const settingsOk = settings?.hasApi && settings?.skinChoices === 6 &&
    settings?.importButton && settings?.confirmButton && settings?.hasExtraPanels === false &&
    settings?.hasLanguage === true &&
    ['zh', 'en'].includes(settings?.languageValue) &&
    ['退出', 'Quit'].includes(settings?.translatedQuit) &&
    close?.closed === true;
  if (!petOk || !settingsOk || code !== 0) {
    console.error(errors.trim());
    console.error('Lightweight app self-check failed');
    process.exitCode = 1;
  } else {
    console.log('Lightweight pet and settings windows passed');
  }
});
