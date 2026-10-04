import { YearMonth } from '@finance/core';
import { z } from 'zod';

/*
 * Mês de referência global (desktop-mvp-plan Fase 4; decisão de interface 2 dos mockups). Fica
 * na URL como *search param* `period`, e não num estado do React, para que voltar e avançar no
 * histórico devolvam o mês junto com a tela e para que um link de outra tela ("ver fatura")
 * possa levar o mês que quer abrir.
 */

/** Parâmetros de busca do shell: o que toda tela dentro dele herda da URL. */
export interface ShellSearch {
    /** Mês `YYYY-MM`; ausente quando a URL não fixou um, e então vale o padrão do aparelho. */
    readonly period?: string;
}

/** Mesmo formato que o núcleo aceita nas rotas por período. */
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/**
 * Valida a busca da URL. A URL é editável (e pode vir de um histórico antigo), então um mês
 * inválido é descartado em vez de derrubar a rota: a tela cai no mês padrão, que é o que o
 * usuário esperaria de um link quebrado.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Só o mês, quando ele é válido; nada mais passa adiante.
 */
export function parseShellSearch(search: Readonly<Record<string, unknown>>): ShellSearch {
    const parsed = periodSchema.safeParse(search['period']);
    if (!parsed.success || !isSupportedYear(parsed.data)) {
        return {};
    }
    return { period: parsed.data };
}

/**
 * @param period Mês `YYYY-MM` já no formato certo.
 * @return Se o ano está na faixa que o núcleo aceita (`YearMonth`); fora dela, toda rota
 * recusaria o mês com erro de validação.
 */
function isSupportedYear(period: string): boolean {
    try {
        YearMonth.parse(period);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param now Instante atual, no fuso do aparelho.
 * @return O mês corrente `YYYY-MM`. Usa o calendário local, e não UTC, porque "o mês atual"
 * é o do relógio de parede do usuário: em UTC, a noite do último dia já seria o mês seguinte
 * no Brasil.
 */
export function currentPeriod(now: Date): string {
    return YearMonth.of(now.getFullYear(), now.getMonth() + 1).toString();
}

/**
 * Decide o mês aberto. A URL vem primeiro porque é a escolha explícita (navegação, link de
 * outra tela); depois o último mês aberto neste aparelho, para reabrir onde o usuário parou;
 * por fim o mês corrente.
 *
 * @param search Busca validada da URL.
 * @param lastPeriod Último mês aberto, das preferências do aparelho; `null` se nunca houve.
 * @param today Mês corrente.
 * @return O mês de referência `YYYY-MM`.
 */
export function resolveReferenceMonth(search: ShellSearch, lastPeriod: string | null, today: string): string {
    return search.period ?? lastPeriod ?? today;
}

/**
 * @param period Mês `YYYY-MM`.
 * @param direction `-1` para o anterior, `1` para o seguinte.
 * @return O mês vizinho, com a virada de ano resolvida pelo `YearMonth`.
 * @throws {InvalidValueError} Ao sair da faixa de anos do núcleo (antes de 1900 ou depois de 9999).
 */
export function shiftPeriod(period: string, direction: -1 | 1): string {
    const month = YearMonth.parse(period);
    return (direction === 1 ? month.next() : month.previous()).toString();
}
