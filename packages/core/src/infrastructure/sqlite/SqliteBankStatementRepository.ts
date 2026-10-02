import { BalancePair } from '../../domain/balance/BalancePair.ts';
import { BankStatement } from '../../domain/statement/BankStatement.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { AccountId, BankStatementId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlRow } from '../../ports/Database.ts';
import type { BankStatementRepository } from '../../repositories/BankStatementRepository.ts';
import { periodKey } from './periodSql.ts';
import { RowReader } from './RowReader.ts';

const SELECT_STATEMENT = `
    SELECT s.id, s.account_id, s.year, s.month, s.opening_balance, s.closing_balance,
        s.projected_opening_balance, s.projected_closing_balance, p.currency AS profile_currency
    FROM bank_statements s
    JOIN accounts a ON a.id = s.account_id
    JOIN profiles p ON p.id = a.profile_id
`;

/** Implementação SQLite de `BankStatementRepository`. */
export class SqliteBankStatementRepository implements BankStatementRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `updated_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param id Extrato procurado.
     * @return O extrato vivo, ou `null`.
     */
    public findById(id: BankStatementId): BankStatement | null {
        return this.first(`${SELECT_STATEMENT} WHERE s.id = :id AND s.deleted_at IS NULL`, { id });
    }

    /**
     * @param accountId Conta dona do extrato.
     * @param period Competência procurada.
     * @return O extrato vivo daquele mês, ou `null`.
     */
    public findByPeriod(accountId: AccountId, period: YearMonth): BankStatement | null {
        return this.first(
            `${SELECT_STATEMENT} WHERE s.account_id = :accountId AND s.year = :year AND s.month = :month AND s.deleted_at IS NULL`,
            { accountId, year: period.year, month: period.month },
        );
    }

    /**
     * @param accountId Conta dona dos extratos.
     * @param from Primeira competência incluída.
     * @return Os extratos vivos a partir de `from`, em ordem cronológica.
     */
    public listFrom(accountId: AccountId, from: YearMonth): readonly BankStatement[] {
        return this.database
            .all(
                `${SELECT_STATEMENT}
                WHERE s.account_id = :accountId AND s.deleted_at IS NULL AND (s.year * 100 + s.month) >= :from
                ORDER BY s.year, s.month`,
                { accountId, from: periodKey(from) },
            )
            .map((row) => this.toStatement(row));
    }

    /**
     * @param accountId Conta dona dos extratos.
     * @param period Competência de referência, exclusiva.
     * @return O último extrato vivo antes de `period`, ou `null`.
     */
    public findLatestBefore(accountId: AccountId, period: YearMonth): BankStatement | null {
        return this.first(
            `${SELECT_STATEMENT}
            WHERE s.account_id = :accountId AND s.deleted_at IS NULL AND (s.year * 100 + s.month) < :period
            ORDER BY s.year DESC, s.month DESC
            LIMIT 1`,
            { accountId, period: periodKey(period) },
        );
    }

    /**
     * O `ON CONFLICT` sobre o id determinístico é o que faz "recriar" virar "reviver"
     * (sync-design §5.6); uma linha viva com o mesmo id fica intocada.
     *
     * @param statement Extrato a garantir.
     * @return void
     */
    public insertOrRevive(statement: BankStatement): void {
        this.database.run(
            `INSERT INTO bank_statements (id, account_id, month, year, opening_balance, closing_balance,
                projected_opening_balance, projected_closing_balance, updated_at)
            VALUES (:id, :accountId, :month, :year, :opening, :closing, :projectedOpening, :projectedClosing, :now)
            ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at
            WHERE bank_statements.deleted_at IS NOT NULL`,
            { ...this.balanceParams(statement), accountId: statement.accountId, month: statement.period.month, year: statement.period.year },
        );
    }

    /**
     * @param statement Extrato com os saldos recalculados.
     * @return void
     */
    public saveBalances(statement: BankStatement): void {
        this.database.run(
            `UPDATE bank_statements
            SET opening_balance = :opening, closing_balance = :closing,
                projected_opening_balance = :projectedOpening, projected_closing_balance = :projectedClosing,
                updated_at = :now
            WHERE id = :id`,
            this.balanceParams(statement),
        );
    }

    /**
     * Parâmetros dos quatro saldos, arredondados na fronteira de persistência.
     *
     * @param statement Extrato de origem.
     * @return Parâmetros nomeados comuns ao insert e ao update.
     */
    private balanceParams(statement: BankStatement): Record<string, string | number> {
        return {
            id: statement.id,
            opening: statement.opening.consolidated.rounded().amount,
            closing: statement.closing.consolidated.rounded().amount,
            projectedOpening: statement.opening.projected.rounded().amount,
            projectedClosing: statement.closing.projected.rounded().amount,
            now: this.clock.now(),
        };
    }

    /**
     * @param sql Consulta baseada em `SELECT_STATEMENT`.
     * @param params Parâmetros nomeados.
     * @return O primeiro extrato, ou `null`.
     */
    private first(sql: string, params: Record<string, string | number>): BankStatement | null {
        const row = this.database.get(sql, params);
        return row === undefined ? null : this.toStatement(row);
    }

    /**
     * @param row Linha do `SELECT_STATEMENT`.
     * @return O extrato de domínio.
     */
    private toStatement(row: SqlRow): BankStatement {
        const reader = new RowReader('bank_statements', row);
        const currency = Currency.of(reader.text('profile_currency'));
        return BankStatement.restore({
            id: BankStatementId(reader.text('id')),
            accountId: AccountId(reader.text('account_id')),
            period: YearMonth.of(reader.number('year'), reader.number('month')),
            opening: BalancePair.of(
                Money.of(reader.number('opening_balance'), currency),
                Money.of(reader.number('projected_opening_balance'), currency),
            ),
            closing: BalancePair.of(
                Money.of(reader.number('closing_balance'), currency),
                Money.of(reader.number('projected_closing_balance'), currency),
            ),
        });
    }
}
