import { describe, expect, it } from 'vitest';
import {
    describeTransactionDeletion,
    destinationAccountOptions,
    formatTransactionType,
    invoiceChoices,
    invoiceReopenWarning,
    previewTransactionValue,
    recalculationNotice,
    subCategoryOptions,
    TRANSACTION_TYPE_ORDER,
    transactionSourceOptions,
} from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

const NUBANK = { id: 'nubank', name: 'Nubank', disabled: false };
const OLD = { id: 'old', name: 'Conta antiga', disabled: true };
const TESOURO = { id: 'tesouro', name: 'Tesouro', disabled: false };
const ROXINHO = { id: 'roxinho', name: 'Roxinho', disabled: false };
const RETIRED = { id: 'retired', name: 'Cartão antigo', disabled: true };

describe('origem e destino do lançamento (desktop-mvp-plan §5.1)', () => {
    it('lançamento novo só oferece contas e cartões ativos', () => {
        const options = transactionSourceOptions({ accounts: [NUBANK, OLD], creditCards: [ROXINHO, RETIRED], current: null });
        expect(options.accounts.map((option) => option.name)).toEqual(['Nubank']);
        expect(options.creditCards.map((option) => option.name)).toEqual(['Roxinho']);
    });

    it('a edição mantém a origem atual mesmo desativada, marcada', () => {
        const onOldAccount = transactionSourceOptions({
            accounts: [NUBANK, OLD],
            creditCards: [ROXINHO, RETIRED],
            current: { kind: 'statement', statementId: 's', accountId: 'old', period: '2026-10' },
        });
        expect(onOldAccount.accounts).toEqual([
            { kind: 'account', id: 'nubank', name: 'Nubank', disabled: false },
            { kind: 'account', id: 'old', name: 'Conta antiga', disabled: true },
        ]);
        expect(onOldAccount.creditCards.map((option) => option.id)).toEqual(['roxinho']);

        const onRetiredCard = transactionSourceOptions({
            accounts: [NUBANK],
            creditCards: [ROXINHO, RETIRED],
            current: { kind: 'invoice', invoiceId: 'i', creditCardId: 'retired', period: '2026-10' },
        });
        expect(onRetiredCard.creditCards.map((option) => option.id)).toEqual(['roxinho', 'retired']);
    });

    it('o destino exclui a conta de origem e as desativadas, menos a atual', () => {
        const ids = (originAccountId: string | null, currentDestinationId: string | null): readonly string[] =>
            destinationAccountOptions({ accounts: [NUBANK, OLD, TESOURO], originAccountId, currentDestinationId }).map((option) => option.id);
        expect(ids('nubank', null)).toEqual(['tesouro']);
        expect(ids(null, null)).toEqual(['nubank', 'tesouro']);
        expect(ids('nubank', 'old')).toEqual(['old', 'tesouro']);
    });
});

describe('tipo do lançamento', () => {
    it('rotula os quatro tipos na ordem do seletor', () => {
        expect(TRANSACTION_TYPE_ORDER.map(formatTransactionType)).toEqual(['Despesa', 'Receita', 'Transferência', 'Investimento']);
    });
});

describe('subcategoria com busca', () => {
    it('busca na categoria e na subcategoria juntas, sem acento e em qualquer ordem', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const tree = await world.ok('categories.tree', { profileId: s.profileId });
        const labels = (query: string): readonly string[] => subCategoryOptions(tree, query).map((option) => option.label);

        expect(labels('')).toEqual(['Alimentação › Mercado', 'Alimentação › Restaurantes', 'Moradia › Aluguel']);
        expect(labels('ALIMENTACAO')).toEqual(['Alimentação › Mercado', 'Alimentação › Restaurantes']);
        expect(labels('mercado alim')).toEqual(['Alimentação › Mercado']);
        expect(labels('nada')).toEqual([]);
        expect(subCategoryOptions(tree, 'aluguel')[0]).toMatchObject({ id: s.housingSubCategoryId, categoryName: 'Moradia', name: 'Aluguel' });
    });
});

