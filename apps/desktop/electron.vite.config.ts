import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { PluginOption } from 'vite';

/** Pacotes do monorepo: exportam TypeScript, então entram no bundle em vez de ficar externos. */
const WORKSPACE_PACKAGES = ['@finance/client', '@finance/core', '@finance/sqlite-better', '@finance/tokens'];

/**
 * CSP do app empacotado (desktop-shell-design §3.6): só o próprio app, nada remoto. Estilo
 * inline é permitido porque Radix, Recharts e o Sonner posicionam e animam por estilo
 * injetado; script inline continua proibido, que é o que importa contra injeção.
 */
export const PRODUCTION_CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
].join('; ');

/**
 * Em desenvolvimento o Vite precisa de script inline (preâmbulo do React Refresh) e do
 * WebSocket do HMR; a exceção existe só no servidor de desenvolvimento, nunca no build.
 */
const DEVELOPMENT_CSP = PRODUCTION_CSP
    .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    .replace("connect-src 'self'", "connect-src 'self' ws://localhost:*");

/**
 * Injeta a CSP como `<meta>` no `index.html`. É meta, e não cabeçalho HTTP, porque o app
 * empacotado é servido de `file://`, que não tem cabeçalhos.
 *
 * @return O plugin do Vite.
 */
function contentSecurityPolicy(): PluginOption {
    let policy = PRODUCTION_CSP;
    return {
        name: 'finance:csp',
        configResolved(config) {
            policy = config.command === 'serve' ? DEVELOPMENT_CSP : PRODUCTION_CSP;
        },
        transformIndexHtml() {
            return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
        },
    };
}

export default defineConfig({
    main: {
        build: {
            externalizeDeps: { exclude: WORKSPACE_PACKAGES },
            rollupOptions: {
                // Módulo nativo: carrega o `.node` do disco e não pode entrar no bundle.
                external: ['better-sqlite3'],
                input: {
                    index: resolve(import.meta.dirname, 'src/main/index.ts'),
                    utility: resolve(import.meta.dirname, 'src/utility/index.ts'),
                },
            },
        },
    },
    preload: {
        build: {
            // O preload em sandbox só pode exigir `electron`: todo o resto vai no bundle, em
            // CommonJS, o único formato que o preload em sandbox aceita.
            externalizeDeps: false,
            rollupOptions: {
                external: ['electron'],
                input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
                output: { format: 'cjs', entryFileNames: '[name].cjs' },
            },
        },
    },
    renderer: {
        root: resolve(import.meta.dirname, 'src/renderer'),
        plugins: [react(), tailwindcss(), contentSecurityPolicy()],
        resolve: {
            alias: { '@': resolve(import.meta.dirname, 'src/renderer/src') },
        },
        build: {
            rollupOptions: {
                input: resolve(import.meta.dirname, 'src/renderer/index.html'),
            },
        },
    },
});
