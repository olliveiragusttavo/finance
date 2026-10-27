import type { ReportDateBasis, ReportFilter } from '../../domain/report/ReportFilter.ts';
import type { ReportDimension } from '../../domain/report/ReportLayout.ts';
import type { ReportAggregateRow, ReportGroup } from '../../domain/report/ReportResult.ts';
import type { ProfileId } from '../../domain/shared/ids.ts';
import type { Database, SqlRow, SqlValue } from '../../ports/Database.ts';
import type { ReportQueryRepository, ReportQueryScope, ReportReferenceKind } from '../../repositories/ReportQueryRepository.ts';
import { decodeEnum, RECURRENCE_KIND_CODE, TRANSACTION_TYPE_CODE } from './enumCodes.ts';
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
 * Origem, destino e perfil da transação. A conta vale para a transação de extrato e o cartão, para
 * a de fatura — o arco exclusivo íntegro é conferido, como no recálculo de saldos —, e o dono do
 * contêiner tem de ser o perfil. O destino (`da`) só existe na transferência e no investimento, e
 * só quando a conta é do perfil. As categorias entram sempre, porque o filtro e duas dimensões as
 * usam; o nome de um cadastro excluído continua legível na linha excluída.
 */
const FROM_SQL = `
    FROM transactions t
    LEFT JOIN bank_statements bs ON bs.id = t.bank_statement_id AND bs.deleted_at IS NULL
    LEFT JOIN accounts a ON a.id = bs.account_id AND a.deleted_at IS NULL AND a.profile_id = :profileId
    LEFT JOIN invoices i ON i.id = t.invoice_id AND i.deleted_at IS NULL
    LEFT JOIN credit_cards c ON c.id = i.credit_card_id AND c.deleted_at IS NULL AND c.profile_id = :profileId
    LEFT JOIN accounts da ON da.id = t.destination_account_id
        AND t.type IN (${String(TRANSACTION_TYPE_CODE.transference)}, ${String(TRANSACTION_TYPE_CODE.investment)})
        AND da.deleted_at IS NULL AND da.profile_id = :profileId
    LEFT JOIN transaction_sub_categories sc ON sc.id = t.sub_category_id
    LEFT JOIN transaction_categories cat ON cat.id = sc.category_id`;

/** A linha é do perfil: a origem — o extrato da conta ou a fatura do cartão — é dele. */
const OWN_SQL = '((a.id IS NOT NULL AND t.invoice_id IS NULL) OR (c.id IS NOT NULL AND t.bank_statement_id IS NULL))';

/**
 * Regra de negócio (Relatórios, §2.2 "Perfil"): a transferência que chega de outro perfil é uma
 * linha do perfil de origem (database-design §4.13), mas o dinheiro entra numa conta deste — sem
 * ela, o relatório de transferências do destino não via o que recebeu. A origem precisa ser um
 * extrato vivo de outro perfil: a entre perfis sempre sai de uma conta.
 */
const INCOMING_SQL = `(t.type = ${String(TRANSACTION_TYPE_CODE.transference)} AND da.id IS NOT NULL AND bs.id IS NOT NULL AND t.invoice_id IS NULL AND a.id IS NULL)`;

/**
 * Efeito de um movimento no saldo (database-design §4.13, sinal de `value`): na origem a receita
 * soma e os demais tipos subtraem, e o sinal do `value` (estorno) inverte o tipo; no destino da
 * transferência ou do investimento o `value` entra. Os encargos ficam fora, como na soma de
 * sempre (reports-design §3).
 */
const FLOW_AMOUNT_SQL = `(CASE WHEN fl.leg = 'destination' THEN t.value WHEN t.type = ${String(TRANSACTION_TYPE_CODE.income)} THEN t.value ELSE -t.value END)`;

/**
 * Regra de negócio (Relatórios, L8): cada transação vira um movimento por conta do perfil que ela
 * toca — a origem, quando é do perfil, e o destino, quando é do perfil. A transferência entre duas
 * contas do perfil conta nos dois lados, como saída e como entrada; a que vem de outro perfil só
 * no destino, e a que vai para outro perfil só na origem.
 */
