import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDate, parseTimestamp, parseUuid, type Clock, type IdGenerator } from '@finance/core';
import { BetterSqliteDatabase, NodeBackupDirectory } from '@finance/sqlite-better';
import { afterEach, describe, expect, it } from 'vitest';
import {
    openCoreSequence,
    type MigrationFailureMarker,
    type RestoreMarker,
    type StartupLogLevel,
    type StartupMarkers,
    type StartupPorts,
} from '../src/startup/openCoreSequence.ts';

const folders: string[] = [];

afterEach(() => {
    for (const folder of folders.splice(0)) {
        rmSync(folder, { recursive: true, force: true });
    }
});

/** Marcas em memória: o que o celular e o desktop gravam em arquivo, sem disco. */
class MemoryMarkers implements StartupMarkers {
    public restore: RestoreMarker | null = null;
    public migrationFailure: MigrationFailureMarker | null = null;
    public failWrites = false;

    /** @return A restauração pendente. */
    public readRestore(): RestoreMarker | null {
        return this.restore;
    }

    /** @return A falha de migration lembrada. */
    public readMigrationFailure(): MigrationFailureMarker | null {
        return this.migrationFailure;
    }

    /**
     * @param marker Marca a gravar.
     * @throws {Error} Quando o teste simula disco cheio.
     */
    public writeMigrationFailure(marker: MigrationFailureMarker): void {
        if (this.failWrites) {
            throw new Error('disco cheio');
        }
        this.migrationFailure = marker;
    }

    /** Apaga a marca. */
    public clearMigrationFailure(): void {
        this.migrationFailure = null;
    }
}

/**
 * @param overrides Portas a trocar.
 * @return Portas sobre um banco em arquivo numa pasta temporária, com marcas e log em memória.
 */
function ports(overrides: Partial<StartupPorts<BetterSqliteDatabase>> = {}): StartupPorts<BetterSqliteDatabase> & { readonly markers: MemoryMarkers; readonly events: string[] } {
    const folder = mkdtempSync(join(tmpdir(), 'finance-startup-'));
    folders.push(folder);
    const clock: Clock = { now: () => parseTimestamp('2026-03-15 12:00:00'), today: () => LocalDate.parse('2026-03-15') };
    let next = 0;
    const ids: IdGenerator = { random: () => parseUuid(`00000000-0000-4000-8000-${(++next).toString(16).padStart(12, '0')}`) };
    const events: string[] = [];
    return {
        openDatabase: () => BetterSqliteDatabase.open(join(folder, 'finance.sqlite')),
        backups: new NodeBackupDirectory(join(folder, 'backups')),
        clock,
        ids,
        log: { write: (_level: StartupLogLevel, event: string) => events.push(event) },
        ...overrides,
        markers: new MemoryMarkers(),
        events,
    };
}

describe('openCoreSequence (backend-design §4.5, compartilhada pelos dois shells)', () => {
    it('banco novo: abre, migra, verifica a integridade e completa as recorrências', async () => {
        const startup = ports();

        const outcome = await openCoreSequence(startup);

        expect(outcome.status.kind).toBe('ready');
        expect(outcome.core).not.toBeNull();
        expect(startup.events).toEqual(['database.opened', 'integrity.ok', 'recurrences.topped-up']);
        outcome.close();
    });

    it('restauração pela metade: bloqueia sem nem abrir o arquivo, que viraria um banco vazio', async () => {
        let opened = false;
        const startup = ports({
            openDatabase: () => {
                opened = true;
                return BetterSqliteDatabase.open(':memory:');
            },
        });
        startup.markers.restore = { failedCopy: 'falha-20260315.sqlite' };

        const outcome = await openCoreSequence(startup);

        expect(outcome.status).toEqual({ kind: 'restoreIncomplete', failedCopy: 'falha-20260315.sqlite' });
        expect(opened).toBe(false);
    });

    it('arquivo que não abre: bloqueia como openFailed, sem oferecer backup', async () => {
        const startup = ports({
            openDatabase: () => {
                throw new Error('SQLITE_CANTOPEN');
            },
        });

        expect((await openCoreSequence(startup)).status).toEqual({ kind: 'openFailed' });
        expect(startup.events).toEqual(['database.open-failed']);
    });

    it('migration que falha num banco novo: bloqueia como migration e lembra a falha numa marca', async () => {
        const startup = ports({ migrations: [{ version: 1, name: '0001_quebrada', sql: 'INSERT INTO nada VALUES (1);' }] });

        const outcome = await openCoreSequence(startup);

        expect(outcome.status).toEqual({ kind: 'migrationFailed', backupFile: null });
        expect(outcome.database).toBeNull();
        expect(startup.markers.migrationFailure).toEqual({ backupFile: null });
    });

    it('marca que não pôde ser gravada: bloqueia do mesmo jeito e registra o aviso', async () => {
        const startup = ports({ migrations: [{ version: 1, name: '0001_quebrada', sql: 'INSERT INTO nada VALUES (1);' }] });
        startup.markers.failWrites = true;

        expect((await openCoreSequence(startup)).status.kind).toBe('migrationFailed');
        expect(startup.events).toContain('database.migration-marker-write-failed');
    });

    it('migration que enfim passa: apaga a marca, e o backup volta à rotação normal', async () => {
        const startup = ports();
        startup.markers.migrationFailure = { backupFile: null };

        const outcome = await openCoreSequence(startup);

        expect(outcome.status.kind).toBe('ready');
        expect(startup.markers.migrationFailure).toBeNull();
        outcome.close();
    });
});
