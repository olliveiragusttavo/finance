import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@finance/core';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Log, LogLevel } from '../src/utility/FileLog.ts';
import { openCore, type OpenCoreOptions } from '../src/utility/openCore.ts';
import { CryptoIdGenerator, SystemClock } from '../src/utility/systemAdapters.ts';

const folders: string[] = [];

afterEach(() => {
    vi.useRealTimers();
    for (const folder of folders.splice(0)) {
        rmSync(folder, { recursive: true, force: true });
    }
});

/** Log em memória, para conferir o que a abertura registrou. */
class MemoryLog implements Log {
    public readonly lines: { readonly level: LogLevel; readonly event: string; readonly data: Readonly<Record<string, unknown>> }[] = [];

    /**
     * @param level Gravidade.
     * @param event Evento.
     * @param data Dados do evento.
     */
    public write(level: LogLevel, event: string, data: Readonly<Record<string, unknown>> = {}): void {
        this.lines.push({ level, event, data });
    }

    /** @return Os nomes dos eventos, na ordem. */
    public events(): readonly string[] {
        return this.lines.map((line) => line.event);
    }
}

/**
 * @param overrides Opções a trocar.
 * @return Opções de abertura numa pasta temporária, com o log em memória.
 */
function options(overrides: Partial<OpenCoreOptions> = {}): OpenCoreOptions & { readonly log: MemoryLog } {
    const folder = mkdtempSync(join(tmpdir(), 'finance-open-'));
    folders.push(folder);
    return {
        databasePath: join(folder, 'finance.sqlite'),
        backupsPath: join(folder, 'backups'),
        restoreMarkerPath: join(folder, 'restore-pending.json'),
        migrationFailureMarkerPath: join(folder, 'migration-failed.json'),
        clock: new SystemClock(),
        ids: new CryptoIdGenerator(),
        ...overrides,
        log: new MemoryLog(),
    };
}

