import { InvalidValueError } from '../shared/errors.ts';
import type { AccountId, CategoryId, CreditCardId, GoalId, PartnerId, SubCategoryId, TagId } from '../shared/ids.ts';
import { MONEY_MAX_AMOUNT } from '../shared/Money.ts';
import type { YearMonth } from '../shared/YearMonth.ts';
import type { TransactionType } from '../transaction/TransactionType.ts';

/**
 * Data da transação que decide em que mês ela cai no relatório (reports-design F3):
 * - `payment`: `payment_date`; a transação em aberto não tem mês de pagamento e fica fora;
 * - `due`: `due_date` — o vencimento na conta, a data da compra no cartão;
 * - `created`: o dia, em UTC, do `created_at` — quando o registro entrou no app.
 */
export type ReportDateBasis = 'payment' | 'due' | 'created';

export const REPORT_DATE_BASES: readonly ReportDateBasis[] = ['payment', 'due', 'created'];

/** Situação de pagamento aceita pelo filtro (reports-design A7). */
export type ReportStatusFilter = 'all' | 'paid' | 'open';

export const REPORT_STATUS_FILTERS: readonly ReportStatusFilter[] = ['all', 'paid', 'open'];

/** Como as tags escolhidas se combinam (reports-design A4). */
export type ReportTagMatch = 'any' | 'all';

export const REPORT_TAG_MATCHES: readonly ReportTagMatch[] = ['any', 'all'];

/**
 * Regra de negócio (Relatórios, F2): a janela tem no máximo 36 meses — o mês final e até 35
 * anteriores. O limite existe para que um relatório salvo não vire, sem querer, uma varredura
 * do histórico inteiro a cada abertura, e para que o gráfico de linha continue legível.
 */
export const REPORT_MAX_PREVIOUS_MONTHS = 35;

/**
 * Mês final da janela (reports-design F1): o mês de referência da tela, que acompanha a
 * navegação, ou um mês fixo gravado na definição, que não acompanha.
 */
export type ReportPeriodAnchor =
    | { readonly kind: 'reference' }
    | { readonly kind: 'fixed'; readonly month: YearMonth };

/** Intervalo de tempo do filtro, como o usuário o escolhe. */
export interface ReportPeriod {
    readonly anchor: ReportPeriodAnchor;
    /** Quantos meses antes do mês final entram, de 0 a `REPORT_MAX_PREVIOUS_MONTHS`. */
    readonly previousMonths: number;
    readonly basis: ReportDateBasis;
}

/** Meses que um relatório cobre, inclusivos nas duas pontas. */
export interface ReportWindow {
    readonly from: YearMonth;
    readonly to: YearMonth;
}

/** Dados do filtro, ainda sem validar. Lista vazia não restringe (reports-design §2.2). */
export interface ReportFilterProps {
    readonly period: ReportPeriod;
    readonly types: readonly TransactionType[];
    readonly categoryIds: readonly CategoryId[];
    readonly subCategoryIds: readonly SubCategoryId[];
    readonly accountIds: readonly AccountId[];
    readonly creditCardIds: readonly CreditCardId[];
    readonly tagIds: readonly TagId[];
    readonly tagMatch: ReportTagMatch;
    readonly partnerIds: readonly PartnerId[];
    readonly goalIds: readonly GoalId[];
    readonly status: ReportStatusFilter;
    /** Valor mínimo, inclusivo, sobre o `value` com sinal; `null` sem limite. */
    readonly minValue: number | null;
    /** Valor máximo, inclusivo; `null` sem limite. */
    readonly maxValue: number | null;
}

/**
 * Quais transações entram num relatório (reports-design §2). É um Value Object, e não um objeto
 * solto, porque os invariantes — janela de até 36 meses, mínimo ≤ máximo, listas sem repetição —
 * precisam valer tanto na entrada da rota quanto no JSON lido do banco, e o lugar de garanti-los
 * uma vez só é aqui. Os valores-limite são números, e não `Money`: o filtro não conhece a moeda
 * do perfil, e o `value` gravado já está nela (database-design §4.13).
 */
