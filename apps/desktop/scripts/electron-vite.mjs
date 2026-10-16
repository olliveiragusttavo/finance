import { spawn } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

/*
 * Roda o electron-vite com o ambiente que o Electron precisa, para `pnpm dev:desktop` e
 * `preview` funcionarem de qualquer terminal:
 *
 * - remove `ELECTRON_RUN_AS_NODE`, que o terminal integrado do VS Code exporta (ele próprio
 *   é um Electron) e faria o app subir como Node puro, sem janela;
 * - com `FINANCE_ELECTRON_NO_SANDBOX=1`, desliga o sandbox de processo do Chromium. Só o
 *   devcontainer e o CI definem a variável: o seccomp do Docker e o AppArmor do runner
 *   bloqueiam os namespaces de usuário que o sandbox exige. O `sandbox: true` da janela
 *   continua valendo — o renderer segue sem Node e o preload, restrito.
 */
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const args = process.argv.slice(2);
if (env.FINANCE_ELECTRON_NO_SANDBOX === '1') {
    args.push('--noSandbox');
}
// Pelo caminho, e não pelo PATH, para funcionar também chamado direto com `node`.
const bin = join(import.meta.dirname, '../node_modules/.bin/electron-vite');
const child = spawn(bin, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
child.on('exit', (code) => {
    process.exit(code ?? 1);
});
