import type { AccountResponse, CategoryBranchResponse, CreditCardResponse, GoalContributionResponse, InvoiceDetailResponse, RecurrenceResponse, StatementResponse, TransactionResponse } from '@finance/core';
import { formatDayMonth, formatMonthAbbreviation } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { normalizeForSearch } from '../format/searchText.ts';
import type { InvoiceTable } from './invoiceView.ts';
import { formatRecurrenceTag } from './recurrenceView.ts';
import type { StatementDirection, StatementSituation, StatementTable } from './statementTable.ts';
import { TRANSACTION_SITUATIONS, type TransactionDirection, type TransactionSituation, type TransactionTableRow } from './transactionTable.ts';

/*
 * Lista única de movimentos (desktop-mvp-plan Fase 13.2): Transações, o extrato de uma conta e a
 * fatura de um cartão mostram linhas do mesmo jeito e com as mesmas ações — editar, marcar pago,
 * excluir, abrir a fatura. Cada tela continua com o próprio view-model, porque o valor quer dizer
 * coisas diferentes em cada uma (efeito no perfil, efeito nesta conta, quanto soma à fatura); este
 * módulo só traduz as três para a linha comum que a listagem desenha.
 */

/** Colunas da listagem; cada tela escolhe as que fazem sentido nela. */
export type MovementColumn = 'date' | 'name' | 'category' | 'container' | 'amount' | 'situation' | 'recurring';

/** Colunas que ordenam a listagem. */
export type MovementSortKey = Exclude<MovementColumn, 'recurring'>;

/** O que abrir a linha faz: editar o lançamento ou abrir a fatura em Cartões. */
export type MovementTarget =
    | {
          readonly kind: 'transaction';
          readonly transaction: TransactionResponse;
          /** Onde o lançamento está ("Nubank", "Roxinho · fat. nov"), para o subtítulo da edição. */
          readonly container: string | null;
          /**
           * Transferência recebida de outro perfil: quem edita, paga ou exclui é o perfil de
           * origem, dono da linha (database-design §4.13).
           */
          readonly readOnly: boolean;
          /**
           * Se marcar pago vale para a linha. Regra de negócio (Cartão, database-design §4.7): a
           * situação de uma compra no cartão é a da fatura; o pagamento parcial, que sai da conta
           * no dia dele, é a exceção.
           */
          readonly payable: boolean;
      }
    | { readonly kind: 'invoice'; readonly creditCardId: string; readonly period: string };

/** Destaque da situação. */
export type MovementSituationTone = 'warn' | 'muted' | 'plain';

/** A situação de uma linha, com o rótulo e o destaque. */
export interface MovementSituation {
    readonly text: string;
    readonly tone: MovementSituationTone;
    /** Posição na ordenação: o que ainda vai sair da conta primeiro (`TRANSACTION_SITUATIONS`). */
    readonly rank: number;
}

/** Cor do valor; o sinal e o `⇄` já dizem o sentido sem ela (decisão de interface 7). */
export type MovementTone = 'in' | 'out' | 'neutral';

/** Uma linha da listagem, com os textos prontos. */
export interface MovementRow {
    /** Chave da linha: o id da transação ou `invoice:<id>`. */
    readonly id: string;
    readonly target: MovementTarget;
    /** `YYYY-MM-DD` para ordenar; `null` quando o dia não é conhecido (fatura paga sem dia). */
    readonly sortDate: string | null;
    /** `08/10`. */
    readonly date: string;
    readonly name: string;
    /** Etiquetas depois do nome: "estorno", "pagamento parcial". */
    readonly badges: readonly string[];
    /** Complemento do nome: `→ Tesouro`, `de Nubank`; `null` sem complemento. */
    readonly detail: string | null;
    /** Fatura do link "ver fatura" no nome; `null` sem link. */
    readonly invoiceLink: { readonly creditCardId: string; readonly period: string } | null;
    /** `Alimentação › Mercado`. */
    readonly category: string;
    /** `Nubank`, `Roxinho · fat. nov`: a coluna "Conta / fatura" de Transações. */
    readonly container: string;
    /** Valor com sinal da coluna, para ordenar. */
    readonly amount: number;
    readonly amountText: string;
    readonly tone: MovementTone;
    /** `null` onde a situação não é da linha (os lançamentos da fatura). */
    readonly situation: MovementSituation | null;
    /** "3/12", "Fixa"; `null` num avulso. */
    readonly recurrenceTag: string | null;
    /** Linha que não é um lançamento (a fatura no extrato), em texto mais leve. */
    readonly muted: boolean;
}

