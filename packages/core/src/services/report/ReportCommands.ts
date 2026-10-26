import type { ReportFilterProps } from '../../domain/report/ReportFilter.ts';
import type { ReportLayoutProps } from '../../domain/report/ReportLayout.ts';
import type { ProfileId, ReportDefinitionId } from '../../domain/shared/ids.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';

/** Nome, filtro e formato de um relatório, como o editor os monta. */
export interface ReportContentCommand {
    readonly name: string;
    readonly filter: ReportFilterProps;
    readonly layout: ReportLayoutProps;
}

/** Relatório novo num perfil. */
export interface CreateReportCommand extends ReportContentCommand {
    readonly profileId: ProfileId;
}

/** Regravar um relatório existente. */
export interface UpdateReportCommand extends ReportContentCommand {
    readonly id: ReportDefinitionId;
}

/** Abrir um relatório salvo no mês de referência da tela. */
export interface RunReportCommand {
    readonly id: ReportDefinitionId;
    readonly period: YearMonth;
}

/** Rodar um filtro e um formato ainda não salvos — o resultado ao vivo do editor. */
export interface PreviewReportCommand {
    readonly profileId: ProfileId;
    readonly period: YearMonth;
    readonly filter: ReportFilterProps;
    readonly layout: ReportLayoutProps;
}
