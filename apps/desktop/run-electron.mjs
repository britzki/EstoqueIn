// Abre o app em modo de desenvolvimento.
// Alguns terminais (ex.: extensões de editores feitos em Electron) definem ELECTRON_RUN_AS_NODE,
// o que faria o Electron rodar como Node puro; a variável é removida só para este processo.
import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], { cwd: import.meta.dirname, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
