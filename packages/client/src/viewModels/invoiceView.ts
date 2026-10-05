import { LocalDate, YearMonth, type AccountResponse, type CategoryBranchResponse, type CreditCardResponse, type InvoiceCycleResponse, type InvoiceDetailResponse, type InvoiceResponse, type MoneyResponse } from '@finance/core';
import { formatDayMonth, formatMonthAbbreviation, formatMonthShort } from '../format/dates.ts';
import { formatMoney } from '../format/money.ts';
import { formatPercent } from '../format/percent.ts';

/*
 * Fatura do cartão pronta para a tela Cartões (mockup `DesktopCartoes`, e os `MobileCartoes`,
 * `MobileFatura` e `MobilePagarFatura` do celular): a situação de cada fatura, as próximas, os
 * lançamentos, o limite usado e as frases de pagar e reabrir. Fica no `client`, e não na tela,
 * porque o celular mostra as mesmas frases e a mesma conta (desktop-shell-design §4.2).
 */

/**
 * @param money Valor como veio do núcleo.
 * @return O valor com o sinal trocado; `0 - x` em vez de `-x` para o zero nunca virar `-0`.
 */
function negate(money: MoneyResponse): MoneyResponse {
    return { amount: 0 - money.amount, currency: money.currency };
}

/**
 * Situação da fatura do mês, a linha abaixo do nome do cartão na lista (mockup).
 * Regra de negócio (Fatura): a fatura está paga ou em aberto (database-design §4.7). A paga
 * mostra o dia do pagamento; sem o dia gravado (faturas pagas antes da migration `0003`), o
 * mês do extrato, porque inventar um dia mostraria uma data que não aconteceu.
 *
 * @param cycle Competência com as datas do ciclo e a fatura, se existir.
 * @return `Em aberto · vence 10/10`, `Paga em 07/10`, `Paga no extrato de out` ou, no mês em
 * que nada caiu, `Sem lançamentos · vence 10/10`.
 */
export function formatInvoiceSituation(cycle: InvoiceCycleResponse): string {
    const { invoice } = cycle;
    if (invoice === null) {
        return `Sem lançamentos · vence ${formatDayMonth(cycle.dueDate)}`;
    }
    if (invoice.status === 'open') {
        return `Em aberto · vence ${formatDayMonth(cycle.dueDate)}`;
    }
    return formatPaidInvoice(invoice);
}

/**
 * @param invoice Fatura paga.
 * @return `Paga em 07/10`, ou `Paga no extrato de out` quando o dia não foi gravado.
 */
function formatPaidInvoice(invoice: InvoiceResponse): string {
    if (invoice.paymentDate !== null) {
        return `Paga em ${formatDayMonth(invoice.paymentDate)}`;
    }
    return invoice.paidInPeriod === null ? 'Paga' : `Paga no extrato de ${formatMonthAbbreviation(invoice.paidInPeriod)}`;
}

/**
 * Valor da fatura na lista: o que falta pagar, em módulo (database-design §4.7).
 *
 * @param cycle Competência da fatura.
 * @return O valor a pagar; `—` no mês sem fatura, para não parecer uma fatura zerada.
 */
export function formatInvoiceAmount(cycle: InvoiceCycleResponse): string {
    return cycle.invoice === null ? '—' : formatMoney(cycle.invoice.amountDue, 'absolute');
}

/**
 * Fase de uma fatura no ciclo do cartão, que o mockup distingue em "Próximas faturas":
 * - `paid`: já paga;
 * - `closed`: fechou e espera o pagamento;
 * - `receiving`: é a que recebe as compras de hoje ("aberta");
 * - `future`: ainda não começou a receber compras ("futura") — só tem parcelas ou compras que
 *   o usuário pôs nela à mão.
 */
export type InvoiceStage = 'paid' | 'closed' | 'receiving' | 'future';

