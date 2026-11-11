import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { DEFAULT_HISTORY_OPTIONS, formatBenchmarkLog, historyPeriods, INTERACTIVE_P95_BUDGET_MS, runInteractiveBenchmark } from '../src/benchmark/index.ts';
import { createCore, openDatabase, parseUuid } from '../src/index.ts';
import { FixedClock } from '../test/support/adapters.ts';

/** Rodadas por operação: com 40, o p95 é a 38ª amostra, e não só o máximo. */
const ROUNDS = 40;

/**
 * Mede as chamadas interativas no Node sobre o banco de dez anos (`pnpm db:history`): é a linha
 * de base do desktop, com o mesmo roteiro que o aparelho roda no Hermes (mobile-mvp-plan, Fase
 * 5), para que a diferença entre os dois seja do runtime e do aparelho, e não da medição.
 * Os ids novos são aleatórios porque o banco já tem os sequenciais do gerador. O relógio fica
 * no "hoje" do gerador, para os lançamentos caírem no último mês do histórico.
 *
 * @param argv Argumentos da linha de comando; o primeiro é o arquivo do banco.
 * @return O código de saída: 1 quando uma operação estoura o orçamento.
 */
async function main(argv: readonly string[]): Promise<number> {
    const target = argv[0];
    if (target === undefined) {
        console.error('uso: pnpm bench:core <arquivo.sqlite> (gere com pnpm db:history)');
        return 2;
    }
    const path = resolve(process.env['INIT_CWD'] ?? process.cwd(), target);
    if (!existsSync(path)) {
        console.error(`${path} não existe; gere com pnpm db:history ${target}`);
        return 2;
    }
    const periods = historyPeriods(DEFAULT_HISTORY_OPTIONS);
    const clock = new FixedClock(periods.today);
    const database = BetterSqliteDatabase.open(path);
    try {
        openDatabase(database, { backups: null, clock });
        const core = createCore({
            database,
            clock,
            ids: { random: () => parseUuid(randomUUID()) },
            onUnexpectedError: (error) => {
                throw error;
            },
        });
        const stats = await runInteractiveBenchmark(core, { ...periods, rounds: ROUNDS, now: () => performance.now() });
        console.log(formatBenchmarkLog(stats));
        return stats.every((item) => item.p95 <= INTERACTIVE_P95_BUDGET_MS) ? 0 : 1;
    } finally {
        database.close();
    }
}

process.exitCode = await main(process.argv.slice(2));
