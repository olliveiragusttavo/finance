import { openDatabase } from '../composition/createCore.ts';
import { LocalDate } from '../domain/shared/LocalDate.ts';
import { MigrationFailedError, SchemaNewerThanAppError } from '../infrastructure/migrations/MigrationRunner.ts';
import { embeddedMigrations } from '../infrastructure/migrations/embedded.generated.ts';
import { parseTimestamp, type Clock, type Timestamp } from '../ports/Clock.ts';
import type { Database } from '../ports/Database.ts';

/**
 * Falha de uma verificação do contrato. É uma classe própria, e não o `AssertionError` do
 * Vitest ou do Node, porque a suíte roda também no Hermes do `apps/mobile-contract`, onde
 * nenhum dos dois existe.
 */
export class ContractViolation extends Error {
    /**
     * @param message O que o adaptador fez de diferente do contrato.
     */
    public constructor(message: string) {
        super(message);
        this.name = 'ContractViolation';
    }
}

/** Um caso do contrato: recebe a fábrica de bancos vazios e lança `ContractViolation` se o adaptador divergir. */
export interface DatabaseContractCase {
    readonly name: string;
    readonly run: (open: () => Database) => void;
}

/** Resultado de um caso, para o app de contrato listar o que falhou. */
export interface DatabaseContractResult {
    readonly name: string;
    /** `null` quando o caso passou; a mensagem do erro quando falhou. */
    readonly failure: string | null;
}

/** Versão mínima do SQLite: `STRICT` (3.37) e o JSON embutido por padrão, usado em `json_valid` (3.38). */
export const MINIMUM_SQLITE_VERSION = '3.38.0';

/**
 * Relógio fixo da suíte: a abertura do banco pede um, mas nenhum caso depende da hora.
 * Fica aqui, e não nos adaptadores de teste, porque a suíte precisa rodar fora do Vitest.
 */
const CONTRACT_CLOCK: Clock = {
    now: (): Timestamp => parseTimestamp('2026-01-01 12:00:00'),
    today: (): LocalDate => LocalDate.parse('2026-01-01'),
};

/**
 * Igualdade estrutural pela forma JSON, suficiente para linhas do SQLite (texto, número e
 * nulo). Evita reimplementar um `deepEqual` e compara as chaves na ordem em que o driver
 * as devolve, que é a ordem das colunas do `SELECT` em qualquer adaptador correto.
 *
 * @param actual Valor devolvido pelo adaptador.
 * @param expected Valor que o contrato exige.
 * @param what Descrição do que foi conferido, para a mensagem de falha.
 * @throws {ContractViolation} Quando os valores diferem.
 */
function assertEqual(actual: unknown, expected: unknown, what: string): void {
    const actualJson = toJson(actual);
    const expectedJson = toJson(expected);
    if (actualJson !== expectedJson) {
        throw new ContractViolation(`${what}: esperado ${expectedJson}, veio ${actualJson}`);
    }
}

/**
 * O `JSON.stringify` devolve `undefined` (e não texto) para `undefined`, e o contrato precisa
 * distinguir "sem linha" de `null` na mensagem de falha.
 *
 * @param value Valor a descrever.
 * @return A forma JSON do valor, ou `undefined` por extenso.
 */
function toJson(value: unknown): string {
    return value === undefined ? 'undefined' : JSON.stringify(value);
}

/**
 * @param work Trecho que precisa lançar.
 * @param what Descrição do que deveria falhar, para a mensagem.
 * @param expected Classe de erro exigida, quando o tipo importa para o chamador.
 * @return O erro lançado, para conferências adicionais.
 * @throws {ContractViolation} Quando o trecho não lança, ou lança erro de outra classe.
 */
function assertThrows(work: () => unknown, what: string, expected?: abstract new (...args: never[]) => Error): unknown {
    try {
        work();
    } catch (error: unknown) {
        if (expected !== undefined && !(error instanceof expected)) {
            throw new ContractViolation(`${what}: esperado ${expected.name}, veio ${String(error)}`);
        }
        return error;
    }
    throw new ContractViolation(`${what}: deveria lançar erro, mas não lançou`);
}

/**
 * Compara versões `x.y.z` numericamente; texto não ordenaria `3.9` antes de `3.10`.
 *
 * @param version Versão do SQLite, como `sqlite_version()` devolve.
 * @param minimum Versão mínima.
 * @return `true` quando `version` é igual ou mais nova que `minimum`.
 */
export function isSqliteVersionAtLeast(version: string, minimum: string): boolean {
    const have = version.split('.').map(Number);
    const need = minimum.split('.').map(Number);
    for (let index = 0; index < need.length; index++) {
        const difference = (have[index] ?? 0) - (need[index] ?? 0);
        if (difference !== 0) {
            return difference > 0;
        }
    }
    return true;
}

