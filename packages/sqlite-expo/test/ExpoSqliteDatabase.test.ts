import { createCore, openDatabase, parseTimestamp, parseUuid, LocalDate, type Clock, type Database } from '@finance/core';
import { DATABASE_CONTRACT, runDatabaseContract } from '@finance/core/contract';
import { describe, expect, it } from 'vitest';
import { ExpoSqliteDatabase, prefixParams } from '../src/ExpoSqliteDatabase.ts';
import { assertSqliteCapabilities, UnsupportedSqliteError } from '../src/sqliteCapabilities.ts';
import { FakeExpoConnection } from './support/FakeExpoConnection.ts';

/**
 * @return Um banco vazio do adaptador sobre o dublê, tipado pela porta: a atribuição confere
 * na compilação que o adaptador cumpre `Database`.
 */
function freshDatabase(): Database {
    const database: Database = ExpoSqliteDatabase.wrap(new FakeExpoConnection());
    return database;
}

describe('contrato da porta Database sobre o ExpoSqliteDatabase (backend-design §5.10)', () => {
    for (const contractCase of DATABASE_CONTRACT) {
        it(contractCase.name, () => {
            contractCase.run(freshDatabase);
        });
    }

    it('passa inteiro pelo runDatabaseContract, a mesma entrada do app de contrato', () => {
        expect(runDatabaseContract(freshDatabase).filter((result) => result.failure !== null)).toEqual([]);
    });
});

describe('ExpoSqliteDatabase', () => {
    it('prefixa as chaves com ":": sem o prefixo o driver deixaria o parâmetro NULL em silêncio', () => {
        expect(prefixParams({ id: 'a', value: 1, empty: null })).toEqual({ ':id': 'a', ':value': 1, ':empty': null });
        expect(prefixParams({})).toEqual({});
    });

    it('prepara cada SQL uma vez e reusa a instrução', () => {
        const connection = new FakeExpoConnection();
        const database = ExpoSqliteDatabase.wrap(connection);
        database.exec('CREATE TABLE t (v INTEGER) STRICT');

        for (const v of [1, 2, 3]) {
            database.run('INSERT INTO t (v) VALUES (:v)', { v });
            database.get('SELECT v FROM t WHERE v = :v', { v });
        }

        expect(connection.prepared).toEqual(['INSERT INTO t (v) VALUES (:v)', 'SELECT v FROM t WHERE v = :v']);
    });

    it('lê várias vezes a primeira linha da mesma consulta sem travar a conexão', () => {
        const database = freshDatabase();
        database.exec('CREATE TABLE t (v INTEGER) STRICT; INSERT INTO t VALUES (1); INSERT INTO t VALUES (2);');

        expect(database.get('SELECT v FROM t ORDER BY v')).toEqual({ v: 1 });
        expect(database.get('SELECT v FROM t ORDER BY v')).toEqual({ v: 1 });
        expect(database.run('DELETE FROM t WHERE v = :v', { v: 2 }).changes).toBe(1);
    });

    it('propaga a exceção da transação depois de desfazer', () => {
        const database = freshDatabase();
        database.exec('CREATE TABLE t (v INTEGER) STRICT');

        expect(() => database.transaction(() => {
            database.run('INSERT INTO t (v) VALUES (:v)', { v: 1 });
            throw new RangeError('no meio');
        })).toThrow(RangeError);
        expect(database.all('SELECT v FROM t')).toEqual([]);
    });

    it('finaliza as instruções em cache antes de fechar a conexão', () => {
        const connection = new FakeExpoConnection();
        const database = ExpoSqliteDatabase.wrap(connection);
        database.get('SELECT 1 AS um');

        database.close();

        expect(connection.finalized).toEqual(['SELECT 1 AS um']);
        expect(connection.closed).toBe(true);
    });

    it('roda o núcleo inteiro: abre, migra, lança e confere a integridade', async () => {
        const database = freshDatabase();
        const clock: Clock = { now: () => parseTimestamp('2026-03-15 12:00:00'), today: () => LocalDate.parse('2026-03-15') };
        openDatabase(database, { backups: null, clock });
        let next = 0;
        const core = createCore({ database, clock, ids: { random: () => parseUuid(`00000000-0000-4000-8000-${(++next).toString(16).padStart(12, '0')}`) } });

        const onboarding = await core.call('onboarding.start', {
            profile: { name: 'Pessoal', type: 'personal', currency: 'BRL' },
            account: { name: 'Conta', type: 'checking', openingBalance: 100 },
        });
        expect(onboarding.ok).toBe(true);
        expect(await core.call('integrity.verifyBalances', {})).toEqual({ ok: true, data: { checkedAccounts: 1, drifts: [] } });
    });
});

describe('assertSqliteCapabilities', () => {
    it('devolve a versão quando o SQLite tem STRICT e JSON', () => {
        expect(assertSqliteCapabilities(freshDatabase())).toMatch(/^3\.\d+\.\d+$/);
    });

    it('recusa SQLite anterior ao mínimo com erro próprio, antes de qualquer migration', () => {
        const real = freshDatabase();
        const old: Database = {
            run: (sql, params) => real.run(sql, params),
            get: (sql, params) => (sql === 'SELECT sqlite_version() AS v' ? { v: '3.31.1' } : real.get(sql, params)),
            all: (sql, params) => real.all(sql, params),
            exec: (sql) => {
                real.exec(sql);
            },
            transaction: (work) => real.transaction(work),
        };

        expect(() => assertSqliteCapabilities(old)).toThrow(UnsupportedSqliteError);
    });

    it('recusa SQLite sem STRICT ou sem JSON com a causa do driver', () => {
        const real = freshDatabase();
        const withoutJson: Database = {
            run: (sql, params) => real.run(sql, params),
            get: (sql, params) => {
                if (sql.includes('json_valid')) {
                    throw new Error('no such function: json_valid');
                }
                return real.get(sql, params);
            },
            all: (sql, params) => real.all(sql, params),
            exec: (sql) => {
                real.exec(sql);
            },
            transaction: (work) => real.transaction(work),
        };

        expect(() => assertSqliteCapabilities(withoutJson)).toThrow('no such function: json_valid');
    });
});
