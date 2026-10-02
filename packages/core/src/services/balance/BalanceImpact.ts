import type { AccountId, InvoiceId } from '../../domain/shared/ids.ts';
import { YearMonth } from '../../domain/shared/YearMonth.ts';

/**
 * O que uma escrita obriga a recalcular: faturas cujo total mudou e, por conta, o mês a
 * partir do qual a cadeia de fechamentos precisa ser refeita. É imutável e acumulável
 * porque uma edição toca o estado **antigo e o novo** — uma transação que muda de
 * contêiner precisa recalcular os dois, e recalcular só o novo é um dos bugs previstos
 * (backend-design §5.1).
 */
export class BalanceImpact {
    /**
     * @param invoices Faturas cujo total precisa ser refeito.
     * @param accounts Primeiro mês a recalcular, por conta.
     */
    private constructor(
        public readonly invoices: ReadonlySet<InvoiceId>,
        public readonly accounts: ReadonlyMap<AccountId, YearMonth>,
    ) {
        Object.freeze(this);
    }

    /**
     * @return Um impacto vazio, ponto de partida da acumulação.
     */
    public static none(): BalanceImpact {
        return new BalanceImpact(new Set(), new Map());
    }

    /**
     * @param invoiceId Fatura cujo total mudou.
     * @return Um novo impacto incluindo a fatura.
     */
    public withInvoice(invoiceId: InvoiceId): BalanceImpact {
        return new BalanceImpact(new Set([...this.invoices, invoiceId]), this.accounts);
    }

    /**
     * Inclui uma conta guardando o **menor** mês: o fechamento de um mês depende de todos os
     * anteriores, então recalcular a partir do mais antigo cobre os dois estados.
     *
     * @param accountId Conta afetada.
     * @param from Primeiro mês afetado.
     * @return Um novo impacto incluindo a conta.
     */
    public withAccount(accountId: AccountId, from: YearMonth): BalanceImpact {
        const current = this.accounts.get(accountId);
        const accounts = new Map(this.accounts);
        accounts.set(accountId, current === undefined ? from : YearMonth.min(current, from));
        return new BalanceImpact(this.invoices, accounts);
    }

    /**
     * @param other Impacto a somar.
     * @return A união dos dois, com o menor mês por conta.
     */
    public merge(other: BalanceImpact): BalanceImpact {
        let merged: BalanceImpact = new BalanceImpact(new Set([...this.invoices, ...other.invoices]), this.accounts);
        for (const [accountId, from] of other.accounts) {
            merged = merged.withAccount(accountId, from);
        }
        return merged;
    }
}
