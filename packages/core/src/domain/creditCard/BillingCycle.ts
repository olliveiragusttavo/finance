import { InvalidValueError } from '../shared/errors.ts';
import { LocalDate } from '../shared/LocalDate.ts';
import type { YearMonth } from '../shared/YearMonth.ts';

/**
 * Ciclo de faturamento de um cartão: dia de fechamento e dia de vencimento. Concentra as
 * regras de data do cartão num Value Object puro porque são elas que mais produzem
 * "números errados que parecem certos" — uma compra na fatura errada, o dia 31 em
 * fevereiro (backend-design §5.1).
 */
export class BillingCycle {
    /**
     * @param closingDay Dia do mês em que a fatura fecha, 1–31.
     * @param dueDay Dia do mês em que a fatura vence, 1–31.
     */
    private constructor(public readonly closingDay: number, public readonly dueDay: number) {
        Object.freeze(this);
    }

    /**
     * @param closingDay Dia de fechamento, como guardado em `credit_cards.closing_date`.
     * @param dueDay Dia de vencimento, como guardado em `credit_cards.due_date`.
     * @return O ciclo.
     * @throws {InvalidValueError} Quando algum dia está fora de 1–31.
     */
    public static of(closingDay: number, dueDay: number): BillingCycle {
        for (const [field, day] of [['closingDay', closingDay], ['dueDay', dueDay]] as const) {
            if (!Number.isInteger(day) || day < 1 || day > 31) {
                throw new InvalidValueError(field, `dia do mês fora de 1–31: ${day}`);
            }
        }
        return new BillingCycle(closingDay, dueDay);
    }

    /**
     * Regra de negócio (Cartão de crédito): dia inexistente vira o último dia do mês — um
     * cartão que fecha no dia 31 fecha em 30/04 e em 28 ou 29/02 (database-design §4.5).
     *
     * @param invoicePeriod Competência da fatura.
     * @return A data em que a fatura daquela competência fecha.
     */
    public closingDateOf(invoicePeriod: YearMonth): LocalDate {
        return LocalDate.clampedTo(invoicePeriod, this.closingDay);
    }

    /**
     * Fatura sugerida para uma compra.
     * Regra de negócio (Cartão de crédito): a fatura de um mês reúne as compras feitas
     * depois do fechamento anterior e antes do seu próprio fechamento, e **a compra feita no
     * dia do fechamento entra na fatura seguinte** (database-design §4.5). É só a sugestão:
     * o usuário pode escolher outra fatura, e a escolhida é a verdade (§4.7).
     *
     * @param purchaseDate Data da compra.
     * @return A competência da fatura sugerida.
     */
    public suggestedInvoicePeriod(purchaseDate: LocalDate): YearMonth {
        const closing = this.closingDateOf(purchaseDate.period);
        return purchaseDate.isBefore(closing) ? purchaseDate.period : purchaseDate.period.next();
    }

    /**
     * Vencimento de uma fatura.
     * Regra de negócio (Fatura): a fatura vence no primeiro dia `due_date` do cartão —
     * ajustado para o último dia em meses curtos — **depois** do fechamento dela. É esse
     * mês que recebe a fatura em aberto no saldo previsto (database-design §4.7).
     *
     * @param invoicePeriod Competência da fatura.
     * @return A data de vencimento; no mesmo mês do fechamento ou no seguinte.
     */
    public dueDateOf(invoicePeriod: YearMonth): LocalDate {
        const closing = this.closingDateOf(invoicePeriod);
        const sameMonth = LocalDate.clampedTo(invoicePeriod, this.dueDay);
        return closing.isBefore(sameMonth) ? sameMonth : LocalDate.clampedTo(invoicePeriod.next(), this.dueDay);
    }

    /**
     * Competência da fatura que vence num mês — o caminho inverso do `dueDateOf`. Existe para a
     * importação: o arquivo diz em que fatura a compra caiu pelo vencimento dela, e a fatura
     * escolhida é a verdade (database-design §4.7), mesmo quando a data da compra sugeriria outra.
     * Regra de negócio (Importação): a compra vai para a fatura que vence no mês do Vencimento da
     * linha (import-design §5.4).
     *
     * @param duePeriod Mês do vencimento informado.
     * @return A competência cujo vencimento cai nesse mês: a do próprio mês quando o cartão vence
     * depois de fechar no mesmo mês, senão a do mês anterior. No mês curto em que as duas ou
     * nenhuma vencem ali (fechamento e vencimento ajustados para o último dia), fica a anterior,
     * que é a regra dos meses comuns desse ciclo.
     */
    public invoicePeriodDueIn(duePeriod: YearMonth): YearMonth {
        return this.dueDateOf(duePeriod).period.equals(duePeriod) && !this.dueDateOf(duePeriod.previous()).period.equals(duePeriod)
            ? duePeriod
            : duePeriod.previous();
    }
}
