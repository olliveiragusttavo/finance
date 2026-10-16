import { TAG_REPORT_RANGES, type TagReportRange } from '@finance/core';
import { z } from 'zod';

/*
 * Tag aberta e período do relatório por tag (mockup `DesktopRelTag`; desktop-mvp-plan Fase 12.2).
 * Ficam na URL, como o nível aberto do relatório por categoria, para que voltar no histórico
 * devolva a tag e o período que estavam abertos.
 */

/** Período quando a URL não diz: "Todo o período", o primeiro do seletor do mockup. */
export const DEFAULT_TAG_RANGE: TagReportRange = 'all';

/** Parâmetros de busca próprios do relatório por tag. */
export interface TagReportSearch {
    /** Tag aberta; ausente abre a primeira da lista. */
    readonly tag?: string;
    /** Período; o padrão fica fora da URL. */
    readonly range?: TagReportRange;
}

const tagSchema = z.uuid();
const rangeSchema = z.enum(TAG_REPORT_RANGES);

/**
 * Valida a busca da URL. Cada parâmetro inválido é descartado sozinho, e o período padrão sai da
 * URL para que o mesmo relatório não tenha dois endereços.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Só os parâmetros com formato válido.
 */
export function parseTagReportSearch(search: Readonly<Record<string, unknown>>): TagReportSearch {
    const tag = tagSchema.safeParse(search['tag']);
    const range = rangeSchema.safeParse(search['range']);
    return {
        ...(tag.success ? { tag: tag.data } : {}),
        ...(range.success && range.data !== DEFAULT_TAG_RANGE ? { range: range.data } : {}),
    };
}

/**
 * Trocar o período mantém a tag aberta — se ela não tiver lançamento no novo período, a tela
 * abre a primeira (`openTag`) — e preserva o mês e o resto da URL.
 *
 * @param current Busca atual, crua.
 * @param range Período escolhido.
 * @return A busca nova, sem o período quando é o padrão.
 */
export function withTagRange(current: Readonly<Record<string, unknown>>, range: TagReportRange): Record<string, unknown> {
    return { ...current, range: range === DEFAULT_TAG_RANGE ? undefined : range };
}
