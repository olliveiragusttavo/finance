import type { Database } from '@finance/core';
import { runDatabaseContract } from '@finance/core/contract';
import { diffGoldenVectors, readGoldenVectors, type GoldenDivergence, type GoldenVectors } from '@finance/core/golden';

/** Banco que o app de contrato consegue fechar depois de cada caso. */
export interface ClosableDatabase extends Database {
    close(): void;
}

/**
 * Um conjunto de vetores de ouro: o arquivo gerado no Node e a função que recalcula os mesmos
 * casos no runtime sob teste. O arquivo chega sem tipo confiável, porque vem do bundle.
 */
export interface GoldenSuite {
    /** Pacote dono dos vetores (`core`, `client`), para a falha dizer onde corrigir. */
    readonly name: string;
    readonly expected: unknown;
    readonly compute: () => GoldenVectors;
}

/** O que o app de contrato precisa receber da plataforma: o banco sob teste e os vetores. */
export interface ContractInputs {
    /** Abre um banco vazio; chamada uma vez por caso da suíte de contrato. */
    readonly openDatabase: () => ClosableDatabase;
    readonly goldenSuites: readonly GoldenSuite[];
}

/** Uma falha do contrato, já em texto para a tela e o log. */
export interface ContractFailure {
    /** `banco` ou `vetores:<pacote>`. */
    readonly source: string;
    readonly description: string;
}

/** Resultado único da execução (mobile-mvp-plan, Fase 3): passou, ou a lista do que divergiu. */
export interface ContractReport {
    readonly passed: boolean;
    readonly sqliteVersion: string;
    /** Quantos casos foram conferidos, para um resultado verde com zero casos não passar despercebido. */
    readonly databaseCases: number;
    readonly goldenCases: number;
    readonly failures: readonly ContractFailure[];
}

/**
 * Roda a suíte de contrato do `Database` e compara os vetores de ouro, e junta tudo num
 * resultado só (mobile-shell-design §8). Nada aqui lança: um vetor que nem calcula no Hermes
 * (uma regex sem suporte, por exemplo) vira falha da lista, e não um app que fecha sem dizer o
 * que faltou — o Maestro só consegue ler o que aparece na tela.
 *
 * @param inputs O banco sob teste e os vetores; o app passa o `expo-sqlite`, os testes o
 * `better-sqlite3`.
 * @return O resultado; `passed` só é `true` sem nenhuma falha e com casos conferidos.
 */
export function runContract(inputs: ContractInputs): ContractReport {
    const opened: ClosableDatabase[] = [];
    const openTracked = (): ClosableDatabase => {
        const database = inputs.openDatabase();
        opened.push(database);
        return database;
    };
    const sqliteVersion = readSqliteVersion(inputs.openDatabase);
    const databaseResults = runDatabaseContract(openTracked);
    const closeFailures = opened.flatMap(closeDatabase);
    const golden = inputs.goldenSuites.map(compareSuite);
    const failures: readonly ContractFailure[] = [
        ...databaseResults.flatMap((result) => (result.failure === null ? [] : [{ source: 'banco', description: `${result.name}: ${result.failure}` }])),
        ...closeFailures,
        ...golden.flatMap((suite) => suite.failures),
    ];
    const goldenCases = golden.reduce((total, suite) => total + suite.cases, 0);
    return {
        passed: failures.length === 0 && databaseResults.length > 0 && goldenCases > 0,
        sqliteVersion,
        databaseCases: databaseResults.length,
        goldenCases,
        failures,
    };
}

/**
 * Fechar também é contrato: o primeiro defeito que o app achou no emulador foi o `close`
 * lançando o erro de uma instrução que tinha falhado antes. Vira falha da lista, e não exceção,
 * para o app mostrar a causa em vez de fechar.
 *
 * @param database Banco aberto por um caso da suíte.
 * @return Vazia quando fechou; a falha quando o fechamento lançou.
 */
function closeDatabase(database: ClosableDatabase): readonly ContractFailure[] {
    try {
        database.close();
        return [];
    } catch (error: unknown) {
        return [{ source: 'banco', description: `fechar a conexão: ${error instanceof Error ? error.message : String(error)}` }];
    }
}

/**
 * @param openDatabase Fábrica do banco sob teste.
 * @return A versão do SQLite que o adaptador embarca, para o relatório dizer contra o que rodou;
 * `desconhecida` quando nem a consulta funciona (o contrato acusa a causa).
 */
function readSqliteVersion(openDatabase: () => ClosableDatabase): string {
    try {
        const database = openDatabase();
        try {
            const version = database.get('SELECT sqlite_version() AS version')?.['version'];
            return typeof version === 'string' ? version : 'desconhecida';
        } finally {
            database.close();
        }
    } catch {
        return 'desconhecida';
    }
}

/**
 * Recalcula um conjunto de vetores e compara com o arquivo. Isola a falha de cada conjunto para
 * que um erro nos formatadores do `client` não esconda o resultado do núcleo.
 *
 * @param suite Arquivo e cálculo de um pacote.
 * @return Quantos casos o arquivo tem e as falhas em texto.
 */
function compareSuite(suite: GoldenSuite): { readonly cases: number; readonly failures: readonly ContractFailure[] } {
    const source = `vetores:${suite.name}`;
    try {
        const expected = readGoldenVectors(suite.expected);
        const divergences = diffGoldenVectors(expected, suite.compute());
        const cases = Object.values(expected).reduce((total, group) => total + group.length, 0);
        return { cases, failures: divergences.map((divergence) => ({ source, description: describeDivergence(divergence) })) };
    } catch (error: unknown) {
        return { cases: 0, failures: [{ source, description: `não calculou: ${error instanceof Error ? error.message : String(error)}` }] };
    }
}

/**
 * @param divergence Caso que saiu diferente do Node.
 * @return Uma linha com o grupo, a entrada e os dois valores, que é o que se precisa para
 * reproduzir o caso no Vitest.
 */
function describeDivergence(divergence: GoldenDivergence): string {
    return `${divergence.group} ${JSON.stringify(divergence.input)}: Node ${JSON.stringify(divergence.expected)}, aqui ${JSON.stringify(divergence.actual)}`;
}

/**
 * Resume o resultado numa linha estável para o log do aparelho (`adb logcat`): no CI, quando o
 * Maestro falha, é o log que diz o que divergiu sem precisar de captura de tela.
 *
 * @param report Resultado da execução.
 * @return A linha de resumo, seguida de uma linha por falha.
 */
export function formatReportLog(report: ContractReport): string {
    const status = report.passed ? 'PASSOU' : 'FALHOU';
    const summary = `[contrato] ${status} sqlite=${report.sqliteVersion} banco=${report.databaseCases} vetores=${report.goldenCases} falhas=${report.failures.length}`;
    return [summary, ...report.failures.map((failure) => `[contrato] ${failure.source}: ${failure.description}`)].join('\n');
}