/**
 * Regra de negócio (Transações): quem pode marcar pago. A transferência recebida de outro perfil é
 * de lá (database-design §4.13); a compra no cartão segue a fatura (§4.7), menos o pagamento
 * parcial, que é dinheiro que sai da conta no dia dele.
 *
 * @param transaction Lançamento da linha.
 * @param profileId Perfil aberto.
 * @return Se a linha é só para leitura neste perfil e se marcar pago vale para ela.
 */
export function movementPermissions(transaction: TransactionResponse, profileId: string): { readonly readOnly: boolean; readonly payable: boolean } {
    const readOnly = transaction.profileId !== profileId;
    const invoicePayment = transaction.container.kind === 'invoice' && transaction.destinationAccountId !== null;
    return { readOnly, payable: !readOnly && (transaction.container.kind === 'statement' || invoicePayment) };
}

/** Destaque das situações de Transações: o pendente e a fatura em aberto pesam; a compra na fatura, não. */
const TRANSACTION_TONES: Readonly<Record<TransactionSituation, MovementSituationTone>> = {
    pending: 'warn',
    onInvoice: 'muted',
    paid: 'plain',
    invoicePaid: 'plain',
};

/**
 * Linhas de Transações (`buildTransactionTable`), agrupadas por fatura ou uma a uma.
 *
 * @param rows Linhas da tabela, já filtradas.
 * @param profileId Perfil aberto, para as transferências recebidas de outro perfil.
 * @return As linhas da listagem, na mesma ordem.
 */
export function movementsFromTransactions(rows: readonly TransactionTableRow[], profileId: string): readonly MovementRow[] {
    return rows.map((row): MovementRow => {
        const common = {
            id: row.id,
            sortDate: row.dueDate,
            date: row.date,
            name: row.name,
            detail: null,
            invoiceLink: null,
            category: row.category,
            container: row.container,
            amount: row.amount.amount,
            amountText: row.amountText,
            tone: toneOf(row.direction),
            recurrenceTag: row.recurrenceTag,
            muted: false,
        };
        if (row.kind === 'invoice') {
            return {
                ...common,
                target: { kind: 'invoice', creditCardId: row.invoice.creditCardId, period: row.invoice.period },
                badges: [],
                // Na tabela agrupada, a fatura em aberto é o que ainda vai sair da conta.
                situation: { text: row.situationText, tone: row.situation === 'onInvoice' ? 'warn' : 'plain', rank: TRANSACTION_SITUATIONS.indexOf(row.situation) },
            };
        }
        return {
            ...common,
            target: { kind: 'transaction', transaction: row.transaction, container: row.container, ...movementPermissions(row.transaction, profileId) },
            badges: row.refund ? ['estorno'] : [],
            situation: { text: row.situationText, tone: TRANSACTION_TONES[row.situation], rank: TRANSACTION_SITUATIONS.indexOf(row.situation) },
        };
    });
}

/** Posição de cada situação do extrato na ordem de Transações. */
const STATEMENT_RANKS: Readonly<Record<StatementSituation, TransactionSituation>> = {
    pending: 'pending',
    invoiceOpen: 'onInvoice',
    paid: 'paid',
    invoicePaid: 'invoicePaid',
};

/**
 * Linhas do extrato de uma conta (`buildStatementTable`). O valor continua o efeito nesta conta.
 *
 * @param table Tabela do extrato.
 * @param statement Extrato, de onde vêm as transações inteiras para editar.
 * @param context Perfil aberto e as séries do perfil, para a coluna "Rec.".
 * @return As linhas da listagem, na ordem da data de caixa.
 */
