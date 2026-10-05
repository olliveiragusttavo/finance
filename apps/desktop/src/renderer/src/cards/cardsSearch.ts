import type { CreditCardInPeriodResponse, CreditCardListResponse } from '@finance/core';
import { z } from 'zod';
import { parseShellSearch } from '../shell/referenceMonth.ts';

/*
 * Fatura aberta na tela Cartões (mockup `DesktopCartoes`; desktop-mvp-plan Fase 8). Os
 * parâmetros nasceram na Fase 7, porque o extrato da conta leva a uma fatura ("ver fatura").
 * Ficam na URL pelo mesmo motivo do mês de referência: voltar no histórico devolve a fatura que
 * estava aberta.
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

/**
 * Cartão cuja fatura a tela mostra. O cartão da URL pode não existir mais — excluído aqui
 * mesmo, ou em outro perfil depois da troca —, e então vale o primeiro, como na tela Contas.
 *
 * @param list Cartões do perfil no mês.
 * @param search Busca já validada.
 * @return O cartão da URL, ou o primeiro da lista; `null` quando o perfil não tem cartão.
 */
export function openCreditCard(list: CreditCardListResponse, search: CardsSearch): CreditCardInPeriodResponse | null {
    return list.creditCards.find((creditCard) => creditCard.id === search.card) ?? list.creditCards[0] ?? null;
}

/**
 * Competência da fatura aberta. Sem `invoice` na URL é a do mês de referência — a "fatura do
 * mês" da lista. Com ela, é a fatura pedida por um link ("ver fatura", "Próximas faturas"), que
 * pode ser de outro mês: a fatura de setembro paga em outubro aparece no extrato de outubro.
 *
 * @param search Busca já validada.
 * @param period Mês de referência.
 * @return A competência `YYYY-MM` da fatura que o detalhe mostra.
 */
export function openInvoicePeriod(search: CardsSearch, period: string): string {
    return search.invoice ?? period;
}

/** O que a tela leu da URL num render: o mês de referência e a fatura pedida. */
export interface CardsLocation {
    readonly period: string;
    readonly invoice: string | undefined;
}

/**
 * Diz se a fatura pedida pela URL deve sair dela. A barra do mês de referência troca só o
 * `period` e preserva o resto da busca; sem esta regra, `‹ ›` mudaria a lista e deixaria o
 * detalhe preso na fatura do link, sem relação com o mês escolhido. Só a troca do mês com a
 * mesma fatura conta: quando os dois mudam juntos é o histórico (voltar) ou um link levando a
 * uma fatura, e aí a URL é a escolha explícita.
 *
 * @param previous O que a tela leu no render anterior.
 * @param current O que a tela lê agora.
 * @return `true` quando a fatura da URL deve ser descartada e o detalhe voltar à fatura do mês.
 */
export function shouldDropInvoice(previous: CardsLocation, current: CardsLocation): boolean {
    return current.invoice !== undefined && previous.period !== current.period && previous.invoice === current.invoice;
}
