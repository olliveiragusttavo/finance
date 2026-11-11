import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_HISTORY_OPTIONS, seedHistory } from '../test/support/HistorySeeder.ts';
import { openHistoryCore } from '../test/support/historyCore.ts';

/**
 * Gera o banco de dez anos da medição (mobile-mvp-plan, Fases 1 e 5) num arquivo SQLite que
 * o desktop abre e que vai para o celular por uma ação de build de desenvolvimento. Recusa
 * sobrescrever um arquivo existente porque o caminho pode ser, por engano, o banco real do
 * usuário. Termina com `integrity.verifyBalances`, para não entregar à medição um banco com
 * saldo divergente.
 *
 * @param argv Argumentos da linha de comando; o primeiro é o caminho do arquivo a criar.
 * @return O código de saída do processo.
 */
async function main(argv: readonly string[]): Promise<number> {
    const target = argv[0];
    if (target === undefined) {
        console.error('uso: pnpm db:history <arquivo.sqlite>');
        return 2;
    }
    const path = resolve(process.env['INIT_CWD'] ?? process.cwd(), target);
    if (existsSync(path)) {
        console.error(`${path} já existe; escolha outro caminho ou apague o arquivo antes.`);
        return 1;
    }
    const { core, clock, database } = openHistoryCore(path);
    try {
        const startedAt = performance.now();
        const summary = await seedHistory(core, clock, DEFAULT_HISTORY_OPTIONS);
        const report = await core.call('integrity.verifyBalances', {});
        if (!report.ok || report.data.drifts.length > 0) {
            console.error('o banco gerado tem saldo divergente:', JSON.stringify(report));
            return 1;
        }
        const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
        console.log(`${path}: ${summary.months} meses, ${summary.profiles} perfis, ${summary.transactions} lançamentos, ${summary.paidInvoices} faturas pagas (${seconds} s)`);
        return 0;
    } finally {
        database.close();
    }
}

process.exitCode = await main(process.argv.slice(2));
