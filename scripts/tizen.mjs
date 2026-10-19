// Empaquetage et installation de la version TV Samsung avec la ligne de commande de Tizen Studio.
//   node scripts/tizen.mjs package            -> release/JellyMax-<version>.wgt (signé avec le profil actif)
//   node scripts/tizen.mjs install <IP de la TV>
// Variables facultatives : TIZEN_STUDIO (dossier d'installation), TIZEN_PROFILE (profil de certificat).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const buildDir = path.join(root, 'dist-tizen');
const releaseDir = path.join(root, 'release');
const wgtName = `JellyMax-${pkg.version}.wgt`;

function fail(msg) {
  console.error(`\n[tizen] ${msg}\n`);
  process.exit(1);
}

function studioDir() {
  const candidates = [process.env.TIZEN_STUDIO, path.join(os.homedir(), 'tizen-studio'), 'C:\\tizen-studio'].filter(Boolean);
  const found = candidates.find((d) => fs.existsSync(path.join(d, 'tools', 'ide', 'bin')));
  if (!found) {
    fail(
      'Tizen Studio est introuvable. Installez-le (https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html) ' +
        'ou indiquez son dossier dans la variable TIZEN_STUDIO.',
    );
  }
  return found;
}

function run(cmd, args) {
  console.log(`> ${path.basename(cmd)} ${args.join(' ')}`);
  const r = spawnSync(`"${cmd}"`, args.map((a) => (/\s/.test(a) ? `"${a}"` : a)), { stdio: 'inherit', shell: true });
  if (r.status !== 0) fail(`La commande a échoué (code ${r.status}).`);
}

const studio = studioDir();
const tizen = path.join(studio, 'tools', 'ide', 'bin', process.platform === 'win32' ? 'tizen.bat' : 'tizen');
const sdb = path.join(studio, 'tools', process.platform === 'win32' ? 'sdb.exe' : 'sdb');
const [command, target] = process.argv.slice(2);

if (command === 'package') {
  if (!fs.existsSync(path.join(buildDir, 'config.xml'))) fail('dist-tizen/ est vide : lancez d\'abord "npm run build:tizen".');
  fs.mkdirSync(releaseDir, { recursive: true });
  const args = ['package', '-t', 'wgt'];
  if (process.env.TIZEN_PROFILE) args.push('-s', process.env.TIZEN_PROFILE);
  args.push('-o', releaseDir, '--', buildDir);
  run(tizen, args);
  // Tizen nomme le paquet d'après l'application ("JellyMax.wgt") : on y ajoute la version.
  const produced = path.join(releaseDir, 'JellyMax.wgt');
  if (fs.existsSync(produced)) fs.renameSync(produced, path.join(releaseDir, wgtName));
  console.log(`\n[tizen] Paquet prêt : release/${wgtName}`);
} else if (command === 'install') {
  if (!target) fail('Indiquez l\'adresse IP de la TV : npm run tizen:install -- 192.168.1.50');
  if (!fs.existsSync(path.join(releaseDir, wgtName))) fail(`release/${wgtName} introuvable : lancez d'abord "npm run tizen:package".`);
  const device = target.indexOf(':') >= 0 ? target : `${target}:26101`;
  run(sdb, ['connect', device]);
  run(tizen, ['install', '-n', wgtName, '-s', device, '--', releaseDir]);
  console.log('\n[tizen] JellyMax est installé sur la TV.');
} else {
  fail('Commande inconnue. Utilisez "package" ou "install <IP>".');
}