const FLOW_JOIN_SQL = `JOIN (SELECT 'origin' AS leg UNION ALL SELECT 'destination') fl
        ON (fl.leg = 'origin' AND ${OWN_SQL}) OR (fl.leg = 'destination' AND da.id IS NOT NULL)`;

/**
 * Vínculos vivos com tags vivas do perfil; o mesmo recorte no filtro e na dimensão. As tags da
 * transferência recebida de outro perfil são de lá, e ela cai em "Sem tag".
 */
const LIVE_TAG_LINKS_SQL = `
    SELECT tt.transaction_id, g.id AS tag_id, g.name AS tag_name
    FROM transactions_tags tt
    JOIN tags g ON g.id = tt.tag_id AND g.deleted_at IS NULL AND g.profile_id = :profileId
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
 * origem a linha fica sem sócio. A recorrência também entra por `LEFT JOIN`: a avulsa não tem
 * regra e precisa continuar no relatório. Na transferência recebida de outro perfil, a categoria e
 * a subcategoria são de lá: ela cai no grupo "sem", e a origem é a conta de destino, a deste perfil.
 *
 * @param dimension Dimensão pedida.
 * @param basis Base de data do filtro, que define o mês.
 * @param alias Prefixo dos aliases da junção, para que duas dimensões nunca colidam.
 * @param flow Se a consulta separa os movimentos (L8), que dá a cada um a própria conta.
 * @return As expressões da dimensão.
 */
function dimensionSql(dimension: ReportDimension, basis: ReportDateBasis, alias: string, flow: boolean): DimensionSql {
    switch (dimension) {
        case 'month':
            return { key: `substr(${DATE_SQL[basis]}, 1, 7)`, label: 'NULL', join: null };
        case 'type':
            return { key: 't.type', label: 'NULL', join: null };
        case 'category':
            return { key: `CASE WHEN ${OWN_SQL} THEN sc.category_id END`, label: `CASE WHEN ${OWN_SQL} THEN cat.name END`, join: null };
        case 'subCategory':
            return { key: `CASE WHEN ${OWN_SQL} THEN t.sub_category_id END`, label: `CASE WHEN ${OWN_SQL} THEN sc.name END`, join: null };
        case 'source': {
            // Com os movimentos, a conta é a de cada um: a chegada de uma transferência interna é da conta de destino.
            const destination = flow ? "fl.leg = 'destination'" : INCOMING_SQL;
            return { key: `CASE WHEN ${destination} THEN da.id ELSE COALESCE(a.id, c.id) END`, label: `CASE WHEN ${destination} THEN da.name ELSE COALESCE(a.name, c.name) END`, join: null };
        }
        case 'tag':
            return { key: `${alias}.tag_id`, label: `${alias}.tag_name`, join: `LEFT JOIN (${LIVE_TAG_LINKS_SQL}) ${alias} ON ${alias}.transaction_id = t.id` };
        case 'partner':
            return { key: `${alias}.id`, label: `${alias}.name`, join: `LEFT JOIN partners ${alias} ON ${alias}.id = t.partner_id AND ${alias}.deleted_at IS NULL AND ${alias}.profile_id = :profileId` };
        case 'status':
            return { key: `CASE WHEN ${PAID_SQL} THEN 'paid' ELSE 'open' END`, label: 'NULL', join: null };
        case 'recurrence':
            return { key: recurrenceGroupSql(alias), label: 'NULL', join: `LEFT JOIN recurrences ${alias} ON ${alias}.id = t.recurrence_id` };
        case 'flow':
            // A junção dos movimentos entra pela consulta, porque a soma a usa mesmo sem esta dimensão.
            return { key: `CASE WHEN ${FLOW_AMOUNT_SQL} > 0 THEN 'in' ELSE 'out' END`, label: 'NULL', join: null };
    }
}

/**
 * Regra de negócio (Relatórios, L6): a ocorrência de uma série conta como fixa ou parcelada pelo
 * tipo da regra, e a transação sem `recurrence_id` é avulsa. A regra excluída continua valendo:
 * a parcela que sobrou viva continua sendo uma parcela, assim como o nome de um cadastro excluído
 * continua legível. O texto só junta os códigos fechados de `RECURRENCE_KIND_CODE`.
 *
 * @param alias Alias da junção com `recurrences`.
 * @return A expressão da chave: `fixed`, `installments` ou `single`.
 */
function recurrenceGroupSql(alias: string): string {
    return `CASE ${alias}.type
        WHEN ${String(RECURRENCE_KIND_CODE.fixed)} THEN 'fixed'
        WHEN ${String(RECURRENCE_KIND_CODE.installments)} THEN 'installments'
        ELSE 'single' END`;
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
        const flow = scope.flow || dimensions.includes('flow');
        const where = filterSql(scope, params, flow);
        const parts = dimensions.map((dimension, index) => dimensionSql(dimension, scope.filter.period.basis, `d${String(index)}`, flow));
        const select = parts.flatMap((part, index) => [`${part.key} AS key${String(index)}`, `MAX(${part.label}) AS label${String(index)}`]);
        const joins = [...(flow ? [FLOW_JOIN_SQL] : []), ...parts.flatMap((part) => (part.join === null ? [] : [part.join]))];
        const groupBy = parts.length === 0 ? '' : `GROUP BY ${parts.map((_, index) => `key${String(index)}`).join(', ')}`;
        // Com os movimentos, a transferência entre contas do perfil está em duas linhas: a soma
        // delas é o efeito líquido, mas a quantidade conta a transação uma vez.
        const measures = flow ? [`COALESCE(SUM(${FLOW_AMOUNT_SQL}), 0) AS total`, 'COUNT(DISTINCT t.id) AS count'] : ['COALESCE(SUM(t.value), 0) AS total', 'COUNT(*) AS count'];
        const rows = this.database.all(
            `SELECT ${[...select, ...measures].join(', ')}
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
 * dois. A transferência recebida de outro perfil tem a conta de destino como origem, e a
 * categoria, as tags e a meta dela são de lá: um filtro por esses cadastros não a inclui.
 * Regra de negócio (Relatórios, L8): com os movimentos, a conta e o cartão filtram cada perna, e
 * não a transação — a chegada de uma transferência interna é da conta de destino e só entra
 * quando essa conta está escolhida.
 *
 * @param scope Perfil, filtro e meses.
 * @param params Onde os parâmetros da condição são registrados.
 * @param flow Se a consulta separa os movimentos (L8); aí o filtro de origem passa a valer por perna.
 * @return A condição do `WHERE`, sempre com o perfil, o soft delete e a janela.
 */
