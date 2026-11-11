import { isValidPeriod } from '@finance/client';

// O mês corrente, a data de hoje e o mês vizinho são regras comuns ao celular e moram no `client`.
export { currentDate, currentPeriod, shiftPeriod } from '@finance/client';

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

/**
 * Valida a busca da URL. A URL é editável (e pode vir de um histórico antigo), então um mês
 * inválido é descartado em vez de derrubar a rota: a tela cai no mês padrão, que é o que o
 * usuário esperaria de um link quebrado.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Só o mês, quando ele é válido; nada mais passa adiante.
 */
export function parseShellSearch(search: Readonly<Record<string, unknown>>): ShellSearch {
    const period = search['period'];
    return typeof period === 'string' && isValidPeriod(period) ? { period } : {};
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
