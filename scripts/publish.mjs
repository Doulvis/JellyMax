// Publie JellyMax sur le serveur de mises à jour : construit les versions Windows, Android et TV,
// puis les envoie par SSH dans <path>/windows, <path>/android et <path>/tizen.
// Les appareils récupèrent la nouvelle version à leur prochain lancement (voir scripts/vite-remote.mjs).
//
// Configuration : `publish` dans ~/.jellymax/server.json ({ "host": "user@192.168.1.x", "path": "/var/www/jellymax" }),
// ou variables JELLYMAX_PUBLISH_HOST / JELLYMAX_PUBLISH_PATH. Clé SSH facultative : `key` ou JELLYMAX_PUBLISH_KEY.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { jellymaxConfig, serverConfig } from './vite-remote.mjs';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const cfg = serverConfig().publish || {};
const host = process.env.JELLYMAX_PUBLISH_HOST || cfg.host;
const remotePath = (process.env.JELLYMAX_PUBLISH_PATH || cfg.path || '').replace(/\/+$/, '');
const key = process.env.JELLYMAX_PUBLISH_KEY || cfg.key;
const sshArgs = key ? ['-i', key.replace(/^~/, process.env.USERPROFILE || process.env.HOME || '~')] : [];

const CHANNELS = [
  { name: 'windows', dir: 'dist', build: 'vite build' },
  { name: 'android', dir: 'dist-android', build: 'vite build --mode android' },
  { name: 'tizen', dir: 'dist-tizen', build: 'vite build --mode tizen' },
];

function fail(msg) {
  console.error(`\n[publish] ${msg}\n`);
  process.exit(1);
}

function run(cmd) {
  const r = spawnSync(cmd, { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) fail(`« ${cmd} » a échoué (code ${r.status}).`);
}

/** Envoie des fichiers du dossier `dir` vers `dest` sur le serveur (tar à travers SSH). */
function upload(dir, files, dest) {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-C', dir, '-cf', '-', ...files], { stdio: ['ignore', 'pipe', 'inherit'] });
    const ssh = spawn('ssh', [...sshArgs, host, `mkdir -p '${dest}' && tar -C '${dest}' -xf -`], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    tar.stdout.pipe(ssh.stdin);
    tar.on('error', reject);
    ssh.on('error', reject);
    ssh.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ssh a échoué (code ${code})`))));
  });
}

if (!host || !remotePath) fail('Serveur non configuré : renseignez "publish" (host, path) dans ~/.jellymax/server.json.');
if (!jellymaxConfig().remoteUrl) fail('"remoteUrl" absent de ~/.jellymax/server.json : les appareils ne sauraient pas où charger la mise à jour.');

run('tsc --noEmit');
for (const c of CHANNELS) run(`npx ${c.build}`);

for (const c of CHANNELS) {
  const dir = path.join(root, c.dir);
  const manifest = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifest)) fail(`${c.dir}/manifest.json introuvable.`);
  const dest = `${remotePath}/${c.name}`;
  // Les fichiers de assets/ ont un nom unique par version : les anciens restent en place pour les appareils
  // déjà lancés, et le manifeste est envoyé en dernier pour que personne ne charge une version incomplète.
  const others = fs.readdirSync(dir).filter((f) => f !== 'manifest.json' && f !== 'config.xml' && f !== 'icon.png');
  try {
    await upload(dir, others, dest);
    await upload(dir, ['manifest.json'], dest);
  } catch (e) {
    fail(`Envoi de ${c.name} impossible : ${e.message}`);
  }
  console.log(`[publish] ${c.name} ${pkg.version} → ${host}:${dest}`);
}
console.log(`\n[publish] JellyMax ${pkg.version} publié. Les appareils le chargeront au prochain lancement.\n`);
