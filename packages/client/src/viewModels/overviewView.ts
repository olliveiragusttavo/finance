import type {
    AccountInPeriodResponse,
    AccountListResponse,
    CreditCardInPeriodResponse,
    CreditCardListResponse,
    NoteResponse,
} from '@finance/core';
import { formatAccountType } from '../format/account.ts';
import { formatDayMonth } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { summarizeNote } from '../format/note.ts';
import { formatInvoiceAmount } from './invoiceView.ts';

/*
 * Visão geral pronta para a tela (mockup `Main`, D2; e o `MobileInicio` do celular;
 * desktop-mvp-plan Fase 10): os indicadores de saldo e os resumos de contas, cartões e
 * anotações. Fica no `client`, e não na tela, porque o celular mostra
 * os mesmos números com as mesmas frases (desktop-shell-design §4.2).
 */

/**
 * Tom do valor de um indicador, que a tela converte em token:
 * - `strong`: o número principal (consolidado);
 * - `projected`: o previsto, com peso menor (decisão de interface 6 dos mockups).
 */
export type OverviewKpiTone = 'strong' | 'projected';

/** Um indicador do topo da Visão geral. */
export interface OverviewKpi {
    readonly label: string;
    readonly value: string;
    readonly sub: string;
    readonly tone: OverviewKpiTone;
}

/**
 * Os indicadores do topo. Eram cinco no mockup; receitas, despesas e faturas em aberto saíram com
 * os relatórios fixos (reports-design, Fase 15), e o que restou não depende de relatório.
 */
export interface OverviewKpis {
    readonly consolidated: OverviewKpi;
    readonly projected: OverviewKpi;
}

/**
 * @param count Quantidade.
 * @param singular Palavra no singular.
 * @param pluralForm Palavra no plural.
 * @return `1 conta`, `3 contas`.
 */