describe('troca de fatura (database-design §4.7)', () => {
    it('oferece a anterior, a sugerida e as duas seguintes, com a situação de cada uma', () => {
        const choices = invoiceChoices({
            suggestedPeriod: '2026-11',
            currentPeriod: null,
            invoices: [
                { period: '2026-10', status: 'paid' },
                { period: '2026-11', status: 'open' },
            ],
        });
        expect(choices.map((choice) => [choice.period, choice.label, choice.status])).toEqual([
            ['2026-10', 'out/2026 · paga', 'paid'],
            ['2026-11', 'nov/2026 · sugerida', 'open'],
            ['2026-12', 'dez/2026', null],
            ['2027-01', 'jan/2027', null],
        ]);
    });

    it('na edição, a fatura atual entra mesmo longe da sugerida, e atravessa a virada do ano', () => {
        const choices = invoiceChoices({ suggestedPeriod: '2027-01', currentPeriod: '2026-08', invoices: [] });
        expect(choices.map((choice) => choice.label)).toEqual(['ago/2026 · atual', 'dez/2026', 'jan/2027 · sugerida', 'fev/2027', 'mar/2027']);
        expect(choices.find((choice) => choice.current)?.period).toBe('2026-08');
    });

    it('avisa que a fatura paga escolhida será reaberta, menos quando o lançamento já está nela', () => {
        const paid = { period: '2026-10', status: 'paid', paidInPeriod: '2026-10' } as const;
        expect(invoiceReopenWarning({ invoice: paid, current: false, payingAccountName: 'Nubank' })).toBe(
            'A fatura de out/2026 já está paga. Ao salvar, ela será reaberta: o pagamento sai do extrato de out/2026 da conta Nubank, e a fatura precisa ser paga de novo.',
        );
        expect(invoiceReopenWarning({ invoice: paid, current: true, payingAccountName: 'Nubank' })).toBeNull();
        expect(invoiceReopenWarning({ invoice: { ...paid, status: 'open', paidInPeriod: null }, current: false, payingAccountName: 'Nubank' })).toBeNull();
        expect(invoiceReopenWarning({ invoice: null, current: false, payingAccountName: 'Nubank' })).toBeNull();
    });
});

describe('aviso de recálculo dos meses seguintes', () => {
    it('avisa pelo mês passado mais antigo entre o de antes e o de depois', () => {
        const today = '2026-10-15';
        expect(recalculationNotice({ before: '2026-10', after: '2026-11', today })).toBeNull();
        expect(recalculationNotice({ before: null, after: '2026-10', today })).toBeNull();
        expect(recalculationNotice({ before: null, after: null, today })).toBeNull();
        expect(recalculationNotice({ before: '2026-10', after: '2026-08', today })).toBe(
            'Este lançamento mexe em ago/2026, um mês passado: ao salvar, os saldos dos meses seguintes são recalculados.',
        );
        expect(recalculationNotice({ before: '2026-09', after: '2026-12', today })).toContain('set/2026');
    });
});

describe('prévia do valor pela regra de sinal do núcleo', () => {
    it('mostra o sinal do efeito, o estorno e a transferência sem depender da cor', () => {
        const preview = (type: 'income' | 'expense' | 'transference', value: number, charges = 0): readonly unknown[] => {
            const result = previewTransactionValue({ type, value, charges, currency: 'BRL' });
            return [result.text, result.direction, result.refund];
        };
        expect(preview('expense', 487.32)).toEqual(['−R$ 487,32', 'out', false]);
        expect(preview('expense', -23.9)).toEqual(['+R$ 23,90', 'in', true]);
        expect(preview('expense', 100, 2)).toEqual(['−R$ 102,00', 'out', false]);
        expect(preview('income', 1000, 10)).toEqual(['+R$ 990,00', 'in', false]);
        expect(preview('transference', 500, 8)).toEqual(['⇄ R$ 508,00', 'transfer', false]);
        expect(preview('expense', 0)).toEqual(['R$ 0,00', 'in', false]);
    });
});

describe('confirmação de exclusão (brief §4, regra 9)', () => {
    it('diz de onde o valor sai e quais saldos mudam', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const [accounts, creditCards] = await Promise.all([
            world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' }),
            world.ok('creditCards.list', { profileId: s.profileId, period: '2026-10' }),
        ]);
        const deletionOf = async (id: string): Promise<{ readonly title: string; readonly description: string }> =>
            describeTransactionDeletion({ transaction: await world.ok('transactions.get', { id }), accounts: accounts.accounts, creditCards: creditCards.creditCards });

        expect(await deletionOf(s.expenseId)).toEqual({
            title: 'Excluir “Aluguel”?',
            description: 'O lançamento de R$ 2.300,00 sai do extrato de out/2026, e os saldos da conta Nubank são recalculados desse mês em diante.',
        });
        expect((await deletionOf(s.transferId)).description).toContain('os saldos das contas Nubank e Tesouro são recalculados');
        expect((await deletionOf(s.purchaseId)).description).toBe('O lançamento de R$ 487,32 sai da fatura de nov/2026 do cartão Roxinho, e o total da fatura muda.');

        const partial = await world.ok('transactions.create', {
            profileId: s.profileId,
            subCategoryId: s.subCategoryId,
            type: 'transference',
            source: { kind: 'creditCard', creditCardId: s.creditCardId, invoicePeriod: '2026-11' },
            destinationAccountId: s.checkingId,
            name: 'Pagamento parcial',
            value: -100,
            dueDate: '2026-10-12',
            paymentDate: '2026-10-12',
        });
        expect((await deletionOf(partial.id)).description).toBe(
            'O pagamento parcial de R$ 100,00 sai da fatura de nov/2026 do cartão Roxinho: o valor volta a pesar na fatura e retorna à conta Nubank.',
        );
    });
});
