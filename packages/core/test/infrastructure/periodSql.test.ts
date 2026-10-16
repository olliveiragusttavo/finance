import { describe, expect, it } from 'vitest';
import { BillingCycle } from '../../src/domain/creditCard/BillingCycle.ts';
import { invoiceDueKeySql, periodFromKey } from '../../src/infrastructure/sqlite/periodSql.ts';
import { YearMonth } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

describe('Mês de vencimento da fatura em SQL', () => {
    it('concorda com BillingCycle.dueDateOf para todo par de dias, em meses de 28 a 31 dias', () => {
        // O relatório decide o mês da fatura em aberto no SQL e o saldo previsto decide no
        // domínio; se discordarem, o relatório e o extrato põem a fatura em meses diferentes.
        const world = new TestWorld();
        const periods = [YearMonth.of(2026, 2), YearMonth.of(2028, 2), YearMonth.of(2026, 4), YearMonth.of(2026, 1), YearMonth.of(2026, 12)];
        const mismatches: string[] = [];
        for (const period of periods) {
            for (let closingDay = 1; closingDay <= 31; closingDay++) {
                for (let dueDay = 1; dueDay <= 31; dueDay++) {
                    const row = world.database.get(
                        `SELECT ${invoiceDueKeySql('i', 'c')} AS due_key
                        FROM (SELECT :year AS year, :month AS month) i, (SELECT :closingDay AS closing_date, :dueDay AS due_date) c`,
                        { year: period.year, month: period.month, closingDay, dueDay },
                    );
                    const sql = periodFromKey(Number(row?.['due_key'])).toString();
                    const domain = BillingCycle.of(closingDay, dueDay).dueDateOf(period).period.toString();
                    if (sql !== domain) {
                        mismatches.push(`${period.toString()} fecha ${closingDay} vence ${dueDay}: SQL ${sql}, domínio ${domain}`);
                    }
                }
            }
        }
        expect(mismatches).toEqual([]);
    });
});