function plural(count: number, singular: string, pluralForm: string): string {
    return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Monta os indicadores de saldo. O consolidado e o previsto vêm do total da lista de contas
 * porque é o mesmo número do rodapé da tela Contas: as duas telas nunca podem discordar sobre o
 * saldo do mês.
 * Regra de negócio (Contas): o total soma só as contas com "considerar no saldo", e a contagem
 * do subtítulo conta as mesmas (database-design §4.4).
 *
 * @param accounts Contas do perfil no mês de referência, com o total.
 * @return Os indicadores formatados.
 */
export function overviewKpis(accounts: AccountListResponse): OverviewKpis {
    const counted = accounts.accounts.filter((account) => account.considerBalance).length;
    return {
        consolidated: {
            label: 'Saldo consolidado',
            value: formatMoney(accounts.total.consolidated),
            sub: `Já pago/recebido · ${plural(counted, 'conta', 'contas')}`,
            tone: 'strong',
        },
        projected: {
            label: 'Saldo previsto',
            value: formatMoney(accounts.total.projected),
            sub: 'Fim do mês, com tudo lançado',
            tone: 'projected',
        },
    };
}

/** Uma conta no resumo de contas. */
export interface OverviewAccountRow {
    readonly accountId: string;
    readonly name: string;
    /** `Corrente`, ou `Corrente · fora do total`. */
    readonly detail: string;
    readonly consolidated: string;
    /** `previsto R$ 1.870,40`; `null` na conta fora do total, que mostra só o consolidado. */
    readonly projected: string | null;
    /** A conta fora do total aparece apagada (mockup). */
    readonly outsideTotal: boolean;
    readonly disabled: boolean;
}

/**
 * Resumo de contas, na ordem da tela Contas.
 * Regra de negócio (Contas): a conta com "considerar no saldo" desligado não entra no total e
 * aparece apagada e só com o consolidado, como na lista de Contas (database-design §4.4). A
 * desativada continua, porque o histórico e os saldos não mudam (desktop-mvp-plan §5.1).
 *
 * @param accounts Contas do perfil no mês de referência.
 * @return Uma linha por conta.
 */
export function overviewAccountRows(accounts: readonly AccountInPeriodResponse[]): readonly OverviewAccountRow[] {
    return accounts.map((account) => {
        const outsideTotal = !account.considerBalance;
        return {
            accountId: account.id,
            name: account.name,
            detail: outsideTotal ? `${formatAccountType(account.type)} · fora do total` : formatAccountType(account.type),
            consolidated: formatMoney(account.balances.consolidated),
            projected: outsideTotal ? null : `previsto ${formatMoney(account.balances.projected)}`,
            outsideTotal,
            disabled: account.disabled,
        };
    });
}

/** Situação da fatura do mês na etiqueta do resumo de cartões. */
export interface OverviewInvoiceStatus {
    readonly text: 'Em aberto' | 'Paga';
    /** `warn` em aberto e `ok` paga, como as etiquetas do mockup. */
    readonly tone: 'warn' | 'ok';
}

/** Um cartão no resumo de cartões. */
export interface OverviewCardRow {
    readonly creditCardId: string;
    readonly name: string;
    /** `vence 10/10 · paga com Nubank`. */
    readonly detail: string;
    /** `null` no mês sem fatura: não há o que estar paga nem em aberto. */
    readonly status: OverviewInvoiceStatus | null;
    /** Valor a pagar em módulo; `—` sem fatura no mês. */
    readonly amount: string;
    readonly disabled: boolean;
}

/**
 * Resumo de cartões com a fatura do mês de referência, a mesma da lista de Cartões.
 * Regra de negócio (Fatura): a fatura está paga ou em aberto (database-design §4.7); a
 * competência sem lançamentos não tem fatura, e o resumo mostra só o vencimento.
 *
 * @param creditCards Cartões do perfil no mês de referência.
 * @param accounts Contas do perfil, desativadas incluídas, para nomear a conta que paga cada
 * cartão.
 * @return Uma linha por cartão.
 */
export function overviewCardRows(creditCards: CreditCardListResponse, accounts: readonly AccountInPeriodResponse[]): readonly OverviewCardRow[] {
    const names = new Map(accounts.map((account) => [account.id, account.name]));
    return creditCards.creditCards.map((creditCard) => cardRow(creditCard, names.get(creditCard.accountId)));
}

/**
 * @param creditCard Cartão com a fatura do mês.
 * @param payerName Nome da conta pagadora; ausente se a conta não veio na lista.
 * @return A linha do cartão.
 */
function cardRow(creditCard: CreditCardInPeriodResponse, payerName: string | undefined): OverviewCardRow {
    const cycle = creditCard.invoiceOfMonth;
    const due = `vence ${formatDayMonth(cycle.dueDate)}`;
    return {
        creditCardId: creditCard.id,
        name: creditCard.name,
        detail: payerName === undefined ? due : `${due} · paga com ${payerName}`,
        status: cycle.invoice === null ? null : cycle.invoice.status === 'open' ? { text: 'Em aberto', tone: 'warn' } : { text: 'Paga', tone: 'ok' },
        amount: formatInvoiceAmount(cycle),
        disabled: creditCard.disabled,
    };
}

/** Uma anotação no bloco da Visão geral: só o título, que leva a ela na tela Anotações. */
export interface OverviewNoteRow {
    readonly noteId: string;
    /** A primeira linha da anotação (decisão de interface 9 dos mockups). */
    readonly title: string;
}

/** O bloco de anotações da Visão geral. */
export interface OverviewNotes {
    readonly rows: readonly OverviewNoteRow[];
    /** Quantas ficaram de fora do bloco; o link "Ver todas" diz o total. */
    readonly hiddenCount: number;
}

/**
 * Quantas anotações o bloco mostra: as mais recentes, para o bloco ter a altura dos vizinhos
 * mesmo num perfil com dezenas delas; as outras estão a um clique, na tela Anotações.
 */
export const OVERVIEW_NOTES_LIMIT = 6;

/**
 * Anotações da Visão geral (desktop-mvp-plan Fase 13.2): só os títulos, das mais recentes para as
 * mais antigas — a ordem em que o núcleo as lista —, para que se ache a anotação sem abrir
 * Anotações; o texto inteiro fica no editor, para onde cada título leva.
 *
 * @param notes Anotações do perfil, da mais recente para a mais antiga.
 * @param limit Quantas mostrar.
 * @return Os títulos mostrados e quantos ficaram de fora.
 */
export function overviewNotes(notes: readonly NoteResponse[], limit: number = OVERVIEW_NOTES_LIMIT): OverviewNotes {
    return {
        rows: notes.slice(0, limit).map((note) => ({ noteId: note.id, title: summarizeNote(note.text).title })),
        hiddenCount: Math.max(0, notes.length - limit),
    };
}