/**
 * Regra de negócio (Cartão de crédito): a fatura de um mês reúne as compras feitas a partir do
 * fechamento anterior e antes do seu próprio fechamento — a compra do dia do fechamento cai na
 * seguinte (database-design §4.5). A fatura que recebe as compras de hoje é, então, a que
 * fecha depois de hoje e cujo mês anterior fechou até hoje. O fechamento anterior vem do dia
 * de fechamento do cartão, com o mesmo ajuste para o último dia do mês do núcleo, e não da
 * fatura anterior, que pode nem existir.
 *
 * @param cycle Competência com as datas do ciclo.
 * @param closingDay Dia de fechamento do cartão.
 * @param today Data de hoje `YYYY-MM-DD`, no relógio do aparelho.
 * @return A fase da fatura hoje.
 */
export function invoiceStage(cycle: InvoiceCycleResponse, closingDay: number, today: string): InvoiceStage {
    if (cycle.invoice?.status === 'paid') {
        return 'paid';
    }
    const now = LocalDate.parse(today);
    if (!now.isBefore(LocalDate.parse(cycle.closingDate))) {
        return 'closed';
    }
    const previousClosing = LocalDate.clampedTo(YearMonth.parse(cycle.period).previous(), closingDay);
    return now.isBefore(previousClosing) ? 'future' : 'receiving';
}

/** Uma linha de "Próximas faturas deste cartão". */
export interface UpcomingInvoiceRow {
    /** Competência `YYYY-MM`, para abrir a fatura. */
    readonly period: string;
    /** `nov/2026 · aberta`, `dez/2026 · futura`, `nov/2026 · fechada · vence 10/11`, `nov/2026 · paga`. */
    readonly label: string;
    readonly stage: InvoiceStage;
    /** Valor a pagar em módulo. */
    readonly amountText: string;
}

/**
 * "Próximas faturas deste cartão" (mockup): as faturas depois da que está aberta na tela.
 * Só as que existem — o núcleo não devolve mês sem lançamento depois do pedido —, porque um
 * mês vazio no futuro não diz nada.
 *
 * @param cycles Saída de `invoices.listByCard`: a competência aberta na tela e as seguintes.
 * @param closingDay Dia de fechamento do cartão, para a fase de cada fatura.
 * @param today Data de hoje `YYYY-MM-DD`.
 * @return As linhas, em ordem cronológica; vazio quando não há fatura depois da aberta.
 */
export function buildUpcomingInvoices(cycles: readonly InvoiceCycleResponse[], closingDay: number, today: string): readonly UpcomingInvoiceRow[] {
    return cycles.slice(1).flatMap((cycle) => {
        if (cycle.invoice === null) {
            return [];
        }
        const stage = invoiceStage(cycle, closingDay, today);
        return [{ period: cycle.period, label: `${formatMonthShort(cycle.period)} · ${stageLabel(stage, cycle)}`, stage, amountText: formatMoney(cycle.invoice.amountDue, 'absolute') }];
    });
}

/**
 * @param stage Fase da fatura.
 * @param cycle Competência, para o vencimento da fatura fechada.
 * @return O rótulo do mockup em minúsculas, que vem depois do mês.
 */
function stageLabel(stage: InvoiceStage, cycle: InvoiceCycleResponse): string {
    switch (stage) {
        case 'paid':
            return 'paga';
        case 'closed':
            return `fechada · vence ${formatDayMonth(cycle.dueDate)}`;
        case 'receiving':
            return 'aberta';
        case 'future':
            return 'futura';
    }
}

/**
 * Natureza de um lançamento da fatura, para a etiqueta:
 * - `purchase`: compra (ou qualquer lançamento que aumenta a fatura);
 * - `refund`: estorno — despesa de valor negativo (database-design §4.13);
 * - `payment`: pagamento parcial — transferência na fatura vinda de uma conta (§4.7).
 */
export type InvoiceLineKind = 'purchase' | 'refund' | 'payment';

/** Um lançamento na tabela da fatura. */
export interface InvoiceLine {
    readonly key: string;
    readonly transactionId: string;
    readonly kind: InvoiceLineKind;
    /** Data da compra, `08/09`. */
    readonly date: string;
    readonly name: string;
    /** `de Nubank` no pagamento parcial; `null` nos demais. */
    readonly detail: string | null;
    /** `Compras › Eletrônicos`. */
    readonly category: string;
    /** Quanto o lançamento soma à fatura: positivo na compra, negativo no estorno e no pagamento. */
    readonly amount: MoneyResponse;
    /** `R$ 400,00`, `−R$ 23,90` ou `⇄ −R$ 300,00`. */
    readonly amountText: string;
}

