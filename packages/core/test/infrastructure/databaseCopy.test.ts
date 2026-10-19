import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { afterEach, describe, expect, it } from 'vitest';
import { copyDatabaseTo, DatabaseCopyError, inspectDatabaseCopy, openDatabase, type Database } from '../../src/index.ts';
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

/**
 * Abre a cópia como a importação abre: somente leitura, para provar que a conferência não
 * depende de gravar no arquivo do usuário.
 *
 * @param path Arquivo a conferir.
 * @return O resultado da conferência, com a conexão já fechada.
 */
function inspectFile(path: string): ReturnType<typeof inspectDatabaseCopy> {
    const copy = BetterSqliteDatabase.open(path, { readOnly: true });
    try {
        return inspectDatabaseCopy(copy);
    } finally {
        copy.close();
    }
}

describe('conferência da cópia antes de importar', () => {
    it('aceita a cópia exportada pelo app, com a versão do schema', () => {
        const path = join(temporaryFolder(), 'financas.sqlite');
        copyDatabaseTo(populatedDatabase(), path);

        expect(inspectFile(path)).toEqual({ ok: true, schemaVersion: embeddedMigrations.length });
    });

    it('aceita a cópia de uma versão anterior, que a abertura vai migrar', () => {
        const database = BetterSqliteDatabase.open(':memory:');
        openDatabase(database, { backups: null, clock, migrations: embeddedMigrations.slice(0, -1) });

        expect(inspectDatabaseCopy(database)).toEqual({ ok: true, schemaVersion: embeddedMigrations.length - 1 });
    });

    it('recusa a cópia de uma versão mais nova do app, que esta versão não abriria', () => {
        const database = populatedDatabase();

        expect(inspectDatabaseCopy(database, embeddedMigrations.slice(0, -1))).toEqual({ ok: false, reason: 'newer-than-app' });
    });

    it('recusa arquivo que não é SQLite, sem lançar', () => {
        const path = join(temporaryFolder(), 'planilha.sqlite');
        writeFileSync(path, 'data;valor\n2026-10-01;10,00\n'.repeat(200));

        expect(inspectFile(path)).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('recusa SQLite de outro programa: sem versão de schema ou sem as tabelas do app', () => {
        const empty = BetterSqliteDatabase.open(':memory:');
        empty.exec('CREATE TABLE notas (texto TEXT)');
        expect(inspectDatabaseCopy(empty)).toEqual({ ok: false, reason: 'not-app-database' });

        const versioned = BetterSqliteDatabase.open(':memory:');
        versioned.exec('CREATE TABLE notas (texto TEXT); PRAGMA user_version = 3');
        expect(inspectDatabaseCopy(versioned)).toEqual({ ok: false, reason: 'not-app-database' });
    });
});
