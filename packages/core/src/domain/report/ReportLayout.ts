import { BusinessRuleViolation } from '../shared/errors.ts';

/**
 * Como o resultado aparece (reports-design L1): a tabela é sempre agrupada, e a pizza mostra a
 * participação de cada grupo da dimensão principal no todo.
 */
export type ReportFormat = 'table' | 'bar' | 'line' | 'pie';

export const REPORT_FORMATS: readonly ReportFormat[] = ['table', 'bar', 'line', 'pie'];

/**
 * Por o que o relatório agrupa as transações (reports-design L3). `source` é a origem — a conta do
 * extrato ou o cartão da fatura —, `month` usa a data escolhida no filtro (F3), `recurrence`
 * separa as fixas, as parceladas e as avulsas (L6) e `flow`, o que entra e o que sai das contas (L8).
 */
export type ReportDimension = 'month' | 'type' | 'category' | 'subCategory' | 'source' | 'tag' | 'partner' | 'status' | 'recurrence' | 'flow';

export const REPORT_DIMENSIONS: readonly ReportDimension[] = ['month', 'type', 'category', 'subCategory', 'source', 'tag', 'partner', 'status', 'recurrence', 'flow'];

/**
 * Grupo de um movimento na dimensão de entrada e saída (reports-design L8): se ele soma ao saldo
 * das contas do perfil ou subtrai dele, qualquer que seja o tipo.
 */
export type ReportFlowGroup = 'in' | 'out';

/** Ordem fixa dos grupos de entrada e saída: o que entra antes do que sai. */
export const REPORT_FLOW_GROUPS: readonly ReportFlowGroup[] = ['in', 'out'];

/**
 * Grupo de uma transação na dimensão de recorrência (reports-design L6). Não há grupo "sem": a
 * transação que não veio de uma série é a avulsa, um grupo de verdade, que a tela rotula.
 */
export type ReportRecurrenceGroup = 'fixed' | 'installments' | 'single';

/** Ordem fixa dos grupos de recorrência: o compromisso que se repete antes do pontual. */
export const REPORT_RECURRENCE_GROUPS: readonly ReportRecurrenceGroup[] = ['fixed', 'installments', 'single'];

/** O número de cada grupo (reports-design L4): a soma do `value` ou a quantidade de lançamentos. */
export type ReportMeasure = 'sum' | 'count';

export const REPORT_MEASURES: readonly ReportMeasure[] = ['sum', 'count'];

/** Dados do formato, ainda sem validar. */
export interface ReportLayoutProps {
    readonly format: ReportFormat;
    /** Linhas da tabela, ou eixo do gráfico. */
    readonly primary: ReportDimension;
    /** Colunas da tabela, ou séries do gráfico; `null` sem segundo agrupamento. */
    readonly secondary: ReportDimension | null;
    readonly measure: ReportMeasure;
    /**
     * Mostrar a análise do resultado (reports-design L9): a informação a mais que cada
     * configuração ganha, como o resultado de entradas menos saídas.
     */
    readonly analysis: boolean;
}

/**
 * Formato de um relatório (reports-design §3). Tabela e gráfico têm a mesma forma — uma dimensão
 * principal e uma secundária opcional —, e por isso trocar de um para o outro não pede outra
 * configuração: só muda como a mesma grade aparece.
 */
export class ReportLayout implements ReportLayoutProps {
    public readonly format: ReportFormat;
    public readonly primary: ReportDimension;
    public readonly secondary: ReportDimension | null;
    public readonly measure: ReportMeasure;
    public readonly analysis: boolean;

    /**
     * @param props Dados já validados por `create`.
     */
    private constructor(props: ReportLayoutProps) {
        this.format = props.format;
        this.primary = props.primary;
        this.secondary = props.secondary;
        this.measure = props.measure;
        this.analysis = props.analysis;
        Object.freeze(this);
    }

    /**
     * Regra de negócio (Relatórios, L5): principal e secundária não podem ser a mesma dimensão —
     * agrupar duas vezes pela mesma coisa só preenche a diagonal da grade.
     * Regra de negócio (Relatórios, L7): a pizza não tem dimensão secundária — um círculo só
     * divide um todo, e a segunda divisão sumiria do gráfico sem aviso.
     *
     * @param props Formato montado pela Request ou lido do JSON gravado.
     * @return O formato validado.
     * @throws {BusinessRuleViolation} `report-dimensions-repeated` quando as duas dimensões são iguais.
     * @throws {BusinessRuleViolation} `report-pie-secondary` quando a pizza traz dimensão secundária.
     */
    public static create(props: ReportLayoutProps): ReportLayout {
        if (props.secondary === props.primary) {
            throw new BusinessRuleViolation('report-dimensions-repeated', 'a dimensão secundária repete a principal', { field: 'secondary' });
        }
        if (props.format === 'pie' && props.secondary !== null) {
            throw new BusinessRuleViolation('report-pie-secondary', 'o gráfico de pizza não tem dimensão secundária', { field: 'secondary' });
        }
        return new ReportLayout(props);
    }

    /**
     * @return As dimensões do agrupamento, a principal primeiro; uma ou duas.
     */
    public dimensions(): readonly ReportDimension[] {
        return this.secondary === null ? [this.primary] : [this.primary, this.secondary];
    }

    /**
     * Regra de negócio (Relatórios, L8): com entrada e saída numa das divisões, a soma passa a ser
     * o efeito no saldo — positivo na entrada, negativo na saída —, também nos totais em que essa
     * divisão não aparece, para que o total da linha seja o líquido da linha.
     *
     * @return `true` quando entrada e saída é uma das dimensões.
     */
    public measuresFlow(): boolean {
        return this.primary === 'flow' || this.secondary === 'flow';
    }
}
