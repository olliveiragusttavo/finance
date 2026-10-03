import { BetterSqliteDatabase } from '@finance/sqlite-better';
import {
    createCore,
    openDatabase,
    type Core,
    type CoreError,
    type CoreInput,
    type CoreOutput,
    type CoreRoute,
    type MoneyResponse,
} from '../../src/index.ts';
import { FixedClock, SequentialIds } from './adapters.ts';

type CreateInput = CoreInput<'transactions.create'>;
type UpdateInput = CoreInput<'transactions.update'>;

/** Saldos de um extrato lidos direto da tabela, sem passar pelo código testado. */
export interface StatementRow {
    readonly opening: MoneyResponse;
    readonly closing: MoneyResponse;
    readonly projectedOpening: MoneyResponse;
    readonly projectedClosing: MoneyResponse;
}

/**
 * Um banco SQLite real em memória com todas as migrations aplicadas pelo runner de
 * produção e o núcleo montado sobre ele. Os testes de Service não mockam Repository:
 * metade dos bugs previstos mora no SQL — o `deleted_at IS NULL` esquecido, o `SUM` no
 * contêiner errado — e um mock os esconderia (backend-design §5.4).
 *
 * Os cadastros (perfil, conta, cartão, categoria) são semeados por SQL direto mesmo tendo
 * Service, para que um teste de saldo não falhe por causa de um defeito no cadastro — os
 * testes dos cadastros usam as rotas. As leituras de conferência também vão direto às
 * tabelas, para que a asserção não dependa do código que está sendo testado.
 */
export class TestWorld {
    public readonly clock: FixedClock;
    public readonly ids = new SequentialIds();
    public readonly database: BetterSqliteDatabase;
    public readonly core: Core;
    public readonly currency: string;

    /**
     * @param today "Hoje" inicial; decide o mês corrente do saldo das contas.
     * @param currency Moeda dos perfis semeados.
     */
    public constructor(today = '2026-03-15', currency = 'BRL') {
        this.clock = new FixedClock(today);
        this.currency = currency;
        this.database = BetterSqliteDatabase.open(':memory:');
        openDatabase(this.database, { backups: null, clock: this.clock });
        this.core = createCore({
            database: this.database,
            clock: this.clock,
            ids: this.ids,
            onUnexpectedError: (error) => {
                throw error;
            },
        });
    }

    /**
     * @param options Tipo do perfil; empresarial habilita sócios.
     * @return O id do perfil semeado.
     */
    public profile(options: { readonly type?: 'personal' | 'business' } = {}): string {
        const id = this.ids.random();
        this.database.run(
            'INSERT INTO profiles (id, name, type, currency, updated_at) VALUES (:id, :name, :type, :currency, :now)',
            { id, name: 'Perfil', type: options.type === 'business' ? 2 : 1, currency: this.currency, now: this.clock.now() },
        );
        return id;
    }

    /**
     * @param profileId Perfil dono.
     * @param options Saldo inicial e participação no total.
     * @return O id da conta semeada.
     */
    public account(profileId: string, options: { readonly openingBalance?: number; readonly considerBalance?: boolean; readonly name?: string } = {}): string {
        const id = this.ids.random();
        const opening = options.openingBalance ?? 0;
        this.database.run(
            `INSERT INTO accounts (id, profile_id, name, balance, projected_balance, opening_balance, currency, consider_balance, type, updated_at)
            VALUES (:id, :profileId, :name, :opening, :opening, :opening, :currency, :consider, 1, :now)`,
            {
                id,
                profileId,
                name: options.name ?? 'Conta',
                opening,
                currency: this.currency,
                consider: options.considerBalance === false ? 0 : 1,
                now: this.clock.now(),
            },
        );
        return id;
    }

    /**
     * @param profileId Perfil dono.
     * @param accountId Conta que paga as faturas.
     * @param closingDay Dia de fechamento.
     * @param dueDay Dia de vencimento.
     * @return O id do cartão semeado.
     */
    public creditCard(profileId: string, accountId: string, closingDay: number, dueDay: number): string {
        const id = this.ids.random();
        this.database.run(
            `INSERT INTO credit_cards (id, profile_id, account_id, name, limit_value, closing_date, due_date, updated_at)
            VALUES (:id, :profileId, :accountId, 'Cartão', 10000, :closingDay, :dueDay, :now)`,
            { id, profileId, accountId, closingDay, dueDay, now: this.clock.now() },
        );
        return id;
    }

    /**
     * @param profileId Perfil dono da categoria.
     * @return O id de uma subcategoria nova, numa categoria nova.
     */
    public subCategory(profileId: string): string {
        const categoryId = this.ids.random();
        const id = this.ids.random();
        const now = this.clock.now();
        this.database.run(
            'INSERT INTO transaction_categories (id, profile_id, name, updated_at) VALUES (:id, :profileId, :name, :now)',
            { id: categoryId, profileId, name: `Categoria ${categoryId.slice(-6)}`, now },
        );
        this.database.run(
            'INSERT INTO transaction_sub_categories (id, category_id, name, updated_at) VALUES (:id, :categoryId, :name, :now)',
            { id, categoryId, name: 'Geral', now },
        );
        return id;
    }

    /**
     * @param profileId Perfil empresarial dono.
     * @return O id do sócio semeado.
     */
    public partner(profileId: string): string {
        const id = this.ids.random();
        this.database.run(
            "INSERT INTO partners (id, profile_id, name, percentage, updated_at) VALUES (:id, :profileId, 'Sócio', 100, :now)",
            { id, profileId, now: this.clock.now() },
        );
        return id;
    }