/**
 * Contrato da porta `Database` (backend-design §5.10): o que todo adaptador precisa cumprir
 * para o núcleo rodar sobre ele. Escrito sem Vitest para rodar igual no Node, contra o
 * `better-sqlite3`, e no Hermes do `apps/mobile-contract`, contra o `expo-sqlite`
 * (mobile-shell-design §8). Cada caso recebe um banco vazio novo, para um caso não depender
 * do que o anterior deixou.
 */
export const DATABASE_CONTRACT: readonly DatabaseContractCase[] = [
    {
        name: `usa SQLite ${MINIMUM_SQLITE_VERSION} ou mais novo, com STRICT`,
        run: (open) => {
            const database = open();
            const version = database.get('SELECT sqlite_version() AS v')?.['v'];
            if (typeof version !== 'string' || !isSqliteVersionAtLeast(version, MINIMUM_SQLITE_VERSION)) {
                throw new ContractViolation(`versão do SQLite ${String(version)} é anterior à ${MINIMUM_SQLITE_VERSION}`);
            }
            database.exec('CREATE TABLE t (v INTEGER) STRICT');
            assertEqual(database.get('SELECT json_valid(:j) AS ok', { j: '{"a":1}' }), { ok: 1 }, 'json_valid');
        },
    },
    {
        name: 'desfaz a transação inteira quando o trabalho lança exceção',
        run: (open) => {
            const database = open();
            database.exec('CREATE TABLE t (v INTEGER) STRICT');
            assertThrows(() => database.transaction(() => {
                database.run('INSERT INTO t (v) VALUES (:v)', { v: 1 });
                throw new Error('falha no meio');
            }), 'transação com erro');
            assertEqual(database.get('SELECT count(*) AS n FROM t'), { n: 0 }, 'linhas após o rollback');
        },
    },
    {
        name: 'confirma a transação e devolve o valor do trabalho',
        run: (open) => {
            const database = open();
            database.exec('CREATE TABLE t (v INTEGER) STRICT');
            const result = database.transaction(() => database.run('INSERT INTO t (v) VALUES (:v)', { v: 7 }).changes);
            assertEqual(result, 1, 'retorno da transação');
            assertEqual(database.all('SELECT v FROM t'), [{ v: 7 }], 'linhas após o commit');
        },
    },
    {
        name: 'devolve REAL como number, NULL como null e preserva texto Unicode',
        run: (open) => {
            const database = open();
            assertEqual(database.get('SELECT 1.5 AS r, NULL AS n, 2 AS i, :t AS t', { t: 'Ação ☕' }), { r: 1.5, n: null, i: 2, t: 'Ação ☕' }, 'tipos da linha');
        },
    },
    {
        name: 'guarda inteiros acima de 32 bits e centavos sem perda',
        run: (open) => {
            const database = open();
            database.exec('CREATE TABLE t (i INTEGER, r REAL) STRICT');
            database.run('INSERT INTO t (i, r) VALUES (:i, :r)', { i: 9007199254740991, r: 999999999999.99 });
            assertEqual(database.get('SELECT i, r FROM t'), { i: 9007199254740991, r: 999999999999.99 }, 'valores extremos');
        },
    },
    {
        name: 'respeita STRICT: rejeita texto não numérico em coluna REAL',
        run: (open) => {
            const database = open();
            database.exec('CREATE TABLE t (v REAL) STRICT');
            assertThrows(() => database.run('INSERT INTO t (v) VALUES (:v)', { v: 'abc' }), 'texto em coluna REAL');
        },
    },
    {
        name: 'liga o mesmo parâmetro nomeado repetido na instrução',
        run: (open) => {
            const database = open();
            assertEqual(database.get('SELECT :v + :v AS dobro, :w AS w', { v: 2, w: 'x' }), { dobro: 4, w: 'x' }, 'parâmetro repetido');
        },
    },
    {
        name: 'reusa a mesma instrução com parâmetros diferentes sem misturar resultados',
        run: (open) => {
            const database = open();
            database.exec('CREATE TABLE t (v INTEGER) STRICT');
            for (const v of [1, 2, 3]) {
                database.run('INSERT INTO t (v) VALUES (:v)', { v });
            }
            assertEqual(database.get('SELECT v FROM t WHERE v = :v', { v: 2 }), { v: 2 }, 'primeira consulta');
            assertEqual(database.get('SELECT v FROM t WHERE v = :v', { v: 3 }), { v: 3 }, 'mesma consulta, outro parâmetro');
            assertEqual(database.all('SELECT v FROM t WHERE v >= :v ORDER BY v', { v: 2 }), [{ v: 2 }, { v: 3 }], 'todas as linhas');
        },
    },
    {
        name: 'devolve undefined sem linha, lista vazia sem linhas e a contagem de alteradas',
        run: (open) => {
            const database = open();
            database.exec('CREATE TABLE t (v INTEGER) STRICT; INSERT INTO t (v) VALUES (1); INSERT INTO t (v) VALUES (2);');
            assertEqual(database.get('SELECT v FROM t WHERE v = :v', { v: 9 }), undefined, 'get sem linha');
            assertEqual(database.all('SELECT v FROM t WHERE v = :v', { v: 9 }), [], 'all sem linhas');
            assertEqual(database.run('UPDATE t SET v = v + 10').changes, 2, 'linhas alteradas');
        },
    },
    {
        name: 'grava fora de transação depois de uma leitura parcial da mesma instrução',
        run: (open) => {
            const database = open();
            database.exec('CREATE TABLE t (v INTEGER) STRICT; INSERT INTO t (v) VALUES (1); INSERT INTO t (v) VALUES (2);');
            // `get` lê só a primeira de duas linhas: um adaptador que deixe o cursor aberto
            // trava o commit da transação seguinte ("SQL statements in progress").
            database.get('SELECT v FROM t ORDER BY v');
            database.transaction(() => database.run('INSERT INTO t (v) VALUES (:v)', { v: 3 }));
            assertEqual(database.get('SELECT count(*) AS n FROM t'), { n: 3 }, 'linhas após o commit');
        },
    },
    {
        name: 'liga foreign_keys na abertura: o hard delete de perfil cascateia (database-design §3.2)',
        run: (open) => {
            const database = open();
            openDatabase(database, { backups: null, clock: CONTRACT_CLOCK });
            assertEqual(database.get('PRAGMA foreign_keys'), { foreign_keys: 1 }, 'foreign_keys');
            const now = '2026-01-01 00:00:00';
            const profile = '00000000-0000-4000-8000-000000000001';
            const account = '00000000-0000-4000-8000-000000000002';
            database.run(`INSERT INTO profiles (id, name, type, currency, updated_at) VALUES (:profile, 'P', 1, 'BRL', :now)`, { profile, now });
            database.run(
                `INSERT INTO accounts (id, profile_id, name, balance, projected_balance, currency, type, updated_at)
                VALUES (:account, :profile, 'C', 0, 0, 'BRL', 1, :now)`,
                { account, profile, now },
            );
            database.run('DELETE FROM profiles WHERE id = :profile', { profile });
            assertEqual(database.get('SELECT count(*) AS n FROM accounts'), { n: 0 }, 'contas após a cascata');
        },
    },
    {
        name: 'aplica as migrations embutidas uma vez e registra a versão em user_version',
        run: (open) => {
            const database = open();
            const first = openDatabase(database, { backups: null, clock: CONTRACT_CLOCK });
            assertEqual(first.applied, embeddedMigrations.map((migration) => migration.version), 'migrations da primeira abertura');
            assertEqual(database.get('PRAGMA user_version'), { user_version: embeddedMigrations.length }, 'user_version');
            assertEqual(openDatabase(database, { backups: null, clock: CONTRACT_CLOCK }).applied, [], 'migrations da segunda abertura');
        },
    },
    {
        name: 'recusa abrir um banco mais novo que o app (backend-design §4.8)',
        run: (open) => {
            const database = open();
            openDatabase(database, { backups: null, clock: CONTRACT_CLOCK });
            database.exec('PRAGMA user_version = 999');
            assertThrows(() => openDatabase(database, { backups: null, clock: CONTRACT_CLOCK }), 'banco mais novo', SchemaNewerThanAppError);
        },
    },
    {
        name: 'erro de SQL numa migration vira MigrationFailedError e mantém as anteriores',
        run: (open) => {
            const database = open();
            const migrations = [
                { version: 1, name: '0001_inicial', sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY) STRICT;' },
                { version: 2, name: '0002_quebrada', sql: 'INSERT INTO tabela_que_nao_existe VALUES (1);' },
            ];
            assertThrows(() => openDatabase(database, { backups: null, clock: CONTRACT_CLOCK, migrations }), 'migration quebrada', MigrationFailedError);
            assertEqual(database.get('PRAGMA user_version'), { user_version: 1 }, 'user_version após a falha');
        },
    },
];

/**
 * Roda o contrato inteiro e devolve o resultado de cada caso, sem parar no primeiro que
 * falha. É a entrada do `apps/mobile-contract`, que mostra e registra a lista completa; o
 * Vitest usa os casos um a um, para cada um aparecer como um teste.
 *
 * @param open Fábrica de bancos vazios do adaptador sob teste; chamada uma vez por caso.
 * @return O resultado de cada caso, na ordem do contrato.
 */
export function runDatabaseContract(open: () => Database): readonly DatabaseContractResult[] {
    return DATABASE_CONTRACT.map((contractCase) => {
        try {
            contractCase.run(open);
            return { name: contractCase.name, failure: null };
        } catch (error: unknown) {
            return { name: contractCase.name, failure: error instanceof Error ? error.message : String(error) };
        }
    });
}
