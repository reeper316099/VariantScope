// Dev runner: starts the Vite dev server, then launches Electron pointed at it.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VARIANTSCOPE_DEV_URL: url },
});

// Shuts the dev server down when the Electron window closes.
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