/** A tabela de lançamentos da fatura. */
export interface InvoiceTable {
    readonly lines: readonly InvoiceLine[];
    /** Soma das linhas: o que falta pagar, negativo quando a fatura tem crédito. */
    readonly totalText: string;
}

/** A fatura e os cadastros que dão nome às contas e às subcategorias. */
export interface InvoiceTableSource {
    readonly invoice: InvoiceDetailResponse;
    /** Todas as contas do perfil, desativadas incluídas: o histórico continua mostrando o nome. */
    readonly accounts: readonly Pick<AccountResponse, 'id' | 'name'>[];
    readonly categories: readonly CategoryBranchResponse[];
}

/**
 * Monta a tabela de lançamentos da fatura (mockup `DesktopCartoes`), na ordem da data da compra.
 * Regra de negócio (Fatura): cada linha mostra quanto soma à fatura — o oposto do efeito na
 * conta, que o núcleo calcula com encargos e sinal (database-design §4.7 e §4.13) —, para que a
 * compra apareça positiva, como na fatura do banco, e a soma das linhas feche com o total a
 * pagar. O pagamento parcial entra como linha negativa com `⇄`: é dinheiro que já saiu da
 * conta e abate a fatura.
 *
 * @param source A fatura com os lançamentos e os cadastros para os nomes.
 * @return As linhas e o total.
 */
export function buildInvoiceTable(source: InvoiceTableSource): InvoiceTable {
    const accounts = new Map(source.accounts.map((account) => [account.id, account.name]));
    const subCategories = new Map(source.categories.flatMap((category) => category.subCategories.map((sub) => [sub.id, `${category.name} › ${sub.name}`])));
    // A data da compra é o `dueDate` do lançamento no cartão; ordena pelo texto ISO, que vira o
    // ano certo (compras de dezembro na fatura de janeiro), e não pelo `dd/mm` exibido.
    const lines = [...source.invoice.transactions]
        .sort((a, b) => compareText(a.dueDate, b.dueDate) || compareText(a.name, b.name))
        .map((transaction): InvoiceLine => {
            const amount = negate(transaction.originEffect);
            const kind: InvoiceLineKind =
                transaction.type === 'transference' || transaction.type === 'investment' ? 'payment' : transaction.type === 'expense' && transaction.value.amount < 0 ? 'refund' : 'purchase';
            const from = transaction.destinationAccountId === null ? undefined : accounts.get(transaction.destinationAccountId);
            return {
                key: transaction.id,
                transactionId: transaction.id,
                kind,
                date: formatDayMonth(transaction.dueDate),
                name: transaction.name,
                detail: kind === 'payment' && from !== undefined ? `de ${from}` : null,
                category: subCategories.get(transaction.subCategoryId) ?? '',
                amount,
                amountText: kind === 'payment' ? `⇄ ${formatMoney(amount)}` : formatMoney(amount),
            };
        });
    return { lines, totalText: formatMoney(negate(source.invoice.balance)) };
}

/**
 * @param a Primeiro texto.
 * @param b Segundo texto.
 * @return Ordem por ponto de código, estável entre runtimes (o `localeCompare` depende do ICU).
 */
function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Limite usado do cartão, como o mockup o mostra. */
export interface LimitUsage {
    /** `31%`; `—` no cartão sem limite. */
    readonly percentText: string;
    /** Proporção para a barra, limitada a 0–1; `null` no cartão sem limite. */
    readonly share: number | null;
    /** Se o valor a pagar passou do limite. */
    readonly exceeded: boolean;
    /** `de R$ 8.000,00`. */
    readonly limitText: string;
}

/**
 * Regra de negócio (Cartões, desktop-mvp-plan §5): o limite usado é o valor a pagar somado de
 * todas as faturas em aberto do cartão, que o núcleo entrega pronto em `limitUsed`; aqui só
 * vira proporção. Cartão com limite zero não tem proporção — dividir daria ∞ —, e a tela mostra
 * o traço.
 *
 * @param creditCard Limite e limite usado do cartão, como `creditCards.list` os devolve.
 * @return O percentual, a proporção da barra e o limite.
 */
