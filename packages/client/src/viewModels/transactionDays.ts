import { Currency, LocalDate, Money, type MoneyResponse } from '@finance/core';
import { formatDayMonth } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import type { TransactionTable, TransactionTableRow } from './transactionTable.ts';

/*
 * A lista de Transações do celular (mockup `MobileTransacoes`): as mesmas linhas da tabela do
 * desktop (`buildTransactionTable`), agrupadas por dia, com Entradas, Saídas e Resultado no topo.
 * Fica no `client` para que os totais sigam a mesma regra do resultado da tabela do desktop.
 */

/** Abreviação dos dias da semana, de segunda (1) a domingo (7), como o `dayOfWeek` ISO. */
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'] as const;

/** Um dia da lista, com as linhas daquele dia. */
export interface TransactionDay {
    /** `YYYY-MM-DD`, ou `—` para a fatura paga sem dia gravado. */
    readonly key: string;
    /** `Seg, 12/10`, ou `Sem data` para a fatura paga sem dia gravado. */
    readonly label: string;
    readonly rows: readonly TransactionTableRow[];
}

/** Entradas, saídas e resultado das linhas visíveis. */
export interface TransactionTotals {
    /** `+R$ 9.523,90`. */
    readonly incoming: string;
    /** `−R$ 3.243,22`. */
    readonly outgoing: string;
    /** `+R$ 6.280,68`; o mesmo resultado do resumo da tabela. */
    readonly result: string;
}

/**
 * @param date Data `YYYY-MM-DD`.
 * @return `Seg, 12/10` — o título de cada dia na lista do celular.
 * @throws {InvalidValueError} Quando o texto não é uma data válida.
 */
export function formatWeekdayDayMonth(date: string): string {
    return `${WEEKDAYS[LocalDate.parse(date).dayOfWeek() - 1] ?? ''}, ${formatDayMonth(date)}`;
}

/**
 * Agrupa as linhas por dia, na ordem da tabela (por data). A linha da fatura paga sem dia
 * gravado tem data `—` e fica num grupo "Sem data" na posição em que a tabela a ordenou, no fim
 * do mês do extrato em que foi paga.
 *
 * @param table Tabela de Transações já filtrada.
 * @return Os dias com as linhas de cada um.
 */
export function groupTransactionsByDay(table: TransactionTable): readonly TransactionDay[] {
    const days: { key: string; label: string; rows: TransactionTableRow[] }[] = [];
    for (const row of table.rows) {
        const key = row.date === '—' ? '—' : row.dueDate;
        const last = days.at(-1);
        if (last !== undefined && last.key === key) {
            last.rows.push(row);
        } else {
            days.push({ key, label: key === '—' ? 'Sem data' : formatWeekdayDayMonth(row.dueDate), rows: [row] });
        }
    }
    return days;
}

/**
 * Entradas e saídas das linhas visíveis, separadas pelo sinal do efeito.
 * Regra de negócio (Transações): conta as mesmas linhas do resultado — as transferências e os
 * investimentos dentro do perfil ficam de fora, porque só movem dinheiro entre contas do próprio
 * perfil —, para que entradas mais saídas deem sempre o resultado.
 *
 * @param table Tabela de Transações já filtrada.
 * @return Os três totais formatados; `null` quando a tabela não tem linhas.
 */
export function transactionTotals(table: TransactionTable): TransactionTotals | null {
    if (table.result === null) {
        return null;
    }
    const currency = Currency.of(table.result.currency);
    let incoming = Money.zero(currency);
    let outgoing = Money.zero(currency);
    for (const row of table.rows) {
        if (row.direction === 'transfer') {
            continue;
        }
        const amount = Money.of(row.amount.amount, currency);
        if (row.amount.amount > 0) {
            incoming = incoming.add(amount);
        } else {
            outgoing = outgoing.add(amount);
        }
    }
    return { incoming: formatMoney(toResponse(incoming.rounded()), 'always'), outgoing: formatMoney(toResponse(outgoing.rounded()), 'always'), result: formatMoney(table.result, 'always') };
}

/**
 * @param money Valor do domínio.
 * @return O valor no formato dos DTOs, que os formatadores recebem.
 */
function toResponse(money: Money): MoneyResponse {
    return { amount: money.amount, currency: money.currency.code };
}
