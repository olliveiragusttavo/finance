import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

/** O app aberto pelo teste. */
export interface LaunchedApp {
    readonly app: ElectronApplication;
    readonly window: Page;
    /** Pasta de dados do teste, no lugar da `userData` real do usuário. */
    readonly userData: string;
}

/** @return Uma pasta de dados vazia para um teste. */
export function freshUserData(): string {
    return mkdtempSync(join(tmpdir(), 'finance-e2e-'));
}

/**
 * Abre o app empacotado (`out/main/index.js`) numa pasta de dados isolada, para que o teste
 * nunca toque no banco real.
 *
 * O ambiente segue o `scripts/electron-vite.mjs`: sem `ELECTRON_RUN_AS_NODE` (exportado pelo
 * terminal do VS Code) e, com `FINANCE_ELECTRON_NO_SANDBOX=1` (devcontainer e CI), sem o
 * sandbox de processo do Chromium, que precisa de namespaces de usuário que o container
 * bloqueia. O `sandbox: true` da janela continua valendo.
 *
 * @param userData Pasta de dados; reaproveitada para testar a reabertura.
 * @return O app e a primeira janela.
 */
export async function launchApp(userData: string = freshUserData()): Promise<LaunchedApp> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') {
            env[key] = value;
        }
    }
    env['FINANCE_USER_DATA'] = userData;
    const sandboxArgs = process.env['FINANCE_ELECTRON_NO_SANDBOX'] === '1' ? ['--no-sandbox'] : [];
    let app: ElectronApplication;
    try {
        app = await electron.launch({ args: [...sandboxArgs, join(import.meta.dirname, '../out/main/index.js')], env });
    } catch (error) {
        if (sandboxArgs.length === 0) {
            throw new Error('O Electron não abriu. Dentro de um container ou no CI, o sandbox do Chromium não tem namespaces de usuário: defina FINANCE_ELECTRON_NO_SANDBOX=1 (o devcontainer e o CI já definem).', { cause: error });
        }
        throw error;
    }
    return { app, window: await app.firstWindow(), userData };
}

/**
 * @param userData Pasta de dados do teste.
 */
export function removeUserData(userData: string): void {
    rmSync(userData, { recursive: true, force: true });
}
