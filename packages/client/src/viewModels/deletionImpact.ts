import type { AccountDeletionImpactResponse, CreditCardDeletionImpactResponse } from '@finance/core';

/**
 * O alerta de exclusão em cadeia como a tela o mostra (desktop-mvp-plan §5.1): cada item que
 * some junto, já contado e escrito em pt-BR, e as outras contas cujo saldo muda.
 */
export interface DeletionWarning {
    /** Frases do que será apagado junto ("3 extratos mensais"); só os itens com contagem. */
    readonly items: readonly string[];
    /** Nomes das contas que continuam existindo e terão o saldo alterado. */
    readonly affectedAccounts: readonly string[];
}

/**
 * Concorda a frase com a contagem. Sem `Intl.PluralRules` de propósito: o `client` não usa
 * `Intl` (difere entre Chromium e Hermes), e o pt-BR só precisa distinguir 1 do resto.
 *
 * @param count Quantidade.
 * @param singular Frase para um item.
 * @param plural Frase para vários itens.
 * @return A contagem com a frase no número certo ("1 fatura", "3 faturas").
 */
function counted(count: number, singular: string, plural: string): string {
    return `${String(count)} ${count === 1 ? singular : plural}`;
}

/**
 * Monta o alerta da exclusão de conta. Regra de negócio (Contas, desktop-mvp-plan §5.1):
 * nada de aviso genérico — o alerta conta cada item da cadeia e nomeia as outras contas cujo
 * saldo vai mudar, porque uma transferência apagada mexe também na conta do outro lado e um
 * cartão apagado devolve à conta os pagamentos de fatura. Contagem zero não vira frase: "0
 * cartões" só alongaria o alerta sem dizer nada.
 *
 * @param impact Contagens devolvidas por `accounts.deletionImpact`.
 * @return As frases do que será apagado e as contas afetadas.
 */
export function describeAccountDeletion(impact: AccountDeletionImpactResponse): DeletionWarning {
    const items = [
        impact.statements > 0 ? counted(impact.statements, 'extrato mensal', 'extratos mensais') : null,
        impact.transactions > 0 ? counted(impact.transactions, 'lançamento da conta', 'lançamentos da conta') : null,
        impact.creditCards > 0 ? counted(impact.creditCards, 'cartão pago por ela', 'cartões pagos por ela') : null,
        impact.invoices > 0 ? counted(impact.invoices, impact.creditCards === 1 ? 'fatura desse cartão' : 'fatura desses cartões', impact.creditCards === 1 ? 'faturas desse cartão' : 'faturas desses cartões') : null,
        impact.cardTransactions > 0 ? counted(impact.cardTransactions, 'lançamento nas faturas', 'lançamentos nas faturas') : null,
        impact.incomingTransfers > 0
            ? counted(impact.incomingTransfers, 'transferência ou investimento recebido de outra conta', 'transferências e investimentos recebidos de outras contas')
            : null,
    ];
    return { items: items.filter((item) => item !== null), affectedAccounts: impact.affectedAccounts.map((account) => account.name) };
}

/**
 * Monta o alerta da exclusão de cartão. Regra de negócio (Cartões, desktop-mvp-plan §5.1): os
 * pagamentos parciais estão entre os lançamentos das faturas, mas são citados à parte porque
 * são eles que devolvem dinheiro à conta que pagou — é o motivo de a conta aparecer como
 * afetada.
 *
 * @param impact Contagens devolvidas por `creditCards.deletionImpact`.
 * @return As frases do que será apagado e as contas afetadas.
 */
export function describeCreditCardDeletion(impact: CreditCardDeletionImpactResponse): DeletionWarning {
    const transactions =
        impact.transactions === 0
            ? null
            : counted(impact.transactions, 'lançamento nas faturas', 'lançamentos nas faturas') +
              (impact.partialPayments > 0 ? `, incluindo ${counted(impact.partialPayments, 'pagamento parcial', 'pagamentos parciais')}` : '');
    const items = [impact.invoices > 0 ? counted(impact.invoices, 'fatura', 'faturas') : null, transactions];
    return { items: items.filter((item) => item !== null), affectedAccounts: impact.affectedAccounts.map((account) => account.name) };
}
