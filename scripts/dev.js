import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npm, ['--prefix', 'server', 'run', 'dev'], { stdio: 'inherit' }),
  spawn(npm, ['--prefix', 'web', 'run', 'dev'], { stdio: 'inherit' })
];

function stop(signal = 'SIGTERM') {
  for (const child of children) if (!child.killed) child.kill(signal);
}

process.on('SIGINT', () => { stop('SIGINT'); process.exit(0); });
process.on('SIGTERM', () => { stop('SIGTERM'); process.exit(0); });
for (const child of children) child.on('exit', code => {
  if (code && code !== 0) {
    stop();
    process.exit(code);
  }
});
