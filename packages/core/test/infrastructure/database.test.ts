import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { describe, expect, it } from 'vitest';
import { DATABASE_CONTRACT, isSqliteVersionAtLeast, runDatabaseContract } from '../../src/contract/databaseContract.ts';
import type { Database } from '../../src/index.ts';
import { embeddedMigrations } from '../../src/infrastructure/migrations/embedded.generated.ts';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'db', 'migrations');

/**
 * @return Um banco em memória novo, tipado pela porta: a atribuição é a verificação, em
 * tempo de compilação, de que o adaptador cumpre o contrato `Database`.
 */
function freshDatabase(): Database {
    const database: Database = BetterSqliteDatabase.open(':memory:');
    return database;
}

describe('contrato da porta Database sobre o better-sqlite3 (backend-design §5.10)', () => {
    for (const contractCase of DATABASE_CONTRACT) {
        it(contractCase.name, () => {
            contractCase.run(freshDatabase);
        });
    }
});

describe('runDatabaseContract', () => {
    it('passa inteiro no adaptador do desktop', () => {
        expect(runDatabaseContract(freshDatabase).filter((result) => result.failure !== null)).toEqual([]);
    });

    it('lista cada caso que um adaptador quebrado viola, sem parar no primeiro', () => {
        /**
         * Adaptador com dois defeitos que o contrato existe para pegar: anuncia um SQLite antigo
         * e executa a transação sem `BEGIN`, de modo que uma exceção no meio não desfaz nada.
         *
         * @return Um banco sobre o `better-sqlite3` com os dois defeitos.
         */
        function brokenDatabase(): Database {
            const real = freshDatabase();
            return {
                run: (sql, params) => real.run(sql, params),
                get: (sql, params) => (sql === 'SELECT sqlite_version() AS v' ? { v: '3.30.0' } : real.get(sql, params)),
                all: (sql, params) => real.all(sql, params),
                exec: (sql) => {
                    real.exec(sql);
                },
                transaction: (work) => work(),
            };
        }

        const failures = runDatabaseContract(brokenDatabase).filter((result) => result.failure !== null);

        expect(failures.map((result) => result.name)).toEqual(['usa SQLite 3.38.0 ou mais novo, com STRICT', 'desfaz a transação inteira quando o trabalho lança exceção']);
        expect(failures[0]?.failure).toContain('3.30.0');
        expect(failures[1]?.failure).toContain('linhas após o rollback');
    });
});

describe('isSqliteVersionAtLeast', () => {
    it('compara por número, e não por texto', () => {
        expect(isSqliteVersionAtLeast('3.38.0', '3.38.0')).toBe(true);
        expect(isSqliteVersionAtLeast('3.40.1', '3.38.0')).toBe(true);
        expect(isSqliteVersionAtLeast('3.9.2', '3.38.0')).toBe(false);
        expect(isSqliteVersionAtLeast('4.0', '3.38.0')).toBe(true);
    });
});

describe('migrations embutidas (backend-design §4.5)', () => {
    it('as migrations embutidas são idênticas aos arquivos de db/migrations', () => {
        const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
        expect(embeddedMigrations.map((migration) => `${migration.name}.sql`)).toEqual(files);
        for (const migration of embeddedMigrations) {
            expect(migration.sql, `${migration.name} desatualizada: rode pnpm embed:migrations`).toBe(
                readFileSync(join(MIGRATIONS_DIR, `${migration.name}.sql`), 'utf8'),
            );
        }
    });
});

describe('imutabilidade das migrations (backend-design §4.3)', () => {
    /**
     * Lê o lock sem passar pelo script que o grava, para que um bug no script não aprove a
     * si mesmo.
     *
     * @return O hash travado de cada arquivo, pelo nome.
     */
    function lockedHashes(): ReadonlyMap<string, string> {
        const lines = readFileSync(join(MIGRATIONS_DIR, 'checksums.lock'), 'utf8').split('\n').filter((line) => line !== '');
        return new Map(lines.map((line) => {
            const [hash = '', file = ''] = line.split('  ');
            return [file, hash];
        }));
    }

    it('toda migration está travada e nenhuma travada foi editada ou removida', () => {
        const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
        const locked = lockedHashes();

        expect([...locked.keys()].sort(), 'checksums.lock desatualizado: rode pnpm embed:migrations').toEqual(files);
        for (const file of files) {
            const hash = createHash('sha256').update(readFileSync(join(MIGRATIONS_DIR, file))).digest('hex');
            expect(hash, `${file} foi editada depois de publicada: corrija com uma migration nova`).toBe(locked.get(file));
        }
    });
});
