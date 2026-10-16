import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@finance/core';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { SystemClock } from '../src/utility/systemAdapters.ts';
import { freshUserData, launchApp, removeUserData } from './launchApp.ts';

/*
 * Instalador de Linux (desktop-mvp-plan Fase 14): o `.deb` gerado pelo `pnpm dist:linux`,
 * extraído numa pasta temporária fora do repositório — assim nenhum `node_modules` do monorepo
 * socorre um módulo que tenha ficado fora do pacote —, abre um banco de uma versão anterior,
 * migra com backup e segue funcionando. Roda pelo `pnpm test:packaged`, fora do `pnpm check`.
 */

/** Pasta das migrations em SQL, a mesma que o `embed:migrations` embute no núcleo. */
const MIGRATIONS_DIR = join(import.meta.dirname, '../../../db/migrations');

/**
 * Versão do `package.json`, de onde o electron-builder tira o nome do `.deb` e o Electron, a
 * versão mostrada em Ajustes.
 */
const PACKAGE_VERSION = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'))).version;

/** Migration lida do disco, no formato que o `openDatabase` aceita. */
interface SqlMigration {
    readonly version: number;
    readonly name: string;
    readonly sql: string;
}

/**
 * Lê as migrations direto de `db/migrations`, e não da lista embutida, para o teste não
 * depender de um arquivo gerado nem de um caminho interno do `core`.
 *
 * @return As migrations em ordem de versão.
 */
function readMigrations(): readonly SqlMigration[] {
    return readdirSync(MIGRATIONS_DIR)
        .filter((file) => /^\d{4}_.+\.sql$/.test(file))
        .sort()
        .map((file) => ({ version: Number(file.slice(0, 4)), name: file.replace(/\.sql$/, ''), sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8') }));
}

/**
 * Extrai o `.deb` da versão atual do `package.json`, como o `dpkg` faria ao instalar, mas
 * numa pasta temporária e sem precisar de root.
 *
 * @param destination Pasta vazia que recebe a árvore do pacote (`opt/`, `usr/`).
 * @return O executável do app dentro da árvore extraída.
 * @throws Error Quando o `.deb` não existe: o teste roda sobre o instalador, não o gera.
 */
function extractDeb(destination: string): string {
    const deb = join(import.meta.dirname, `../release/financas-${PACKAGE_VERSION}-amd64.deb`);
    if (!existsSync(deb)) {
        throw new Error(`${deb} não existe: gere o instalador com \`pnpm dist:linux\` (ou rode \`pnpm test:packaged\`).`);
    }
    execFileSync('dpkg-deb', ['-x', deb, destination]);
    const [installDir = ''] = readdirSync(join(destination, 'opt'));
    return join(destination, 'opt', installDir, 'financas');
}

/**
 * Grava em `userData/finance.sqlite` um banco parado na penúltima migration, com um perfil,
 * como o de quem usou a versão anterior do app. A abertura seguinte precisa migrar — e por isso
 * fazer o backup — sem perder o perfil.
 *
 * @param userData Pasta de dados do teste.
 * @param migrations Todas as migrations; a última fica de fora para o app empacotado aplicar.
 */
function seedPreviousVersion(userData: string, migrations: readonly SqlMigration[]): void {
    const database = BetterSqliteDatabase.open(join(userData, 'finance.sqlite'));
    try {
        const clock = new SystemClock();
        openDatabase(database, { backups: null, clock, migrations: migrations.slice(0, -1) });
        database.run('INSERT INTO profiles (id, name, type, currency, updated_at) VALUES (:id, :name, 1, :currency, :now)', { id: randomUUID(), name: 'Pessoal', currency: 'BRL', now: clock.now() });
    } finally {
        database.close();
    }
}

/**
 * @param userData Pasta de dados do teste.
 * @return O `user_version` gravado no banco.
 */
function schemaVersion(userData: string): number {
    const database = BetterSqliteDatabase.open(join(userData, 'finance.sqlite'));
    try {
        return z.object({ user_version: z.number() }).parse(database.get('PRAGMA user_version')).user_version;
    } finally {
        database.close();
    }
}

test('o .deb abre o banco da versão anterior, migra com backup e funciona fora do repositório', async () => {
    const installRoot = mkdtempSync(join(tmpdir(), 'finance-deb-'));
    const userData = freshUserData();
    const migrations = readMigrations();
    const latest = migrations.at(-1)?.version ?? 0;
    try {
        const executable = extractDeb(installRoot);
        seedPreviousVersion(userData, migrations);

        const first = await launchApp(userData, executable);
        const page = first.window;
        await expect(page.getByTestId('profile-switcher')).toContainText('Pessoal · BRL');
        await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Ajustes', exact: true }).dispatchEvent('click');
        const about = page.getByRole('region', { name: 'Sobre' });
        await expect(about).toContainText(`Versão do app${PACKAGE_VERSION}`);
        await first.app.close();

        // Regra de negócio (Banco, backend-design §4.6): antes de migrar, a cópia da versão de partida.
        expect(readdirSync(join(userData, 'backups')).some((file) => file.startsWith(`pre-v${String(latest - 1)}-`))).toBe(true);
        expect(schemaVersion(userData)).toBe(latest);

        const second = await launchApp(userData, executable);
        await expect(second.window.getByTestId('profile-switcher')).toContainText('Pessoal · BRL');
        await second.app.close();
    } finally {
        removeUserData(userData);
        rmSync(installRoot, { recursive: true, force: true });
    }
});
