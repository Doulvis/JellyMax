// Compile l'APK Android (release) avec Gradle et le copie dans release/JellyMax-<version>.apk.
// Prérequis : JDK 21 et SDK Android (variables JAVA_HOME et ANDROID_HOME, ou emplacements par défaut).
// Signature : voir android/app/build.gradle (fichier keystore.properties hors du dépôt).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const androidDir = path.join(root, 'android');
const win = process.platform === 'win32';

function fail(msg) {
  console.error(`\n[android] ${msg}\n`);
  process.exit(1);
}

function findJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  const dirs = win ? ['C:\\Program Files\\Microsoft', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java'] : [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    const jdk = fs.readdirSync(d).find((n) => /^jdk-?21/.test(n));
    if (jdk) return path.join(d, jdk);
  }
  fail('JDK 21 introuvable. Installez-le (par exemple "winget install Microsoft.OpenJDK.21") ou définissez JAVA_HOME.');
}

function findSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    win ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') : path.join(os.homedir(), 'Android', 'Sdk'),
  ].filter(Boolean);
  const sdk = candidates.find((d) => fs.existsSync(path.join(d, 'platforms')));
  if (!sdk) fail('SDK Android introuvable. Installez-le (Android Studio ou outils en ligne de commande) ou définissez ANDROID_HOME.');
  return sdk;
}

const env = { ...process.env, JAVA_HOME: findJavaHome(), ANDROID_HOME: findSdk() };
delete env.ELECTRON_RUN_AS_NODE;

const gradlew = path.join(androidDir, win ? 'gradlew.bat' : 'gradlew');
const r = spawnSync(win ? `"${gradlew}" assembleRelease --console=plain` : `"${gradlew}" assembleRelease --console=plain`, {
  cwd: androidDir,
  env,
  stdio: 'inherit',
  shell: true,
});
if (r.status !== 0) fail(`La compilation Gradle a échoué (code ${r.status}).`);

const outDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release');
const signed = path.join(outDir, 'app-release.apk');
const unsigned = path.join(outDir, 'app-release-unsigned.apk');
const apk = fs.existsSync(signed) ? signed : unsigned;
if (!fs.existsSync(apk)) fail('APK introuvable après la compilation.');

const releaseDir = path.join(root, 'release');
fs.mkdirSync(releaseDir, { recursive: true });
const name = `JellyMax-${pkg.version}${apk === unsigned ? '-unsigned' : ''}.apk`;
fs.copyFileSync(apk, path.join(releaseDir, name));
console.log(`\n[android] APK prêt : release/${name}`);
if (apk === unsigned) console.log('[android] Non signé : aucune clé trouvée (voir android/app/build.gradle).');