function filterSql(scope: ReportQueryScope, params: SqlParamBag, flow: boolean): string {
    const { filter, window } = scope;
    params.set('fromDate', monthBounds(window.from).start);
    params.set('toDate', monthBounds(window.to).end);
    const conditions = [
        't.deleted_at IS NULL',
        `(${OWN_SQL} OR ${INCOMING_SQL})`,
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
    const accounts = filter.accountIds.length > 0 ? params.list('account', filter.accountIds) : null;
    const cards = filter.creditCardIds.length > 0 ? params.list('creditCard', filter.creditCardIds) : null;
    const sourceParts = flow ? flowSourceSql(accounts, cards) : [
        ...(accounts === null ? [] : [`a.id IN (${accounts})`, `(${INCOMING_SQL} AND da.id IN (${accounts}))`]),
        ...(cards === null ? [] : [`c.id IN (${cards})`]),
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
 * Regra de negócio (Relatórios, L8 e A3): com os movimentos separados, cada perna tem a própria
 * conta, e o filtro de origem precisa valer por perna. Filtrar a linha inteira trazia a chegada de
 * uma transferência interna em outra conta e perdia a que chega à conta filtrada, e o líquido da
 * conta deixava de ser o efeito no saldo dela.
 *
 * @param accounts Marcadores das contas do filtro; `null` sem filtro de conta.
 * @param cards Marcadores dos cartões do filtro; `null` sem filtro de cartão.
 * @return As alternativas (OU) do filtro de origem, uma por perna.
 */
function flowSourceSql(accounts: string | null, cards: string | null): readonly string[] {
    return [
        ...(accounts === null ? [] : [`(fl.leg = 'origin' AND a.id IN (${accounts}))`, `(fl.leg = 'destination' AND da.id IN (${accounts}))`]),
        ...(cards === null ? [] : [`(fl.leg = 'origin' AND c.id IN (${cards}))`]),
    ];
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
