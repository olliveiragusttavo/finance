import { defaultStatementRange, isValidStatementRange, type DailyStatementKind } from '@finance/client';
import { z } from 'zod';
import { currentPeriod } from '../shell/referenceMonth.ts';
import { parseTransactionsSearch, type TransactionsSearch } from '../transactions/transactionsSearch.ts';

/*
 * Estado do Extrato na URL (mockup `DesktopExtrato`). Os filtros são os de Transações, com os
 * mesmos parâmetros, para que "Lista" e "Tabela por dia" troquem de tela sem perder o filtro; o
 * período e o tipo são deste relatório. Ficam na URL pelo mesmo motivo dos filtros de Transações:
 * voltar no histórico devolve a tabela como estava.
 */

/** Parâmetros de busca do Extrato. */
export interface StatementSearch extends TransactionsSearch {
    /** Primeiro mês `YYYY-MM`. */
    readonly from?: string;
    /** Último mês `YYYY-MM`. */
    readonly to?: string;
    /** Filtro "Tipo"; ausente é "Tudo". */
    readonly kind?: Exclude<DailyStatementKind, 'all'>;
}

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const kindSchema = z.enum(['income', 'expense']);

/**
 * Valida a busca da URL. O período só vale inteiro: um "De" sem "Até", invertido ou maior que o
 * permitido cai no padrão, em vez de abrir doze consultas para um intervalo que a tela não oferece.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Os filtros de Transações válidos, o período quando ele é aceito e o tipo.
 */
export function parseStatementSearch(search: Readonly<Record<string, unknown>>): StatementSearch {
    const from = periodSchema.safeParse(search['from']);
    const to = periodSchema.safeParse(search['to']);
    const kind = kindSchema.safeParse(search['kind']);
    const range = from.success && to.success && isValidStatementRange(from.data, to.data) ? { from: from.data, to: to.data } : {};
    return { ...parseTransactionsSearch(search), ...range, ...(kind.success ? { kind: kind.data } : {}) };
}

/** Período resolvido do Extrato. */
export interface StatementRange {
    readonly from: string;
    readonly to: string;
}

/**
 * Regra de interface (mockup `DesktopExtrato`): o mês de referência vira o período neste relatório,
 * e os atalhos contam do mês corrente. Sem período na URL, valem os últimos 12 meses.
 *
 * @param search Busca validada.
 * @param now Instante atual, para o mês corrente no fuso do aparelho.
 * @return O período aberto.
 */
export function resolveStatementRange(search: StatementSearch, now: Date): StatementRange {
    return search.from !== undefined && search.to !== undefined ? { from: search.from, to: search.to } : defaultStatementRange(currentPeriod(now));
}
