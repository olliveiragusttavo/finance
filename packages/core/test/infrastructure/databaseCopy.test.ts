import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { afterEach, describe, expect, it } from 'vitest';
import { copyDatabaseTo, DatabaseCopyError, openDatabase, type Database } from '../../src/index.ts';
import { embeddedMigrations } from '../../src/infrastructure/migrations/embedded.generated.ts';
import { FixedClock } from '../support/adapters.ts';

const clock = new FixedClock('2026-10-14');
const folders: string[] = [];

afterEach(() => {
    for (const folder of folders.splice(0)) {
        rmSync(folder, { recursive: true, force: true });
    }
});

/**
 * @return Uma pasta temporária real, porque o `VACUUM INTO` grava em disco; apagada no fim.
 */
function temporaryFolder(): string {
    const folder = mkdtempSync(join(tmpdir(), 'finance-copy-'));
    folders.push(folder);
    return folder;
}

/**
 * @return Um banco migrado com um perfil, o dado que a cópia precisa levar. Em arquivo e em
 * WAL, como o do app, para provar que a cópia inclui o que ainda não saiu do `-wal`.
 */
function populatedDatabase(): Database {
    const database = BetterSqliteDatabase.open(join(temporaryFolder(), 'finance.sqlite'));
    openDatabase(database, { backups: null, clock });
    database.run(
        `INSERT INTO profiles (id, name, type, currency, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 'Pessoal', 1, 'BRL', :now)`,
        { now: clock.now() },
    );
    return database;
}

describe('cópia exportada do banco (desktop-mvp-plan Fase 13)', () => {
    it('grava uma cópia que abre como banco do app, com a versão do schema e os dados', () => {
        const database = populatedDatabase();
        const path = join(temporaryFolder(), "cópia d'água.sqlite");

        copyDatabaseTo(database, path);

        const copy = BetterSqliteDatabase.open(path);
        expect(copy.get('PRAGMA user_version')).toEqual({ user_version: embeddedMigrations.length });
        expect(copy.get('SELECT name FROM profiles')).toEqual({ name: 'Pessoal' });
        copy.close();
    });

    it('recusa destino existente com erro próprio, sem tocar no arquivo', () => {
        const database = populatedDatabase();
        const path = join(temporaryFolder(), 'existente.sqlite');
        writeFileSync(path, 'do usuário');

        expect(() => {
            copyDatabaseTo(database, path);
        }).toThrow(DatabaseCopyError);
    });
});
