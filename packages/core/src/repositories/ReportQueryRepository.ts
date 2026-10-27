import type { ReportFilter, ReportWindow } from '../domain/report/ReportFilter.ts';
import type { ReportDimension } from '../domain/report/ReportLayout.ts';
import type { ReportAggregateRow } from '../domain/report/ReportResult.ts';
import type { ProfileId } from '../domain/shared/ids.ts';

/** O que uma consulta de relatório recorta: o perfil, o filtro e os meses já resolvidos. */
export interface ReportQueryScope {
    readonly profileId: ProfileId;
    readonly filter: ReportFilter;
    readonly window: ReportWindow;
    /**
     * Somar o efeito no saldo de cada movimento (entrada positiva, saída negativa) em vez do
     * `value` gravado (reports-design L8); vale em toda consulta do relatório, inclusive nas de
     * total, em que a dimensão de entrada e saída não está.
     */
    readonly flow: boolean;
}

/** Cadastros que o filtro de um relatório referencia por id (reports-design §2.2). */
export type ReportReferenceKind = 'category' | 'subCategory' | 'account' | 'creditCard' | 'tag' | 'partner' | 'goal';

/**
 * Leitura das somas dos relatórios. Só lê: a agregação fica no SQL (backend-design §3.2), e
 * o Repository monta a consulta a partir de listas fechadas de filtros e dimensões — nenhum
 * trecho de SQL vem da definição.
 */
export interface ReportQueryRepository {
    /**
     * @param scope Perfil, filtro e meses.
     * @param dimensions Dimensões do agrupamento, de zero (o total geral) a duas.
     * @return Uma linha por combinação de grupos com ao menos uma transação, com a soma do
     * `value` e a quantidade; sem dimensão, uma linha só (zerada quando nada entra no filtro).
     */
    aggregate(scope: ReportQueryScope, dimensions: readonly ReportDimension[]): readonly ReportAggregateRow[];

    /**
     * @param profileId Perfil que precisa ser o dono.
     * @param kind Cadastro referenciado.
     * @param ids Ids pedidos no filtro.
     * @return Os ids, entre os pedidos, que existem, estão vivos e são do perfil.
     */
    liveReferences(profileId: ProfileId, kind: ReportReferenceKind, ids: readonly string[]): ReadonlySet<string>;
}
