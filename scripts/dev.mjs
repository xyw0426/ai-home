// 同时启动本地模型代理服务和 Vite 开发服务器
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const nodeArgs = existsSync('.env') ? ['--env-file=.env', 'server/index.mjs'] : ['server/index.mjs'];
const procs = [
  spawn(process.execPath, nodeArgs, { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env: process.env }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && code !== 0 && stop());