export class ReportFilter implements ReportFilterProps {
    public readonly period: ReportPeriod;
    public readonly types: readonly TransactionType[];
    public readonly categoryIds: readonly CategoryId[];
    public readonly subCategoryIds: readonly SubCategoryId[];
    public readonly accountIds: readonly AccountId[];
    public readonly creditCardIds: readonly CreditCardId[];
    public readonly tagIds: readonly TagId[];
    public readonly tagMatch: ReportTagMatch;
    public readonly partnerIds: readonly PartnerId[];
    public readonly goalIds: readonly GoalId[];
    public readonly status: ReportStatusFilter;
    public readonly minValue: number | null;
    public readonly maxValue: number | null;

    /**
     * @param props Dados já validados por `create`; privado para que nenhum filtro escape da
     * validação.
     */
    private constructor(props: ReportFilterProps) {
        this.period = Object.freeze({ ...props.period });
        this.types = Object.freeze([...props.types]);
        this.categoryIds = Object.freeze([...props.categoryIds]);
        this.subCategoryIds = Object.freeze([...props.subCategoryIds]);
        this.accountIds = Object.freeze([...props.accountIds]);
        this.creditCardIds = Object.freeze([...props.creditCardIds]);
        this.tagIds = Object.freeze([...props.tagIds]);
        this.tagMatch = props.tagMatch;
        this.partnerIds = Object.freeze([...props.partnerIds]);
        this.goalIds = Object.freeze([...props.goalIds]);
        this.status = props.status;
        this.minValue = props.minValue;
        this.maxValue = props.maxValue;
        Object.freeze(this);
    }

    /**
     * Valida e normaliza o filtro. As listas perdem as repetições porque um id repetido não muda
     * o resultado, mas faria duas definições iguais parecerem diferentes na sincronização.
     *
     * @param props Filtro montado pela Request ou lido do JSON gravado.
     * @return O filtro validado.
     * @throws {InvalidValueError} Quando os meses anteriores saem de 0 a 35, um valor-limite sai da
     * faixa do dinheiro ou o mínimo passa do máximo.
     */
    public static create(props: ReportFilterProps): ReportFilter {
        const { previousMonths } = props.period;
        if (!Number.isInteger(previousMonths) || previousMonths < 0 || previousMonths > REPORT_MAX_PREVIOUS_MONTHS) {
            throw new InvalidValueError('previousMonths', `meses anteriores fora da faixa 0–${REPORT_MAX_PREVIOUS_MONTHS}: ${previousMonths}`);
        }
        requireAmount('minValue', props.minValue);
        requireAmount('maxValue', props.maxValue);
        if (props.minValue !== null && props.maxValue !== null && props.minValue > props.maxValue) {
            throw new InvalidValueError('maxValue', 'o valor máximo precisa ser maior ou igual ao mínimo');
        }
        return new ReportFilter({
            ...props,
            types: unique(props.types),
            categoryIds: unique(props.categoryIds),
            subCategoryIds: unique(props.subCategoryIds),
            accountIds: unique(props.accountIds),
            creditCardIds: unique(props.creditCardIds),
            tagIds: unique(props.tagIds),
            partnerIds: unique(props.partnerIds),
            goalIds: unique(props.goalIds),
        });
    }

    /**
     * Regra de negócio (Relatórios, F1 e F2): a janela termina no mês fixo da definição ou, sem
     * ele, no mês de referência, e volta os meses anteriores pedidos.
     *
     * @param reference Mês de referência da tela; ignorado quando a definição tem mês fixo, para
     * que "Ano de 2025" continue em 2025 enquanto o usuário navega.
     * @return Os meses cobertos, do mais antigo ao final.
     */
    public windowFor(reference: YearMonth): ReportWindow {
        const to = this.period.anchor.kind === 'fixed' ? this.period.anchor.month : reference;
        return { from: to.plusMonths(-this.period.previousMonths), to };
    }
}

/**
 * @param field Campo do filtro, para o erro apontar qual.
 * @param amount Valor-limite, ou `null` sem limite.
 * @return void
 * @throws {InvalidValueError} Quando o valor não é finito ou passa do teto do dinheiro.
 */
function requireAmount(field: string, amount: number | null): void {
    if (amount !== null && (!Number.isFinite(amount) || Math.abs(amount) > MONEY_MAX_AMOUNT)) {
        throw new InvalidValueError(field, `valor fora da faixa do dinheiro: ${amount}`);
    }
}

/**
 * @param values Lista com possíveis repetições.
 * @return A lista sem repetições, na ordem da primeira aparição.
 */
function unique<T>(values: readonly T[]): readonly T[] {
    return [...new Set(values)];
}