describe('abertura do banco no processo do núcleo (backend-design §4.5)', () => {
    it('banco novo: migra sem backup, monta o núcleo e registra a integridade', async () => {
        const opts = options();
        const opened = await openCore(opts);
        expect(opened.status).toEqual({ kind: 'ready' });
        expect(opened.core).not.toBeNull();
        expect(opts.log.events()).toEqual(['database.opened', 'integrity.ok']);
        opened.close();
    });

    it('banco mais novo que o app: bloqueia com as duas versões e não migra nada', async () => {
        const opts = options();
        const database = BetterSqliteDatabase.open(opts.databasePath);
        database.exec('PRAGMA user_version = 999');
        database.close();

        const opened = await openCore(opts);
        expect(opened.status).toMatchObject({ kind: 'schemaNewerThanApp', databaseVersion: 999 });
        expect(opened.core).toBeNull();
        const reopened = BetterSqliteDatabase.open(opts.databasePath);
        expect(reopened.get('PRAGMA user_version')).toEqual({ user_version: 999 });
        expect(reopened.all("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([]);
        reopened.close();
        expect(existsSync(opts.backupsPath)).toBe(false);
    });

    it('migration que falha: bloqueia e oferece o backup gravado antes dela', async () => {
        const first = { version: 1, name: '0001_inicial', sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY) STRICT;' };
        const opts = options({ migrations: [first, { version: 2, name: '0002_quebrada', sql: 'INSERT INTO tabela_que_nao_existe VALUES (1);' }] });
        const setup = BetterSqliteDatabase.open(opts.databasePath);
        openDatabase(setup, { backups: null, clock: opts.clock, migrations: [first] });
        setup.close();

        const opened = await openCore(opts);
        expect(opened.status.kind).toBe('migrationFailed');
        const backups = readdirSync(opts.backupsPath);
        expect(backups).toHaveLength(1);
        expect(opened.status).toEqual({ kind: 'migrationFailed', backupFile: backups[0] });
        expect(opts.log.events()).toEqual(['database.migration-blocked']);
    });

    it('migration que falha de novo: oferece o backup de antes da primeira tentativa e a rotação não o apaga', async () => {
        const first = { version: 1, name: '0001_inicial', sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY) STRICT;' };
        const second = { version: 2, name: '0002_ok', sql: 'CREATE TABLE tags (id INTEGER PRIMARY KEY) STRICT;' };
        const broken = { version: 3, name: '0003_quebrada', sql: 'INSERT INTO tabela_que_nao_existe VALUES (1);' };
        const opts = options({ migrations: [first, second, broken] });
        const setup = BetterSqliteDatabase.open(opts.databasePath);
        openDatabase(setup, { backups: null, clock: opts.clock, migrations: [first] });
        setup.close();
        // Os backups são nomeados por segundo; cada abertura anda um segundo para não colidirem.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));

        const firstTry = await openCore(opts);
        expect(firstTry.status).toEqual({ kind: 'migrationFailed', backupFile: 'pre-v1-2026-10-03-120000.sqlite' });
        for (let attempt = 1; attempt <= 4; attempt += 1) {
            vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 12, 0, attempt)));
            const retry = await openCore(opts);
            // O banco ficou na v2 e cada abertura grava um `pre-v2`, que a versão anterior não abre.
            expect(retry.status).toEqual({ kind: 'migrationFailed', backupFile: 'pre-v1-2026-10-03-120000.sqlite' });
        }
        const backups = readdirSync(opts.backupsPath);
        expect(backups).toContain('pre-v1-2026-10-03-120000.sqlite');
        expect(backups).toHaveLength(4);

        vi.setSystemTime(new Date('2026-10-03T12:01:00Z'));
        const fixed = await openCore({ ...opts, migrations: [first, second, { ...broken, sql: 'CREATE TABLE notas (id INTEGER PRIMARY KEY) STRICT;' }] });
        // As migrations de teste não têm o schema real, então a integridade não roda; o que importa
        // aqui é que a migration passou e a marca saiu.
        expect(fixed.status.kind).not.toBe('migrationFailed');
        expect(opts.log.events()).toContain('database.opened');
        expect(existsSync(opts.migrationFailureMarkerPath)).toBe(false);
    });

    it('migration que falha num banco novo: bloqueia como migration, não como arquivo corrompido', async () => {
        const opts = options({ migrations: [{ version: 1, name: '0001_quebrada', sql: 'INSERT INTO tabela_que_nao_existe VALUES (1);' }] });
        const opened = await openCore(opts);
        expect(opened.status).toEqual({ kind: 'migrationFailed', backupFile: null });
        expect(opened.core).toBeNull();
    });

    it('restauração pela metade: bloqueia sem criar um banco vazio no lugar', async () => {
        const opts = options();
        writeFileSync(opts.restoreMarkerPath, JSON.stringify({ failedCopy: '/dados/backups/falha-1.sqlite' }));
        const opened = await openCore(opts);
        expect(opened.status).toEqual({ kind: 'restoreIncomplete', failedCopy: '/dados/backups/falha-1.sqlite' });
        expect(existsSync(opts.databasePath)).toBe(false);
        expect(opts.log.events()).toEqual(['database.restore-incomplete']);
    });

    it('marca de restauração ilegível ainda bloqueia', async () => {
        const opts = options();
        writeFileSync(opts.restoreMarkerPath, '{ quebrado');
        const opened = await openCore(opts);
        expect(opened.status).toEqual({ kind: 'restoreIncomplete', failedCopy: null });
    });

    it('arquivo que não é SQLite: bloqueia como falha de abertura, sem oferecer backup', async () => {
        const opts = options();
        writeFileSync(opts.databasePath, 'isto não é um banco SQLite, só texto comprido o bastante para o cabeçalho');
        const opened = await openCore(opts);
        expect(opened.status).toEqual({ kind: 'openFailed' });
        expect(existsSync(opts.backupsPath)).toBe(false);
    });
});
