import { BusinessRuleViolation } from '../shared/errors.ts';

/** Como o resultado aparece (reports-design L1): a tabela é sempre agrupada. */
export type ReportFormat = 'table' | 'bar' | 'line';

export const REPORT_FORMATS: readonly ReportFormat[] = ['table', 'bar', 'line'];

/**
 * Por o que o relatório agrupa as transações (reports-design L3). `source` é a origem — a conta do
 * extrato ou o cartão da fatura —, e `month` usa a data escolhida no filtro (F3).
 */
export type ReportDimension = 'month' | 'type' | 'category' | 'subCategory' | 'source' | 'tag' | 'partner' | 'status';

export const REPORT_DIMENSIONS: readonly ReportDimension[] = ['month', 'type', 'category', 'subCategory', 'source', 'tag', 'partner', 'status'];

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

    /**
     * @param props Dados já validados por `create`.
     */
    private constructor(props: ReportLayoutProps) {
        this.format = props.format;
        this.primary = props.primary;
        this.secondary = props.secondary;
        this.measure = props.measure;
        Object.freeze(this);
    }

    /**
     * Regra de negócio (Relatórios, L5): principal e secundária não podem ser a mesma dimensão —
     * agrupar duas vezes pela mesma coisa só preenche a diagonal da grade.
     *
     * @param props Formato montado pela Request ou lido do JSON gravado.
     * @return O formato validado.
     * @throws {BusinessRuleViolation} `report-dimensions-repeated` quando as duas dimensões são iguais.
     */
    public static create(props: ReportLayoutProps): ReportLayout {
        if (props.secondary === props.primary) {
            throw new BusinessRuleViolation('report-dimensions-repeated', 'a dimensão secundária repete a principal', { field: 'secondary' });
        }
        return new ReportLayout(props);
    }

    /**
     * @return As dimensões do agrupamento, a principal primeiro; uma ou duas.
     */
    public dimensions(): readonly ReportDimension[] {
        return this.secondary === null ? [this.primary] : [this.primary, this.secondary];
    }
}