export function movementsFromStatement(
    table: StatementTable,
    statement: StatementResponse,
    context: { readonly profileId: string; readonly recurrences: readonly RecurrenceResponse[] },
): readonly MovementRow[] {
    const transactions = new Map([...statement.transactions, ...statement.incomingTransfers].map((transaction) => [transaction.id, transaction]));
    const recurrences = new Map(context.recurrences.map((recurrence) => [recurrence.id, recurrence]));
    return table.rows.flatMap((row): MovementRow[] => {
        const transaction = row.transactionId === null ? undefined : transactions.get(row.transactionId);
        let target: MovementTarget;
        if (transaction !== undefined) {
            const container = row.kind === 'incomingTransfer' ? row.detail : statement.accountName;
            target = { kind: 'transaction', transaction, container, ...movementPermissions(transaction, context.profileId) };
        } else if (row.invoice !== null) {
            target = { kind: 'invoice', creditCardId: row.invoice.creditCardId, period: row.invoice.period };
        } else {
            return [];
        }
        const invoiceRow = target.kind === 'invoice';
        return [
            {
                id: row.key,
                target,
                sortDate: row.cashDate,
                date: row.date,
                name: row.name,
                badges: row.refund ? ['estorno'] : [],
                detail: row.detail,
                invoiceLink: row.invoice,
                category: row.category,
                container: statement.accountName,
                amount: row.amount.amount,
                amountText: row.amountText,
                tone: toneOf(row.direction),
                situation: { text: row.situationText, tone: row.situation === 'pending' || row.situation === 'invoiceOpen' ? 'warn' : 'plain', rank: TRANSACTION_SITUATIONS.indexOf(STATEMENT_RANKS[row.situation]) },
                recurrenceTag: transaction === undefined ? null : formatRecurrenceTag(transaction, transaction.recurrenceId === null ? undefined : recurrences.get(transaction.recurrenceId)),
                muted: invoiceRow,
            },
        ];
    });
}

/**
 * Lançamentos da fatura de um cartão (`buildInvoiceTable`). O valor continua o quanto soma à
 * fatura; a situação não é da linha — é a da fatura, mostrada acima da lista.
 *
 * @param table Tabela da fatura.
 * @param invoice Fatura, de onde vêm as transações inteiras para editar.
 * @param context Perfil aberto e as séries do perfil, para a coluna "Rec.".
 * @return As linhas da listagem, na ordem da data da compra.
 */
export function movementsFromInvoice(
    table: InvoiceTable,
    invoice: InvoiceDetailResponse,
    context: { readonly profileId: string; readonly recurrences: readonly RecurrenceResponse[] },
): readonly MovementRow[] {
    const transactions = new Map(invoice.transactions.map((transaction) => [transaction.id, transaction]));
    const recurrences = new Map(context.recurrences.map((recurrence) => [recurrence.id, recurrence]));
    const container = `${invoice.creditCardName} · fat. ${formatMonthAbbreviation(invoice.period)}`;
    return table.lines.flatMap((line): MovementRow[] => {
        const transaction = transactions.get(line.transactionId);
        if (transaction === undefined) {
            return [];
        }
        return [
            {
                id: line.key,
                target: { kind: 'transaction', transaction, container, ...movementPermissions(transaction, context.profileId) },
                sortDate: transaction.dueDate,
                date: line.date,
                name: line.name,
                badges: line.kind === 'refund' ? ['estorno'] : line.kind === 'payment' ? ['pagamento parcial'] : [],
                detail: line.detail,
                invoiceLink: null,
                category: line.category,
                container,
                amount: line.amount.amount,
                amountText: line.amountText,
                // O que abate a fatura é crédito; a compra fica na cor do texto, como na fatura do banco.
                tone: line.kind === 'purchase' ? 'neutral' : 'in',
                situation: null,
                recurrenceTag: formatRecurrenceTag(transaction, transaction.recurrenceId === null ? undefined : recurrences.get(transaction.recurrenceId)),
                muted: false,
            },
        ];
    });
}

/** O que a listagem das transações vinculadas a uma meta precisa para dar nome às linhas. */
export interface GoalContributionSource {
    readonly contributions: readonly GoalContributionResponse[];
    /** Todas as contas do perfil, desativadas incluídas: o histórico continua mostrando o nome. */
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
    readonly creditCards: readonly Pick<CreditCardResponse, 'id' | 'name'>[];
    readonly categories: readonly CategoryBranchResponse[];
    readonly recurrences: readonly RecurrenceResponse[];
    /** Perfil aberto, para as permissões da linha. */
    readonly profileId: string;
}

/**
 * Transações vinculadas a uma meta (mockup `DesktopMetas`) na listagem comum, para que se editem,
 * paguem e excluam ali como em Transações (pedido do usuário, desktop-mvp-plan Fase 13.3). Antes a
 * meta tinha uma tabela só de leitura. O valor é o que a transação soma à meta — o valor dela, sem
 * encargos —, e não o efeito na conta: a transferência para o Tesouro sai da corrente, mas entra
 * na meta. A retirada desconta, então aparece negativa, e a soma continua igual ao guardado.
 * A data é a do pagamento, a que conta no progresso.
 *
 * @param source Contribuições, os cadastros que dão nome às linhas e o perfil aberto.
 * @return As linhas, na ordem do núcleo (dia do pagamento); a situação fica de fora, porque só as
 * pagas contam.
 */
