import { Goal, type GoalFunding } from '../../domain/goal/Goal.ts';
import type { GoalLink } from '../../domain/goal/GoalProgress.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { AccountId, GoalId, ProfileId, TransactionId } from '../../domain/shared/ids.ts';
import { LocalDate } from '../../domain/shared/LocalDate.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlParams, SqlRow } from '../../ports/Database.ts';
import type { GoalRepository } from '../../repositories/GoalRepository.ts';
import { RowReader } from './RowReader.ts';

// A moeda vem do perfil: `goals` não tem coluna de moeda, porque todo valor gravado está na
// moeda do perfil (database-design §3.7).
const SELECT_GOAL = 'SELECT g.id, g.profile_id, g.name, g.kind, g.account_id, g.value, g.target_date, g.archived_at, p.currency AS profile_currency FROM goals g JOIN profiles p ON p.id = g.profile_id';

/** Código de cada tipo de meta na coluna `goals.kind` (migration `0005`). */
const GOAL_KIND_CODE: Readonly<Record<GoalFunding['kind'], number>> = { transactions: 1, account: 2 };

/** Implementação SQLite de `GoalRepository`. */
export class SqliteGoalRepository implements GoalRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `updated_at` e `deleted_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param id Meta procurada.
     * @return A meta viva, ou `null`.
     */
    public findById(id: GoalId): Goal | null {
        const row = this.database.get(`${SELECT_GOAL} WHERE g.id = :id AND g.deleted_at IS NULL`, { id });
        return row === undefined ? null : this.toGoal(row);
    }

    /**
     * @param profileId Perfil dono.
     * @return As metas vivas do perfil, por nome.
     */
    public listByProfile(profileId: ProfileId): readonly Goal[] {
        return this.database
            .all(`${SELECT_GOAL} WHERE g.profile_id = :profileId AND g.deleted_at IS NULL ORDER BY g.name COLLATE NOCASE, g.id`, { profileId })
            .map((row) => this.toGoal(row));
    }

    /**
     * @param profileId Perfil dono.
     * @return As transações vivas vinculadas a cada meta viva do perfil (`selectLinks`).
     */
    public linksByGoal(profileId: ProfileId): ReadonlyMap<GoalId, readonly GoalLink[]> {
        const links = new Map<GoalId, GoalLink[]>();
        for (const row of this.selectLinks('g.profile_id = :profileId', { profileId })) {
            const goalId = GoalId(new RowReader('transactions', row).text('goal_id'));
            const link = this.toLink(row);
            // `push` no array local, e não um array novo por linha: copiar a cada vínculo custava
            // O(n²) numa meta alimentada por uma série fixa ao longo de anos (revisão de
            // 2026-10-08, item 6). A mutação não escapa — o retorno expõe os arrays como `readonly`.
            const linked = links.get(goalId);
            if (linked === undefined) {
                links.set(goalId, [link]);
            } else {
                linked.push(link);
            }
        }
        return links;
    }

    /**
     * @param goalId Meta consultada.
     * @return As transações vivas vinculadas à meta (`selectLinks`); vazio quando a meta não
     * tem vínculo ou não está viva.
     */
    public linksOf(goalId: GoalId): readonly GoalLink[] {
        return this.selectLinks('g.id = :goalId', { goalId }).map((row) => this.toLink(row));
    }

    /**
     * Consulta única dos vínculos, para que a lista de metas e o detalhe de uma meta leiam o dia
     * do pagamento pela mesma regra — duas cópias do `CASE` podiam divergir e fazer a tabela do
     * detalhe não somar o progresso da lista.
     * Regra de negócio (Metas): numa conta, o dia do pagamento; num cartão, o dia em que a
     * **fatura** foi paga — é quando o dinheiro sai de fato (desktop-mvp-plan §3.1). A fatura
     * paga antes da migration `0003` não tem o dia gravado e vale o 1º dia do mês do extrato do
     * pagamento; a fatura cujo extrato de pagamento foi excluído volta a estar em aberto, como
     * no saldo.
     * Regra de negócio (Metas, desktop-mvp-plan Fase 13.3): a transferência de retirada entra com
     * o sinal invertido e desconta do progresso. Só metas por lançamentos têm vínculos: a
     * vinculada a conta é medida pelo saldo dela.
     *
     * @param filter Condição sobre a meta (`g`) que recorta os vínculos: o perfil ou uma meta.
     * @param params Parâmetros nomeados da condição.
     * @return As linhas dos vínculos vivos de metas vivas, por meta e transação.
     */
    private selectLinks(filter: string, params: SqlParams): readonly SqlRow[] {
        return this.database.all(
            `SELECT t.goal_id, t.id, CASE WHEN t.goal_withdrawal = 1 THEN -t.value ELSE t.value END AS value, p.currency AS profile_currency,
                CASE
                    WHEN t.invoice_id IS NULL THEN (CASE WHEN t.paid = 1 THEN t.payment_date END)
                    WHEN ps.id IS NOT NULL THEN COALESCE(i.payment_date, printf('%04d-%02d-01', ps.year, ps.month))
                END AS paid_on
            FROM transactions t
            JOIN goals g ON g.id = t.goal_id AND g.deleted_at IS NULL AND g.kind = 1
            JOIN profiles p ON p.id = g.profile_id
            LEFT JOIN invoices i ON i.id = t.invoice_id AND i.deleted_at IS NULL
            LEFT JOIN bank_statements ps ON ps.id = i.bank_statement_id AND ps.deleted_at IS NULL
            WHERE ${filter} AND t.deleted_at IS NULL
            ORDER BY t.goal_id, t.id`,
            params,
        );
    }

    /**
     * @param row Linha do `selectLinks`.
     * @return O vínculo, com o valor na moeda do perfil e o dia em que o dinheiro se moveu.
     */
    private toLink(row: SqlRow): GoalLink {
        const reader = new RowReader('transactions', row);
        const paidOn = reader.nullableText('paid_on');
        const transactionId = TransactionId(reader.text('id'));
        return {
            key: transactionId,
            transactionId,
            value: Money.of(reader.number('value'), Currency.of(reader.text('profile_currency'))),
            paidOn: paidOn === null ? null : LocalDate.parse(paidOn),
        };
    }

    /**
     * Grava a meta. `archived_at` guarda o instante do primeiro arquivamento, como o
     * `disabled_at` das contas: arquivar de novo uma meta arquivada não muda a data.
     *
     * @param goal Meta a gravar.
     * @return void
     */
    public save(goal: Goal): void {
        this.database.run(
            `INSERT INTO goals (id, profile_id, name, kind, account_id, value, target_date, archived_at, updated_at)
            VALUES (:id, :profileId, :name, :kind, :accountId, :value, :targetDate, CASE WHEN :archived = 1 THEN :now END, :now)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind, account_id = excluded.account_id, value = excluded.value,
                target_date = excluded.target_date,
                archived_at = CASE WHEN :archived = 1 THEN COALESCE(goals.archived_at, excluded.archived_at) END,
                updated_at = excluded.updated_at
            WHERE goals.deleted_at IS NULL`,
            {
                id: goal.id,
                profileId: goal.profileId,
                name: goal.name,
                kind: GOAL_KIND_CODE[goal.funding.kind],
                accountId: goal.funding.kind === 'account' ? goal.funding.accountId : null,
                value: goal.target.rounded().amount,
                targetDate: goal.targetDate?.toString() ?? null,
                archived: goal.archived ? 1 : 0,
                now: this.clock.now(),
            },
        );
    }

    /**
     * Os vínculos são desfeitos com `updated_at` novo, como na mudança de subcategoria em massa,
     * para que a sincronização propague a linha alterada (sync-design §5). A marca de retirada
     * sai junto, porque sem meta não tem sentido.
     *
     * @param id Meta cujos vínculos se desfazem.
     * @return void
     */
    public unlinkTransactions(id: GoalId): void {
        const params = { id, now: this.clock.now() };
        this.database.run('UPDATE transactions SET goal_id = NULL, goal_withdrawal = 0, updated_at = :now WHERE goal_id = :id AND deleted_at IS NULL', params);
        // A meta também sai do modelo das recorrências, para não voltar nas próximas ocorrências.
        this.database.run('UPDATE recurrences SET goal_id = NULL, goal_withdrawal = 0, updated_at = :now WHERE goal_id = :id AND deleted_at IS NULL', params);
    }

    /**
     * @param id Meta a excluir, com os vínculos (`unlinkTransactions`).
     * @return void
     */
    public softDelete(id: GoalId): void {
        this.unlinkTransactions(id);
        this.database.run('UPDATE goals SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL', { id, now: this.clock.now() });
    }

    /**
     * @param row Linha do `SELECT_GOAL`.
     * @return A meta de domínio.
     */
    private toGoal(row: SqlRow): Goal {
        const reader = new RowReader('goals', row);
        const targetDate = reader.nullableText('target_date');
        const accountId = reader.nullableText('account_id');
        // A meta vinculada a conta sem a conta gravada não é um estado que a aplicação grava; lida
        // como por lançamentos, ela continua visível e editável em vez de derrubar a lista.
        const funding: GoalFunding = reader.number('kind') === GOAL_KIND_CODE.account && accountId !== null ? { kind: 'account', accountId: AccountId(accountId) } : { kind: 'transactions' };
        return Goal.restore({
            id: GoalId(reader.text('id')),
            profileId: ProfileId(reader.text('profile_id')),
            name: reader.text('name'),
            funding,
            target: Money.of(reader.number('value'), Currency.of(reader.text('profile_currency'))),
            targetDate: targetDate === null ? null : LocalDate.parse(targetDate),
            archived: reader.nullableText('archived_at') !== null,
        });
    }
}
