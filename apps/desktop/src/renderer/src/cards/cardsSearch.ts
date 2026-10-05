import { z } from 'zod';
import { parseShellSearch } from '../shell/referenceMonth.ts';

/*
 * Fatura aberta na tela Cartões (mockup `DesktopCartoes`). Os parâmetros existem desde a
 * Fase 7 porque o extrato da conta leva a uma fatura ("ver fatura"); a tela que os lê chega na
 * Fase 8. Ficam na URL pelo mesmo motivo do mês de referência: voltar no histórico devolve a
 * fatura que estava aberta.
 */

/** Parâmetros de busca próprios da tela Cartões. */
export interface CardsSearch {
    /** Cartão aberto. */
    readonly card?: string;
    /** Competência `YYYY-MM` da fatura aberta, que pode não ser a do mês de referência. */
    readonly invoice?: string;
}

/**
 * Valida a busca da URL. Cada parâmetro inválido é descartado sozinho: um cartão válido com
 * uma competência quebrada ainda abre o cartão.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Só os parâmetros com formato válido.
 */
export function parseCardsSearch(search: Readonly<Record<string, unknown>>): CardsSearch {
    const card = z.uuid().safeParse(search['card']);
    // A competência segue a mesma validação do mês de referência, inclusive a faixa de anos.
    const invoice = parseShellSearch({ period: search['invoice'] }).period;
    return {
        ...(card.success ? { card: card.data } : {}),
        ...(invoice === undefined ? {} : { invoice }),
    };
}
