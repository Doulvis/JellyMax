// Lance Vite en mode développement puis Electron pointé dessus (rechargement à chaud).
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[dev] Vite prêt sur ${url}`);

// ELECTRON_RUN_AS_NODE (défini par certains outils comme VS Code) empêcherait Electron de démarrer en mode application.
const env = { ...process.env, VITE_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.'], { stdio: 'inherit', env });

child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
