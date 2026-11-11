import { computeClientGoldenVectors } from '@finance/client/golden';
import clientVectors from '@finance/client/golden/vectors.json';
import { computeCoreGoldenVectors, type GoldenVectors } from '@finance/core/golden';
import coreVectors from '@finance/core/golden/vectors.json';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { formatReportLog, runContract, type ClosableDatabase, type ContractInputs } from '../src/contractReport.ts';

/**
 * As mesmas entradas do aparelho, com o `better-sqlite3` no lugar do `expo-sqlite`: se o
 * contrato passa aqui e falha no emulador, a causa é do Hermes ou do adaptador, nunca do
 * próprio app de contrato.
 *
 * @param openDatabase Fábrica de bancos; por padrão um `better-sqlite3` em memória.
 * @return As entradas do contrato.
 */
function nodeInputs(openDatabase: () => ClosableDatabase = () => BetterSqliteDatabase.open(':memory:')): ContractInputs {
    return {
        openDatabase,
        goldenSuites: [
            { name: 'core', expected: coreVectors, compute: computeCoreGoldenVectors },
            { name: 'client', expected: clientVectors, compute: computeClientGoldenVectors },
        ],
    };
}

describe('resultado do contrato (mobile-mvp-plan, Fase 3)', () => {
    it('passa no Node, com todos os casos do banco e todos os vetores conferidos', () => {
        const report = runContract(nodeInputs());

        expect(report.failures).toEqual([]);
        expect(report.passed).toBe(true);
        expect(report.databaseCases).toBeGreaterThan(10);
        expect(report.goldenCases).toBeGreaterThan(500);
        expect(report.sqliteVersion).toMatch(/^3\.\d+\.\d+$/);
    });

    it('lista o vetor que divergiu, com o grupo, a entrada e os dois valores', () => {
        const wrongSplit: GoldenVectors = { ...computeCoreGoldenVectors(), 'money.split': [{ input: { amount: 1000, parts: 3, currency: 'BRL' }, output: ['333.33', '333.33', '333.34'] }] };
        const inputs = nodeInputs();
        const report = runContract({ ...inputs, goldenSuites: [{ name: 'core', expected: coreVectors, compute: () => wrongSplit }] });

        expect(report.passed).toBe(false);
        expect(report.failures.map((failure) => failure.source)).toContain('vetores:core');
        expect(report.failures.map((failure) => failure.description)).toContain('money.split {"amount":1000,"parts":3,"currency":"BRL"}: Node ["333.34","333.33","333.33"], aqui ["333.33","333.33","333.34"]');
    });

    it('um cálculo que lança vira falha do conjunto, sem esconder o resultado dos outros', () => {
        const inputs = nodeInputs();
        const report = runContract({
            ...inputs,
            goldenSuites: [
                { name: 'core', expected: coreVectors, compute: computeCoreGoldenVectors },
                {
                    name: 'client',
                    expected: clientVectors,
                    compute: () => {
                        throw new SyntaxError('Invalid regular expression: \\p{Diacritic}');
                    },
                },
            ],
        });

        expect(report.passed).toBe(false);
        expect(report.failures).toEqual([{ source: 'vetores:client', description: 'não calculou: Invalid regular expression: \\p{Diacritic}' }]);
    });

    it('acusa o caso do banco que o adaptador descumpre, e fecha todo banco aberto', () => {
        const opened: { closed: boolean }[] = [];
        const report = runContract(
            nodeInputs(() => {
                const database = BetterSqliteDatabase.open(':memory:');
                const state = { closed: false };
                opened.push(state);
                return {
                    run: (sql, params) => database.run(sql, params),
                    get: (sql, params) => database.get(sql, params),
                    // Adaptador quebrado: devolve só a primeira linha.
                    all: (sql, params) => database.all(sql, params).slice(0, 1),
                    exec: (sql) => {
                        database.exec(sql);
                    },
                    transaction: (work) => database.transaction(work),
                    close: () => {
                        state.closed = true;
                        database.close();
                    },
                };
            }),
        );

        expect(report.passed).toBe(false);
        expect(report.failures.some((failure) => failure.source === 'banco')).toBe(true);
        expect(opened.every((state) => state.closed)).toBe(true);
    });

    it('um close que lança vira falha da lista, em vez de derrubar o app', () => {
        const report = runContract(
            nodeInputs(() => {
                const database = BetterSqliteDatabase.open(':memory:');
                return {
                    run: (sql, params) => database.run(sql, params),
                    get: (sql, params) => database.get(sql, params),
                    all: (sql, params) => database.all(sql, params),
                    exec: (sql) => {
                        database.exec(sql);
                    },
                    transaction: (work) => database.transaction(work),
                    close: () => {
                        database.close();
                        throw new Error('cannot store TEXT value in REAL column t.v');
                    },
                };
            }),
        );

        expect(report.passed).toBe(false);
        expect(report.failures).toContainEqual({ source: 'banco', description: 'fechar a conexão: cannot store TEXT value in REAL column t.v' });
    });

    it('não passa sem casos conferidos, para um bundle sem vetores não virar verde', () => {
        const report = runContract({ ...nodeInputs(), goldenSuites: [] });

        expect(report.failures).toEqual([]);
        expect(report.passed).toBe(false);
    });

    it('vetores fora do formato viram falha com a causa', () => {
        const report = runContract({ ...nodeInputs(), goldenSuites: [{ name: 'core', expected: [], compute: computeCoreGoldenVectors }] });

        expect(report.failures).toEqual([{ source: 'vetores:core', description: 'não calculou: vetores de ouro: o arquivo não é um objeto de grupos' }]);
    });

    it('resume o resultado em linhas estáveis para o log do aparelho', () => {
        const log = formatReportLog({
            passed: false,
            sqliteVersion: '3.53.3',
            databaseCases: 13,
            goldenCases: 900,
            failures: [{ source: 'banco', description: 'respeita STRICT: não lançou' }],
        });

        expect(log).toBe('[contrato] FALHOU sqlite=3.53.3 banco=13 vetores=900 falhas=1\n[contrato] banco: respeita STRICT: não lançou');
    });
});
