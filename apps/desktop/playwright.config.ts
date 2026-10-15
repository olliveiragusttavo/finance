import { defineConfig } from '@playwright/test';

/**
 * Testes de ponta a ponta do app empacotado pelo `electron-vite build`: um Electron de
 * verdade por teste, com pasta de dados própria. Em série porque cada um abre uma janela e
 * um processo do núcleo, e o paralelismo só disputaria GPU e disco no CI.
 */
export default defineConfig({
    testDir: 'e2e',
    workers: 1,
    timeout: 60_000,
    reporter: [['list']],
    /*
     * A medição de memória e tempo de abertura fica num projeto à parte porque o número depende
     * da máquina e não pode reprovar o `pnpm check`; separar por projeto deixa o `test` pegar
     * todo spec novo sem precisar listá-lo no package.json.
     */
    projects: [
        { name: 'e2e', testIgnore: 'measure.spec.ts' },
        { name: 'measure', testMatch: 'measure.spec.ts' },
    ],
});