export function describeLimitUsage(creditCard: Pick<CreditCardResponse, 'limit'> & { readonly limitUsed: MoneyResponse }): LimitUsage {
    const limitText = `de ${formatMoney(creditCard.limit)}`;
    if (creditCard.limit.amount <= 0) {
        return { percentText: '—', share: null, exceeded: creditCard.limitUsed.amount > 0, limitText };
    }
    const ratio = creditCard.limitUsed.amount / creditCard.limit.amount;
    return { percentText: formatPercent(ratio, { sign: 'negative', decimals: 0 }), share: Math.min(Math.max(ratio, 0), 1), exceeded: ratio > 1, limitText };
}

/** O que a confirmação do pagamento mostra (mockup `MobilePagarFatura`). */
export interface InvoicePaymentPreview {
    /** `A fatura vira paga no extrato de out/2026 da conta Nubank.` */
    readonly statement: string;
    /** `Saldo consolidado de Nubank no fim de out/2026: R$ 4.320,15 → R$ 1.870,40`; `null` sem o extrato. */
    readonly balanceChange: string | null;
}

/**
 * Explica o efeito de pagar antes da confirmação.
 * Regra de negócio (Fatura): pagar vincula a fatura ao extrato do mês do pagamento da conta
 * que quita o cartão; o valor entra no consolidado desse mês (database-design §4.7). O saldo
 * novo é o consolidado do fim do mês somado ao `balance` da fatura, que já tem o sinal do efeito
 * na conta e já desconta os pagamentos parciais — a conta que o núcleo vai fazer.
 *
 * @param params.invoice Fatura em aberto a pagar.
 * @param params.accountName Conta pagadora do cartão.
 * @param params.paymentDate Data escolhida `YYYY-MM-DD`.
 * @param params.closingConsolidated Consolidado no fim do mês do pagamento, do extrato da
 * conta; `null` enquanto ele carrega ou quando a data ainda não é válida.
 * @return As frases da confirmação.
 */
export function describeInvoicePayment(params: {
    readonly invoice: Pick<InvoiceResponse, 'balance'>;
    readonly accountName: string;
    readonly paymentDate: string;
    readonly closingConsolidated: MoneyResponse | null;
}): InvoicePaymentPreview {
    const month = formatMonthShort(LocalDate.parse(params.paymentDate).period.toString());
    const { closingConsolidated: before } = params;
    return {
        statement: `A fatura vira paga no extrato de ${month} da conta ${params.accountName}.`,
        balanceChange:
            before === null
                ? null
                : `Saldo consolidado de ${params.accountName} no fim de ${month}: ${formatMoney(before)} → ${formatMoney({ amount: before.amount + params.invoice.balance.amount, currency: before.currency })}`,
    };
}

/**
 * Texto da confirmação de reabrir.
 * Regra de negócio (Fatura): reabrir desfaz o pagamento — o valor sai do extrato onde tinha
 * sido pago e o saldo da conta volta como se o pagamento não tivesse acontecido; em aberto, a
 * fatura volta a pesar só no previsto, no mês do vencimento (database-design §4.7). Os
 * pagamentos parciais não mudam: são lançamentos próprios.
 *
 * @param params.invoice Fatura paga a reabrir.
 * @param params.accountName Conta pagadora do cartão.
 * @param params.dueDate Vencimento da fatura `YYYY-MM-DD`.
 * @return A frase do alerta.
 */
export function describeInvoiceReopening(params: { readonly invoice: Pick<InvoiceResponse, 'balance' | 'paidInPeriod'>; readonly accountName: string; readonly dueDate: string }): string {
    const { invoice } = params;
    const where = invoice.paidInPeriod === null ? `da conta ${params.accountName}` : `do extrato de ${formatMonthShort(invoice.paidInPeriod)} da conta ${params.accountName}`;
    const due = LocalDate.parse(params.dueDate);
    return (
        `O pagamento de ${formatMoney(invoice.balance, 'absolute')} sai ${where}, e o saldo dela volta como se ele não tivesse acontecido. ` +
        `A fatura volta a pesar só no saldo previsto de ${formatMonthShort(due.period.toString())}, no vencimento (${formatDayMonth(params.dueDate)}).`
    );
}
