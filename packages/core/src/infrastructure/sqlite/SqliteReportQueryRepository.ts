import type { ReportDateBasis, ReportFilter } from '../../domain/report/ReportFilter.ts';
import type { ReportDimension } from '../../domain/report/ReportLayout.ts';
import type { ReportAggregateRow, ReportGroup } from '../../domain/report/ReportResult.ts';
import type { ProfileId } from '../../domain/shared/ids.ts';
import type { Database, SqlRow, SqlValue } from '../../ports/Database.ts';
import type { ReportQueryRepository, ReportQueryScope, ReportReferenceKind } from '../../repositories/ReportQueryRepository.ts';
import { decodeEnum, TRANSACTION_TYPE_CODE } from './enumCodes.ts';
import { monthBounds } from './periodSql.ts';
import { RowReader } from './RowReader.ts';

/**
 * Transação paga em SQL, a mesma regra de `Transaction.isPaid`: `paid` e `payment_date` andam
 * juntos, e conferir os dois protege de uma linha em que só um deles foi gravado.
 */
const PAID_SQL = '(t.paid = 1 AND t.payment_date IS NOT NULL)';

/**
 * Data que decide o mês de cada transação, por base (reports-design F3). Na base de pagamento a
 * transação em aberto dá `NULL` e cai fora do `BETWEEN`; na de lançamento vale o dia UTC do
 * `created_at`, porque o núcleo não conhece o fuso do usuário.
 */
const DATE_SQL: Readonly<Record<ReportDateBasis, string>> = {
    payment: `(CASE WHEN ${PAID_SQL} THEN t.payment_date END)`,
    due: 't.due_date',
    created: 'substr(t.created_at, 1, 10)',
};

/**
 * Origem e perfil da transação. A conta vale para a transação de extrato e o cartão, para a de
 * fatura — o arco exclusivo íntegro é conferido, como no recálculo de saldos —, e o dono do
 * contêiner tem de ser o perfil. As categorias entram sempre, porque o filtro e duas dimensões
 * as usam; o nome de um cadastro excluído continua legível na linha excluída.
 */
const FROM_SQL = `
    FROM transactions t
    LEFT JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
    LEFT JOIN accounts a ON a.id = bs.account_id AND a.deleted_at IS NULL AND a.profile_id = :profileId
    LEFT JOIN invoices i ON i.id = t.invoice_id AND i.deleted_at IS NULL
    LEFT JOIN credit_cards c ON c.id = i.credit_card_id AND c.deleted_at IS NULL AND c.profile_id = :profileId
    LEFT JOIN transaction_sub_categories sc ON sc.id = t.sub_category_id
    LEFT JOIN transaction_categories cat ON cat.id = sc.category_id`;

/** Vínculos vivos com tags vivas; o mesmo recorte no filtro e na dimensão. */
const LIVE_TAG_LINKS_SQL = `
    SELECT tt.transaction_id, g.id AS tag_id, g.name AS tag_name
    FROM transactions_tags tt
    JOIN tags g ON g.id = tt.tag_id AND g.deleted_at IS NULL
    WHERE tt.deleted_at IS NULL`;

/** Como cada dimensão vira chave e rótulo no `SELECT`, e o que ela precisa juntar. */
interface DimensionSql {
    readonly key: string;
    /** `NULL` quando a tela escreve o rótulo. */
    readonly label: string;
    readonly join: string | null;
}

/**
 * Strategy por dimensão (reports-design L3): cada uma sabe a própria expressão de chave e de
 * rótulo. A tag e o sócio entram por `LEFT JOIN`, para que a transação sem eles caia no grupo
 * "sem" (chave `NULL`) em vez de sumir do relatório. O sócio precisa ser do perfil: na
 * transferência para outro perfil ele é do destino (database-design §4.13), e no relatório da
 * origem a linha fica sem sócio.
 *
 * @param dimension Dimensão pedida.
 * @param basis Base de data do filtro, que define o mês.
 * @param alias Prefixo dos aliases da junção, para que duas dimensões nunca colidam.
 * @return As expressões da dimensão.
 */
function dimensionSql(dimension: ReportDimension, basis: ReportDateBasis, alias: string): DimensionSql {
    switch (dimension) {
        case 'month':
            return { key: `substr(${DATE_SQL[basis]}, 1, 7)`, label: 'NULL', join: null };
        case 'type':
            return { key: 't.type', label: 'NULL', join: null };
        case 'category':
            return { key: 'sc.category_id', label: 'cat.name', join: null };
        case 'subCategory':
            return { key: 't.sub_category_id', label: 'sc.name', join: null };
        case 'source':
            return { key: 'COALESCE(a.id, c.id)', label: 'COALESCE(a.name, c.name)', join: null };
        case 'tag':
            return { key: `${alias}.tag_id`, label: `${alias}.tag_name`, join: `LEFT JOIN (${LIVE_TAG_LINKS_SQL}) ${alias} ON ${alias}.transaction_id = t.id` };
        case 'partner':
            return { key: `${alias}.id`, label: `${alias}.name`, join: `LEFT JOIN partners ${alias} ON ${alias}.id = t.partner_id AND ${alias}.deleted_at IS NULL AND ${alias}.profile_id = :profileId` };
        case 'status':
            return { key: `CASE WHEN ${PAID_SQL} THEN 'paid' ELSE 'open' END`, label: 'NULL', join: null };
    }
}

