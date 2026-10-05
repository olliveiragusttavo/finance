import { Currency, LocalDate, Money, originEffect, YearMonth } from '@finance/core';
import type { AccountResponse, CategoryBranchResponse, CreditCardResponse, InvoiceResponse, MoneyResponse, TransactionResponse } from '@finance/core';
import { formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { matchesAllTerms } from '../format/searchText.ts';
import { formatTransactionAmount, type TransactionDirection } from './transactionTable.ts';

/*
 * Regras de apresentação do formulário de lançamento (desktop-mvp-plan Fase 9; mockups
 * `DesktopTransacoes` e `MobileLancamento`). Ficam no `client` porque o celular terá o mesmo
 * formulário: o que se oferece em cada escolha e os avisos antes de salvar não podem divergir
 * entre os dois apps.
 */

/** Rótulos dos tipos, na ordem do seletor do mockup `MobileLancamento`. */
const TYPE_LABELS: Readonly<Record<TransactionResponse['type'], string>> = {
    expense: 'Despesa',
    income: 'Receita',
    transference: 'Transferência',
    investment: 'Investimento',
};

/** Tipos na ordem do seletor: despesa primeiro, o lançamento mais comum. */
export const TRANSACTION_TYPE_ORDER: readonly TransactionResponse['type'][] = ['expense', 'income', 'transference', 'investment'];

/**
 * @param type Tipo do lançamento.
 * @return O rótulo do seletor e do subtítulo do painel ("Despesa", "Transferência").
 */
export function formatTransactionType(type: TransactionResponse['type']): string {
    return TYPE_LABELS[type];
}

/** Uma conta ou um cartão oferecido como origem ou destino do lançamento. */
export interface SourceOption {
    readonly kind: 'account' | 'creditCard';
    readonly id: string;
    readonly name: string;
    /** Desativada, mas oferecida porque o lançamento editado já a usa. */
    readonly disabled: boolean;
}

/** Origens do lançamento, separadas como no campo "Conta ou cartão". */
export interface SourceOptions {
    readonly accounts: readonly SourceOption[];
    readonly creditCards: readonly SourceOption[];
}

/**
 * Contas e cartões que o lançamento pode usar como origem.
 * Regra de negócio (Contas e Cartões, desktop-mvp-plan §5.1): desativado some das escolhas de
 * lançamentos novos, mas o lançamento antigo que já está nele continua editável sem reativá-lo
 * — então a origem atual da edição aparece mesmo desativada, e o núcleo a aceita.
 *
 * @param params.accounts Contas do perfil, desativadas incluídas.
 * @param params.creditCards Cartões do perfil, desativados incluídos.
 * @param params.current Contêiner do lançamento editado; `null` num lançamento novo.
 * @return As contas e os cartões oferecidos, na ordem das listas do núcleo.
 */
export function transactionSourceOptions(params: {
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name' | 'disabled'>[];
    readonly creditCards: readonly Pick<CreditCardResponse, 'id' | 'name' | 'disabled'>[];
    readonly current: TransactionResponse['container'] | null;
}): SourceOptions {
    const { current } = params;
    const currentAccountId = current?.kind === 'statement' ? current.accountId : null;
    const currentCardId = current?.kind === 'invoice' ? current.creditCardId : null;
    return {
        accounts: selectable(params.accounts, currentAccountId).map((account) => ({ kind: 'account', id: account.id, name: account.name, disabled: account.disabled })),
        creditCards: selectable(params.creditCards, currentCardId).map((card) => ({ kind: 'creditCard', id: card.id, name: card.name, disabled: card.disabled })),
    };
}

/**
 * Contas oferecidas como destino de transferência ou investimento, com a mesma regra da origem
 * para as desativadas. A conta de origem fica de fora: o núcleo recusa a transferência para a
 * própria conta, que não moveria dinheiro nenhum.
 *
 * @param params.accounts Contas do perfil, desativadas incluídas.
 * @param params.originAccountId Conta de origem escolhida; `null` quando a origem é um cartão
 * ou ainda não foi escolhida.
 * @param params.currentDestinationId Destino do lançamento editado; `null` num novo.
 * @return As contas oferecidas.
 */
export function destinationAccountOptions(params: {
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name' | 'disabled'>[];
    readonly originAccountId: string | null;
    readonly currentDestinationId: string | null;
}): readonly SourceOption[] {
    return selectable(params.accounts, params.currentDestinationId)
        .filter((account) => account.id !== params.originAccountId)
        .map((account) => ({ kind: 'account', id: account.id, name: account.name, disabled: account.disabled }));
}

/**
 * @param items Contas ou cartões do perfil.
 * @param keepId O que o lançamento editado já usa; continua oferecido mesmo desativado.
 * @return Os ativos e o já usado.
 */
function selectable<T extends { readonly id: string; readonly disabled: boolean }>(items: readonly T[], keepId: string | null): readonly T[] {
    return items.filter((item) => !item.disabled || item.id === keepId);
}

/** Uma subcategoria na escolha do lançamento. */
export interface SubCategoryOption {
    readonly id: string;
    readonly categoryId: string;
    readonly categoryName: string;
    readonly name: string;
    /** `Alimentação › Mercado`, como na tabela. */
    readonly label: string;
}

/**
 * Subcategorias que casam com a busca do campo "Categoria" (desktop-mvp-plan Fase 9: subcategoria
 * com busca). A busca olha a categoria e a subcategoria juntas, para que "alim" mostre todas as
 * de Alimentação e "mercado" ache "Alimentação › Mercado".
 *
 * @param tree Árvore de categorias do perfil.
 * @param query Texto digitado; vazio devolve todas.
 * @return As subcategorias que casam, na ordem da árvore.
 */
export function subCategoryOptions(tree: readonly CategoryBranchResponse[], query: string): readonly SubCategoryOption[] {
    return tree
        .flatMap((category) =>
            category.subCategories.map((sub) => ({ id: sub.id, categoryId: category.id, categoryName: category.name, name: sub.name, label: `${category.name} › ${sub.name}` })),
        )
        .filter((option) => matchesAllTerms(query, option.label));
}

/** Uma fatura que a compra no cartão pode escolher. */
export interface InvoiceChoice {
    /** Competência `YYYY-MM`. */
    readonly period: string;
    /** `nov/2026 · sugerida`, `out/2026 · paga`. */
    readonly label: string;
    readonly suggested: boolean;
    /** A fatura em que o lançamento editado já está. */
    readonly current: boolean;
    /** Situação da fatura; `null` quando ela ainda não existe (nasce no lançamento). */
    readonly status: InvoiceResponse['status'] | null;
}

/**
 * Faturas oferecidas na troca ("Trocar" do mockup `MobileLancamento`): a anterior, a sugerida
 * e as duas seguintes — a compra lançada atrasada e a que o usuário prefere jogar para frente —,
 * mais a atual na edição.
 * Regra de negócio (Cartão de crédito, database-design §4.7): a sugestão é só sugestão; a
 * fatura escolhida é a verdade, e escolher uma paga a reabre.
 *
 * @param params.suggestedPeriod Competência sugerida pela data da compra.
 * @param params.currentPeriod Fatura do lançamento editado no mesmo cartão; `null` num novo.
 * @param params.invoices Faturas do cartão que já existem, para a situação de cada uma.
 * @return As faturas em ordem cronológica.
 */
export function invoiceChoices(params: {
    readonly suggestedPeriod: string;
    readonly currentPeriod: string | null;
    readonly invoices: readonly Pick<InvoiceResponse, 'period' | 'status'>[];
}): readonly InvoiceChoice[] {
    const suggested = YearMonth.parse(params.suggestedPeriod);
    const around = [suggested.previous(), suggested, suggested.next(), suggested.next().next()].map((period) => period.toString());
    const periods = [...new Set(params.currentPeriod === null ? around : [...around, params.currentPeriod])].sort();
    const statusOf = new Map(params.invoices.map((invoice) => [invoice.period, invoice.status]));
    return periods.map((period) => {
        const status = statusOf.get(period) ?? null;
        const isSuggested = period === params.suggestedPeriod;
        const isCurrent = period === params.currentPeriod;
        const notes = [isCurrent ? 'atual' : null, isSuggested ? 'sugerida' : null, status === 'paid' ? 'paga' : null].filter((note) => note !== null);
        return {
            period,
            label: [formatMonthShort(period), ...notes].join(' · '),
            suggested: isSuggested,
            current: isCurrent,
            status,
        };
    });
}

/**
 * Aviso de que salvar vai reabrir a fatura escolhida (desktop-mvp-plan Fase 9).
 * Regra de negócio (Cartão de crédito, database-design §4.7): lançar numa fatura paga a reabre —
 * o pagamento sai do extrato da conta pagadora e a fatura volta ao previsto do vencimento. Na
 * edição que mantém a fatura atual nada é reaberto, e não há aviso.
 *
 * @param params.invoice Fatura escolhida, como o núcleo a conhece; `null` quando ainda não existe.
 * @param params.current Se é a fatura em que o lançamento editado já está.
 * @param params.payingAccountName Conta pagadora do cartão.
 * @return A frase do aviso, ou `null` quando salvar não reabre nada.
 */
export function invoiceReopenWarning(params: {
    readonly invoice: Pick<InvoiceResponse, 'period' | 'status' | 'paidInPeriod'> | null;
    readonly current: boolean;
    readonly payingAccountName: string;
}): string | null {
    const { invoice } = params;
    if (invoice === null || invoice.status !== 'paid' || params.current) {
        return null;
    }
    const statement = invoice.paidInPeriod === null ? `da conta ${params.payingAccountName}` : `do extrato de ${formatMonthShort(invoice.paidInPeriod)} da conta ${params.payingAccountName}`;
    return `A fatura de ${formatMonthShort(invoice.period)} já está paga. Ao salvar, ela será reaberta: o pagamento sai ${statement}, e a fatura precisa ser paga de novo.`;
}

/**
 * Aviso de que salvar recalcula os meses seguintes (desktop-mvp-plan Fase 9).
 * Regra de negócio (Saldos, database-design §4.6): o saldo final de um mês é o inicial do
 * seguinte, então mexer num mês passado refaz a cadeia de saldos até hoje — e os números que o
 * usuário já conferia nos meses seguintes mudam. Vale para o mês de onde o lançamento sai e para
 * o mês para onde ele vai.
 *
 * @param params.before Mês em que o lançamento editado pesa hoje; `null` num lançamento novo.
 * @param params.after Mês em que ele vai pesar com o que está no formulário; `null` enquanto a
 * data não é válida.
 * @param params.today Hoje, `YYYY-MM-DD`.
 * @return A frase do aviso, ou `null` quando nenhum dos meses é passado.
 */
export function recalculationNotice(params: { readonly before: string | null; readonly after: string | null; readonly today: string }): string | null {
    const current = LocalDate.parse(params.today).period;
    const past = [params.before, params.after]
        .filter((period) => period !== null)
        .map((period) => YearMonth.parse(period))
        .filter((period) => period.isBefore(current))
        .sort((a, b) => a.compare(b));
    const earliest = past[0];
    return earliest === undefined ? null : `Este lançamento mexe em ${formatMonthShort(earliest.toString())}, um mês passado: ao salvar, os saldos dos meses seguintes são recalculados.`;
}

/** Prévia do valor no formulário, como a tabela vai mostrá-lo. */
export interface TransactionValuePreview {
    /** `−R$ 487,32`, `+R$ 23,90` ou `⇄ R$ 500,00`. */
    readonly text: string;
    readonly direction: TransactionDirection;
    /** Despesa com valor negativo: a linha leva a etiqueta "estorno". */
    readonly refund: boolean;
}

/**
 * Prévia do efeito do lançamento enquanto o usuário digita (o valor grande com sinal do mockup
 * `MobileLancamento`), pela mesma regra de sinal do núcleo (`originEffect`): o tipo dá a
 * direção, o valor negativo a inverte e os encargos são sempre custo da origem.
 *
 * @param params.type Tipo escolhido.
 * @param params.value Valor com o sinal já aplicado (negativo no estorno).
 * @param params.charges Encargos; zero quando o campo está vazio.
 * @param params.currency Moeda do perfil.
 * @return O texto e o sentido do valor, como a linha da tabela.
 */
export function previewTransactionValue(params: {
    readonly type: TransactionResponse['type'];
    readonly value: number;
    readonly charges: number;
    readonly currency: string;
}): TransactionValuePreview {
    const currency = Currency.of(params.currency);
    const effect = originEffect(params.type, Money.of(params.value, currency), Money.of(params.charges, currency)).rounded();
    const money: MoneyResponse = { amount: effect.amount, currency: currency.code };
    return { ...formatTransactionAmount(params.type, money), refund: params.type === 'expense' && params.value < 0 };
}

/** Textos da confirmação de exclusão. */
export interface TransactionDeletionText {
    readonly title: string;
    readonly description: string;
}

/**
 * Confirmação de excluir um lançamento: diz de onde o valor sai e o que muda, em vez de um aviso
 * genérico (brief §4, regra 9).
 * Regra de negócio (Fatura, database-design §4.7): excluir o pagamento parcial devolve o valor à
 * fatura e à conta que pagou. Regra de negócio (Saldos): excluir de um extrato recalcula a conta
 * dali em diante; numa transferência, as duas contas.
 *
 * @param params.transaction Lançamento a excluir.
 * @param params.accounts Contas do perfil, desativadas incluídas, para os nomes.
 * @param params.creditCards Cartões do perfil, desativados incluídos, para os nomes.
 * @return O título e a frase do alerta.
 */
export function describeTransactionDeletion(params: {
    readonly transaction: TransactionResponse;
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
    readonly creditCards: readonly Pick<CreditCardResponse, 'id' | 'name'>[];
}): TransactionDeletionText {
    const { transaction } = params;
    const { container } = transaction;
    const accountName = (id: string | null): string => params.accounts.find((account) => account.id === id)?.name ?? 'conta excluída';
    const amount = formatMoney(transaction.value, 'absolute');
    const month = formatMonthShort(container.period);
    const destination = transaction.destinationAccountId === null ? null : accountName(transaction.destinationAccountId);
    const title = `Excluir “${transaction.name}”?`;
    if (container.kind === 'invoice') {
        const card = params.creditCards.find((creditCard) => creditCard.id === container.creditCardId)?.name ?? 'cartão excluído';
        const description =
            destination !== null && transaction.value.amount < 0
                ? `O pagamento parcial de ${amount} sai da fatura de ${month} do cartão ${card}: o valor volta a pesar na fatura e retorna à conta ${destination}.`
                : `O lançamento de ${amount} sai da fatura de ${month} do cartão ${card}, e o total da fatura muda.`;
        return { title, description };
    }
    const accounts = destination === null ? `da conta ${accountName(container.accountId)}` : `das contas ${accountName(container.accountId)} e ${destination}`;
    return { title, description: `O lançamento de ${amount} sai do extrato de ${month}, e os saldos ${accounts} são recalculados desse mês em diante.` };
}