export function movementsFromGoalContributions(source: GoalContributionSource): readonly MovementRow[] {
    const accounts = new Map(source.accounts.map((account) => [account.id, account.name]));
    const creditCards = new Map(source.creditCards.map((creditCard) => [creditCard.id, creditCard.name]));
    const subCategories = new Map(source.categories.flatMap((category) => category.subCategories.map((sub) => [sub.id, `${category.name} › ${sub.name}`])));
    const recurrences = new Map(source.recurrences.map((recurrence) => [recurrence.id, recurrence]));
    return source.contributions.map(({ transaction, paidOn }): MovementRow => {
        const { container: owner, value } = transaction;
        const container = owner.kind === 'statement' ? accounts.get(owner.accountId) ?? '' : `${creditCards.get(owner.creditCardId) ?? ''} · fat. ${formatMonthAbbreviation(owner.period)}`;
        const amount = transaction.goalWithdrawal ? -value.amount : value.amount;
        const refund = !transaction.goalWithdrawal && value.amount < 0;
        return {
            id: transaction.id,
            target: { kind: 'transaction', transaction, container, ...movementPermissions(transaction, source.profileId) },
            sortDate: paidOn,
            date: formatDayMonth(paidOn),
            name: transaction.name,
            badges: transaction.goalWithdrawal ? ['retirada'] : refund ? ['estorno'] : [],
            detail: transaction.destinationAccountId === null ? null : `→ ${accounts.get(transaction.destinationAccountId) ?? ''}`,
            invoiceLink: null,
            category: subCategories.get(transaction.subCategoryId) ?? '',
            container,
            amount,
            amountText: formatMoney({ amount, currency: value.currency }),
            tone: amount < 0 ? 'out' : 'in',
            situation: null,
            recurrenceTag: formatRecurrenceTag(transaction, transaction.recurrenceId === null ? undefined : recurrences.get(transaction.recurrenceId)),
            muted: false,
        };
    });
}

/**
 * Comparador crescente de uma coluna da listagem; o decrescente é o inverso. É o mesmo critério do
 * `compareTransactionRows`: textos sem diferenciar maiúsculas nem acentos, valor com sinal e
 * situação pela ordem de `TRANSACTION_SITUATIONS`; o empate cai na data e depois no nome, para que
 * linhas iguais na coluna não troquem de lugar quando a lista se refaz.
 *
 * @param key Coluna da ordenação.
 * @return A função de comparação de duas linhas.
 */
export function compareMovementRows(key: MovementSortKey): (a: MovementRow, b: MovementRow) => number {
    const primary = MOVEMENT_COMPARATORS[key];
    return (a, b) => primary(a, b) || compareDates(a.sortDate, b.sortDate) || compareNames(a.name, b.name);
}

/** Comparação de cada coluna. */
const MOVEMENT_COMPARATORS: Readonly<Record<MovementSortKey, (a: MovementRow, b: MovementRow) => number>> = {
    date: (a, b) => compareDates(a.sortDate, b.sortDate),
    name: (a, b) => compareNames(a.name, b.name),
    category: (a, b) => compareNames(a.category, b.category),
    container: (a, b) => compareNames(a.container, b.container),
    amount: (a, b) => a.amount - b.amount,
    situation: (a, b) => (a.situation?.rank ?? 0) - (b.situation?.rank ?? 0),
};

/**
 * @param direction Sentido do valor no view-model de origem.
 * @return A cor do valor; transferência e linha sem sentido ficam na cor do texto.
 */
function toneOf(direction: TransactionDirection | StatementDirection): MovementTone {
    return direction === 'in' ? 'in' : direction === 'out' ? 'out' : 'neutral';
}

/**
 * @param a Primeira data `YYYY-MM-DD`, ou `null`.
 * @param b Segunda data, ou `null`.
 * @return Ordem cronológica, com as datas desconhecidas depois das conhecidas — como no extrato.
 */
function compareDates(a: string | null, b: string | null): number {
    if (a === null || b === null) {
        return a === b ? 0 : a === null ? 1 : -1;
    }
    return compareText(a, b);
}

/**
 * @param a Primeiro nome.
 * @param b Segundo nome.
 * @return Ordem sem diferenciar maiúsculas nem acentos; o texto original desempata, para que a
 * ordem seja total.
 */
function compareNames(a: string, b: string): number {
    return compareText(normalizeForSearch(a), normalizeForSearch(b)) || compareText(a, b);
}

/**
 * @param a Primeiro texto.
 * @param b Segundo texto.
 * @return Ordem por ponto de código, estável entre runtimes (o `localeCompare` depende do ICU).
 */
function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