/** Como conferir a posse de cada cadastro do filtro: a tabela e o caminho até o perfil. */
const REFERENCE_SQL: Readonly<Record<ReportReferenceKind, string>> = {
    category: 'SELECT x.id FROM transaction_categories x WHERE x.deleted_at IS NULL AND x.profile_id = :profileId',
    subCategory: `SELECT x.id FROM transaction_sub_categories x
        JOIN transaction_categories p ON p.id = x.category_id AND p.deleted_at IS NULL
        WHERE x.deleted_at IS NULL AND p.profile_id = :profileId`,
    account: 'SELECT x.id FROM accounts x WHERE x.deleted_at IS NULL AND x.profile_id = :profileId',
    creditCard: 'SELECT x.id FROM credit_cards x WHERE x.deleted_at IS NULL AND x.profile_id = :profileId',
    tag: 'SELECT x.id FROM tags x WHERE x.deleted_at IS NULL AND x.profile_id = :profileId',
    partner: 'SELECT x.id FROM partners x WHERE x.deleted_at IS NULL AND x.profile_id = :profileId',
    goal: 'SELECT x.id FROM goals x WHERE x.deleted_at IS NULL AND x.profile_id = :profileId',
};

/** Implementação SQLite de `ReportQueryRepository`. */
export class SqliteReportQueryRepository implements ReportQueryRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     */
    public constructor(private readonly database: Database) {}

    /**
     * Monta uma consulta só, com o filtro no `WHERE` e as dimensões no `GROUP BY`. Toda parte
     * variável é parâmetro nomeado; o texto do SQL só muda entre as opções fechadas do filtro e
     * do formato.
     *
     * @param scope Perfil, filtro e meses.
     * @param dimensions Dimensões do agrupamento, de zero a duas.
     * @return Uma linha por combinação de grupos; sem dimensão, uma linha com o total geral.
     */
    public aggregate(scope: ReportQueryScope, dimensions: readonly ReportDimension[]): readonly ReportAggregateRow[] {
        const params = new SqlParamBag();
        params.set('profileId', scope.profileId);
        const where = filterSql(scope, params);
        const parts = dimensions.map((dimension, index) => dimensionSql(dimension, scope.filter.period.basis, `d${String(index)}`));
        const select = parts.flatMap((part, index) => [`${part.key} AS key${String(index)}`, `MAX(${part.label}) AS label${String(index)}`]);
        const joins = parts.flatMap((part) => (part.join === null ? [] : [part.join]));
        const groupBy = parts.length === 0 ? '' : `GROUP BY ${parts.map((_, index) => `key${String(index)}`).join(', ')}`;
        const rows = this.database.all(
            `SELECT ${[...select, 'COALESCE(SUM(t.value), 0) AS total', 'COUNT(*) AS count'].join(', ')}
            ${FROM_SQL}
            ${joins.join('\n')}
            WHERE ${where}
            ${groupBy}`,
            params.values(),
        );
        return rows.map((row) => toAggregateRow(row, dimensions));
    }

    /**
     * @param profileId Perfil que precisa ser o dono.
     * @param kind Cadastro referenciado.
     * @param ids Ids pedidos no filtro.
     * @return Os ids vivos e do perfil, entre os pedidos.
     */
    public liveReferences(profileId: ProfileId, kind: ReportReferenceKind, ids: readonly string[]): ReadonlySet<string> {
        if (ids.length === 0) {
            return new Set();
        }
        const params = new SqlParamBag();
        params.set('profileId', profileId);
        const rows = this.database.all(`${REFERENCE_SQL[kind]} AND x.id IN (${params.list('ref', ids)})`, params.values());
        return new Set(rows.map((row) => new RowReader('report_references', row).text('id')));
    }
}

/**
 * Regra de negócio (Relatórios, §2.2): lista vazia não restringe; dentro de um filtro as
 * escolhas se somam (OU) e entre filtros todos valem (E). Categoria e subcategoria são um filtro
 * só, como conta e cartão (a origem): escolher "Moradia" e "Mercado" quer dizer qualquer um dos
 * dois.
 *
 * @param scope Perfil, filtro e meses.
 * @param params Onde os parâmetros da condição são registrados.
 * @return A condição do `WHERE`, sempre com o perfil, o soft delete e a janela.
 */