    /**
     * Chama uma rota e devolve os dados, falhando o teste com o erro quando ela falha.
     *
     * @param route Rota chamada.
     * @param input Entrada da rota.
     * @return Os dados de sucesso.
     */
    public async ok<R extends CoreRoute>(route: R, input: CoreInput<R>): Promise<CoreOutput<R>> {
        const result = await this.core.call(route, input);
        if (!result.ok) {
            throw new Error(`${route} falhou: ${result.error.code} ${result.error.message} ${JSON.stringify(result.error.details)}`);
        }
        return result.data;
    }

    /**
     * Chama uma rota que deve falhar e devolve o erro.
     *
     * @param route Rota chamada.
     * @param input Entrada da rota.
     * @return O erro devolvido.
     */
    public async failure<R extends CoreRoute>(route: R, input: CoreInput<R>): Promise<CoreError> {
        const result = await this.core.call(route, input);
        if (result.ok) {
            throw new Error(`${route} deveria falhar, mas devolveu ${JSON.stringify(result.data)}`);
        }
        return result.error;
    }

    /**
     * Lança uma transação pela rota real (camada Request incluída), com padrões válidos para
     * que cada teste declare só o que importa (builders, backend-design §5.4).
     *
     * @param base Perfil, subcategoria e origem.
     * @param overrides Campos do lançamento que o teste quer fixar.
     * @return A transação criada.
     */
    public async create(
        base: { readonly profileId: string; readonly subCategoryId: string },
        overrides: Partial<CreateInput> & Pick<CreateInput, 'source'>,
    ): Promise<CoreOutput<'transactions.create'>> {
        return this.ok('transactions.create', {
            profileId: base.profileId,
            subCategoryId: base.subCategoryId,
            type: 'expense',
            name: 'Lançamento',
            value: 100,
            dueDate: '2026-03-10',
            ...overrides,
        });
    }

    /**
     * Edita uma transação pela rota real. A edição exige todos os campos explícitos; o
     * builder preenche os que o teste não fixa com os mesmos padrões do `create`, para que
     * cada teste declare só o que muda.
     *
     * @param base Perfil (ignorado pela rota) e subcategoria.
     * @param id Transação editada.
     * @param overrides Campos da edição que o teste quer fixar; `source` é obrigatório.
     * @return A transação editada.
     */
    public async update(
        base: { readonly profileId: string; readonly subCategoryId: string },
        id: string,
        overrides: Partial<UpdateInput> & Pick<UpdateInput, 'source'>,
    ): Promise<CoreOutput<'transactions.update'>> {
        return this.ok('transactions.update', {
            id,
            subCategoryId: base.subCategoryId,
            type: 'expense',
            name: 'Lançamento',
            value: 100,
            charges: 0,
            description: null,
            destinationAccountId: null,
            partnerId: null,
            goalId: null,
            originCurrency: null,
            conversionRate: 1,
            dueDate: '2026-03-10',
            paymentDate: null,
            ...overrides,
        });
    }

    /**
     * @param accountId Conta.
     * @param period Competência `YYYY-MM`.
     * @return Os quatro saldos do extrato vivo, ou `undefined` quando o mês não tem extrato.
     */
    public statementRow(accountId: string, period: string): StatementRow | undefined {
        const [year, month] = period.split('-').map(Number);
        const row = this.database.get(
            `SELECT opening_balance, closing_balance, projected_opening_balance, projected_closing_balance
            FROM bank_statements WHERE account_id = :accountId AND year = :year AND month = :month AND deleted_at IS NULL`,
            { accountId, year: year ?? 0, month: month ?? 0 },
        );
        if (row === undefined) {
            return undefined;
        }
        return {
            opening: this.money(row['opening_balance']),
            closing: this.money(row['closing_balance']),
            projectedOpening: this.money(row['projected_opening_balance']),
            projectedClosing: this.money(row['projected_closing_balance']),
        };
    }

    /**
     * @param accountId Conta.
     * @return O cache de saldo da conta (consolidado e previsto).
     */
    public accountRow(accountId: string): { readonly balance: MoneyResponse; readonly projected: MoneyResponse } {
        const row = this.database.get('SELECT balance, projected_balance FROM accounts WHERE id = :accountId', { accountId });
        return { balance: this.money(row?.['balance']), projected: this.money(row?.['projected_balance']) };
    }

    /**
     * @param creditCardId Cartão.
     * @param period Competência `YYYY-MM`.
     * @return O total e o mês do pagamento da fatura viva, ou `undefined`.
     */
    public invoiceRow(creditCardId: string, period: string): { readonly balance: MoneyResponse; readonly paidIn: string | null } | undefined {
        const [year, month] = period.split('-').map(Number);
        const row = this.database.get(
            `SELECT i.balance, CASE WHEN bs.id IS NULL THEN NULL ELSE printf('%04d-%02d', bs.year, bs.month) END AS paid_in
            FROM invoices i LEFT JOIN bank_statements bs ON bs.id = i.bank_statement_id
            WHERE i.credit_card_id = :creditCardId AND i.year = :year AND i.month = :month AND i.deleted_at IS NULL`,
            { creditCardId, year: year ?? 0, month: month ?? 0 },
        );
        if (row === undefined) {
            return undefined;
        }
        const paidIn = row['paid_in'];
        return { balance: this.money(row['balance']), paidIn: typeof paidIn === 'string' ? paidIn : null };
    }

    /**
     * @param value Valor lido do banco.
     * @return O valor como `MoneyResponse` na moeda do mundo, para o matcher `toEqualMoney`.
     */
    private money(value: unknown): MoneyResponse {
        if (typeof value !== 'number') {
            throw new Error(`esperado número, recebido ${String(value)}`);
        }
        return { amount: value, currency: this.currency };
    }
}
