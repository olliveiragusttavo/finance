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
});