function filterSql(scope: ReportQueryScope, params: SqlParamBag): string {
    const { filter, window } = scope;
    params.set('fromDate', monthBounds(window.from).start);
    params.set('toDate', monthBounds(window.to).end);
    const conditions = [
        't.deleted_at IS NULL',
        '((a.id IS NOT NULL AND t.invoice_id IS NULL) OR (c.id IS NOT NULL AND t.bank_statement_id IS NULL))',
        `${DATE_SQL[filter.period.basis]} BETWEEN :fromDate AND :toDate`,
    ];
    if (filter.types.length > 0) {
        conditions.push(`t.type IN (${params.list('type', filter.types.map((type) => TRANSACTION_TYPE_CODE[type]))})`);
    }
    const categoryParts = [
        ...(filter.subCategoryIds.length > 0 ? [`t.sub_category_id IN (${params.list('subCategory', filter.subCategoryIds)})`] : []),
        ...(filter.categoryIds.length > 0 ? [`sc.category_id IN (${params.list('category', filter.categoryIds)})`] : []),
    ];
    if (categoryParts.length > 0) {
        conditions.push(`(${categoryParts.join(' OR ')})`);
    }
    const sourceParts = [
        ...(filter.accountIds.length > 0 ? [`a.id IN (${params.list('account', filter.accountIds)})`] : []),
        ...(filter.creditCardIds.length > 0 ? [`c.id IN (${params.list('creditCard', filter.creditCardIds)})`] : []),
    ];
    if (sourceParts.length > 0) {
        conditions.push(`(${sourceParts.join(' OR ')})`);
    }
    if (filter.tagIds.length > 0) {
        conditions.push(tagFilterSql(filter, params));
    }
    if (filter.partnerIds.length > 0) {
        conditions.push(`t.partner_id IN (${params.list('partner', filter.partnerIds)})`);
    }
    if (filter.goalIds.length > 0) {
        conditions.push(`t.goal_id IN (${params.list('goal', filter.goalIds)})`);
    }
    if (filter.status !== 'all') {
        conditions.push(filter.status === 'paid' ? PAID_SQL : `NOT ${PAID_SQL}`);
    }
    if (filter.minValue !== null) {
        params.set('minValue', filter.minValue);
        conditions.push('t.value >= :minValue');
    }
    if (filter.maxValue !== null) {
        params.set('maxValue', filter.maxValue);
        conditions.push('t.value <= :maxValue');
    }
    return conditions.join('\n            AND ');
}

/**
 * Regra de negócio (Relatórios, A4): "qualquer uma" pede ao menos uma das tags escolhidas;
 * "todas", cada uma delas. Fica num subselect, e não numa junção, para que a transação com várias
 * tags continue contando uma vez quando a tag não é dimensão.
 *
 * @param filter Filtro com ao menos uma tag.
 * @param params Onde os ids das tags são registrados.
 * @return A condição das tags.
 */
function tagFilterSql(filter: ReportFilter, params: SqlParamBag): string {
    const tags = params.list('tag', filter.tagIds);
    const matched = `SELECT COUNT(DISTINCT lt.tag_id) FROM (${LIVE_TAG_LINKS_SQL}) lt WHERE lt.transaction_id = t.id AND lt.tag_id IN (${tags})`;
    if (filter.tagMatch === 'any') {
        return `(${matched}) > 0`;
    }
    params.set('tagCount', filter.tagIds.length);
    return `(${matched}) = :tagCount`;
}

/**
 * @param row Linha da consulta de somas.
 * @param dimensions Dimensões pedidas, na ordem das colunas `key0`, `key1`.
 * @return A linha com os grupos já no vocabulário do domínio (o tipo como `expense`, não `2`).
 */
function toAggregateRow(row: SqlRow, dimensions: readonly ReportDimension[]): ReportAggregateRow {
    const reader = new RowReader('report_aggregate', row);
    const groups = dimensions.map((dimension, index): ReportGroup => {
        const label = reader.nullableText(`label${String(index)}`);
        if (dimension === 'type') {
            return { key: decodeEnum(TRANSACTION_TYPE_CODE, reader.number(`key${String(index)}`), 'transactions'), label: null };
        }
        return { key: reader.nullableText(`key${String(index)}`), label };
    });
    return { groups, total: reader.number('total'), count: reader.number('count') };
}

/**
 * Parâmetros nomeados de uma consulta montada em partes. Existe porque a porta `Database` só
 * aceita escalares: uma lista vira `:prefixo0, :prefixo1...`, e montar o texto com os valores
 * abriria espaço para SQL injetado por um id malformado.
 */
class SqlParamBag {
    private readonly entries = new Map<string, SqlValue>();

    /**
     * @param name Nome do parâmetro, sem os dois-pontos.
     * @param value Valor escalar.
     * @return void
     */
    public set(name: string, value: SqlValue): void {
        this.entries.set(name, value);
    }

    /**
     * @param prefix Prefixo dos nomes, único por lista na consulta.
     * @param values Valores da lista; não pode ser vazia — `IN ()` é erro de sintaxe no SQLite.
     * @return O trecho `:prefixo0, :prefixo1, ...` para o `IN`.
     */
    public list(prefix: string, values: readonly SqlValue[]): string {
        return values
            .map((value, index) => {
                const name = `${prefix}${String(index)}`;
                this.entries.set(name, value);
                return `:${name}`;
            })
            .join(', ');
    }

    /**
     * @return Os parâmetros registrados, para a porta `Database`.
     */
    public values(): Readonly<Record<string, SqlValue>> {
        return Object.fromEntries(this.entries);
    }
}
