// Runs a command with a hard time limit and kills its whole process tree (including any Electron
// windows it opened) when time runs out, so a stuck app test never needs a manual quit.
// Usage: node scripts/with-timeout.mjs <seconds> <command> [args...]   (exit code 124 on timeout)
import { spawn } from 'node:child_process';

const [seconds, command, ...args] = process.argv.slice(2);
if (!Number(seconds) || !command) {
  console.error('Usage: node scripts/with-timeout.mjs <seconds> <command> [args...]');
  process.exit(2);
}

// detached: true puts the child in its own process group so one signal reaches all descendants.
const child = spawn(command, args, { stdio: 'inherit', detached: true });
let timedOut = false;

// Kills the child's whole process group (SIGTERM first, SIGKILL if it ignores that).
const killTree = (signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
};

const timer = setTimeout(
  () => {
    timedOut = true;
    console.error(
      `\n[with-timeout] ${seconds}s limit reached: killing "${command}" and its children.`,
    );
    killTree('SIGTERM');
    setTimeout(() => killTree('SIGKILL'), 3000);
  },
  Number(seconds) * 1000,
);

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => killTree(signal));
child.on('exit', (code) => {
  clearTimeout(timer);
  killTree('SIGKILL'); // sweep up anything the command left behind
  process.exit(timedOut ? 124 : (code ?? 1));
});
