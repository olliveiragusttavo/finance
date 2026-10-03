import { createCore, LocalDate, openDatabase, parseTimestamp, parseUuid, type Clock, type CoreInput, type CoreOutput, type CoreRoute, type IdGenerator, type Timestamp, type Uuid } from '@finance/core';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { DirectCoreClient } from '../../src/index.ts';

/**
 * Relógio fixo dos testes: "hoje" decide o mês corrente, a fatura em aberto e o "pago hoje"
 * do atalho `P`, então precisa ser determinístico.
 */
class FixedClock implements Clock {
    /**
     * @param day Data de "hoje", `YYYY-MM-DD`.
     */
    public constructor(private readonly day: string) {}

    /** @return Meio-dia UTC de "hoje"; o horário não importa para as regras. */
    public now(): Timestamp {
        return parseTimestamp(`${this.day} 12:00:00`);
    }

    /** @return O "hoje" fixado. */
    public today(): LocalDate {
        return LocalDate.parse(this.day);
    }
}

/** Ids sequenciais: falhas reproduzíveis e mensagens legíveis, no formato que o schema exige. */
class SequentialIds implements IdGenerator {
    private counter = 0;

    /** @return O próximo UUID v4 da sequência. */
    public random(): Uuid {
        this.counter++;
        return parseUuid(`00000000-0000-4000-8000-${this.counter.toString(16).padStart(12, '0')}`);
    }
}

/** Ids do cenário padrão, para montar as entradas das rotas. */
export interface Scenario {
    readonly profileId: string;
    readonly checkingId: string;
    readonly savingsId: string;
    readonly creditCardId: string;
    readonly categoryId: string;
    readonly subCategoryId: string;
    readonly otherSubCategoryId: string;
    /** Subcategoria de outra categoria: destino ao excluir a categoria inteira. */
    readonly housingSubCategoryId: string;
    readonly incomeId: string;
    readonly expenseId: string;
    readonly purchaseId: string;
    readonly transferId: string;
    readonly paidInvoiceId: string;
    readonly openInvoiceId: string;
}

/**
 * Núcleo de verdade sobre SQLite em memória, visto pela UI através do `DirectCoreClient` —
 * o mesmo caminho que as telas usam, sem abrir o Electron (desktop-mvp-plan §4).
 */
export class ClientWorld {
    public readonly client: DirectCoreClient;

    /**
     * @param today Data de "hoje" do relógio do núcleo.
     */
    public constructor(today = '2026-10-15') {
        const clock = new FixedClock(today);
        const database = BetterSqliteDatabase.open(':memory:');
        openDatabase(database, { backups: null, clock });
        this.client = new DirectCoreClient(createCore({
            database,
            clock,
            ids: new SequentialIds(),
            onUnexpectedError: (error) => {
                throw error;
            },
        }));
    }

    /**
     * Chama a rota e falha o teste se ela não der certo: no cenário, toda chamada é válida, e
     * uma falha aqui é bug do cenário, não o que está sendo testado.
     *
     * @param route Rota chamada.
     * @param input Entrada da rota.
     * @return Os dados da rota.
     * @throws {Error} Quando a rota falha, com o erro do núcleo na mensagem.
     */
    public async ok<R extends CoreRoute>(route: R, input: CoreInput<R>): Promise<CoreOutput<R>> {
        const result = await this.client.call(route, input);
        if (!result.ok) {
            throw new Error(`${route} falhou: ${JSON.stringify(result.error)}`);
        }
        return result.data;
    }

    /**
     * Monta o cenário que exercita todas as leituras: perfil com duas contas, cartão pago por
     * uma delas, receita, despesa pendente, compra no cartão em aberto, fatura de setembro
     * paga em outubro e transferência entre as contas.
     *
     * @return Os ids do cenário.
     */
    public async seed(): Promise<Scenario> {
        const { profile, account } = await this.ok('onboarding.start', {
            profile: { name: 'Pessoal', type: 'personal', currency: 'BRL' },
            account: { name: 'Nubank', type: 'checking', openingBalance: 1000 },
            suggestedCategories: false,
        });
        const savings = await this.ok('accounts.create', { profileId: profile.id, name: 'Tesouro', type: 'investment' });
        const category = await this.ok('categories.create', { profileId: profile.id, name: 'Alimentação' });
        const sub = await this.ok('subCategories.create', { categoryId: category.id, name: 'Mercado' });
        const other = await this.ok('subCategories.create', { categoryId: category.id, name: 'Restaurantes' });
        const housing = await this.ok('categories.create', { profileId: profile.id, name: 'Moradia' });
        const rent = await this.ok('subCategories.create', { categoryId: housing.id, name: 'Aluguel' });
        const card = await this.ok('creditCards.create', { profileId: profile.id, accountId: account.id, name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10 });
        const base = { profileId: profile.id, subCategoryId: sub.id } as const;
        const income = await this.ok('transactions.create', { ...base, type: 'income', source: { kind: 'account', accountId: account.id }, name: 'Salário', value: 9500, dueDate: '2026-10-01', paymentDate: '2026-10-01' });
        const expense = await this.ok('transactions.create', { ...base, type: 'expense', source: { kind: 'account', accountId: account.id }, name: 'Aluguel', value: 2300, dueDate: '2026-10-05' });
        const september = await this.ok('transactions.create', { ...base, type: 'expense', source: { kind: 'creditCard', creditCardId: card.id }, name: 'Feira', value: 120, dueDate: '2026-08-20' });
        const purchase = await this.ok('transactions.create', { ...base, type: 'expense', source: { kind: 'creditCard', creditCardId: card.id }, name: 'Supermercado', value: 487.32, dueDate: '2026-10-06' });
        const transfer = await this.ok('transactions.create', { ...base, type: 'transference', source: { kind: 'account', accountId: account.id }, destinationAccountId: savings.id, name: 'Aporte', value: 500, dueDate: '2026-10-10' });
        const paidInvoiceId = invoiceIdOf(september);
        await this.ok('invoices.pay', { invoiceId: paidInvoiceId, paymentDate: '2026-10-02' });
        return {
            profileId: profile.id,
            checkingId: account.id,
            savingsId: savings.id,
            creditCardId: card.id,
            categoryId: category.id,
            subCategoryId: sub.id,
            otherSubCategoryId: other.id,
            housingSubCategoryId: rent.id,
            incomeId: income.id,
            expenseId: expense.id,
            purchaseId: purchase.id,
            transferId: transfer.id,
            paidInvoiceId,
            openInvoiceId: invoiceIdOf(purchase),
        };
    }
}

/**
 * @param transaction Compra no cartão.
 * @return O id da fatura em que ela caiu.
 * @throws {Error} Quando a transação não é de cartão — erro de montagem do cenário.
 */
function invoiceIdOf(transaction: CoreOutput<'transactions.create'>): string {
    if (transaction.container.kind !== 'invoice') {
        throw new Error(`${transaction.name} não está numa fatura`);
    }
    return transaction.container.invoiceId;
}
