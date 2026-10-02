import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * Monta um perfil pessoal com uma conta e uma subcategoria. Existe para que cada cenário
 * declare só o que é próprio dele.
 *
 * @param openingBalance Saldo inicial da conta principal.
 * @return O mundo e os ids semeados.
 */
function setup(openingBalance = 1000): { world: TestWorld; profileId: string; accountId: string; subCategoryId: string; base: { profileId: string; subCategoryId: string } } {
    const world = new TestWorld('2026-03-15');
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance });
    const subCategoryId = world.subCategory(profileId);
    return { world, profileId, accountId, subCategoryId, base: { profileId, subCategoryId } };
}

describe('Teste de mesa 1 — mês simples numa conta corrente', () => {
    it('consolidado soma só o pago; previsto soma tudo', async () => {
        const { world, accountId, base } = setup(1000);
        const source = { kind: 'account', accountId } as const;
        await world.create(base, { source, type: 'income', value: 5000, dueDate: '2026-03-05', paymentDate: '2026-03-05' });
        await world.create(base, { source, value: 1200, dueDate: '2026-03-10', paymentDate: '2026-03-10' });
        await world.create(base, { source, value: 300, dueDate: '2026-03-20' });

        // Consolidado: 1000 + 5000 − 1200 = 4800. Previsto: 4800 − 300 (em aberto) = 4500.
        const march = world.statementRow(accountId, '2026-03');
        expect(march?.opening).toEqualMoney('1000');
        expect(march?.closing).toEqualMoney('4800');
        expect(march?.projectedOpening).toEqualMoney('1000');
        expect(march?.projectedClosing).toEqualMoney('4500');
        expect(world.accountRow(accountId).balance).toEqualMoney('4800');
        expect(world.accountRow(accountId).projected).toEqualMoney('4500');
    });

    it('transação excluída (soft delete) sai dos dois saldos', async () => {
        const { world, accountId, base } = setup(1000);
        const open = await world.create(base, { source: { kind: 'account', accountId }, value: 300, dueDate: '2026-03-20' });
        expect(world.statementRow(accountId, '2026-03')?.projectedClosing).toEqualMoney('700');

        await world.ok('transactions.delete', { id: open.id });
        expect(world.statementRow(accountId, '2026-03')?.projectedClosing).toEqualMoney('1000');
        expect(world.accountRow(accountId).projected).toEqualMoney('1000');
    });
});

describe('Encargos — sempre custo da origem', () => {
    it('despesa, receita e transferência com encargos', async () => {
        const { world, profileId, accountId, base } = setup(0);
        const other = world.account(profileId, { openingBalance: 0 });
        const source = { kind: 'account', accountId } as const;
        const paid = { dueDate: '2026-03-05', paymentDate: '2026-03-05' };
        await world.create(base, { source, ...paid, value: 100, charges: 2 });
        await world.create(base, { source, ...paid, type: 'income', value: 1000, charges: 10 });
        await world.create(base, { source, ...paid, type: 'transference', value: 500, charges: 8, destinationAccountId: other });

        // Origem: −102 + 990 − 508 = 380. Destino: +500. Perfil: 880 = 990 − 102 − 8.
        expect(world.statementRow(accountId, '2026-03')?.closing).toEqualMoney('380');
        expect(world.statementRow(other, '2026-03')?.closing).toEqualMoney('500');
        const balances = await world.ok('balances.ofProfile', { profileId });
        expect(balances.total.consolidated).toEqualMoney('880');
    });
});

describe('Teste de mesa 8 — editar janeiro propaga para os meses seguintes', () => {
    it('recalcula o mês editado e toda a cadeia depois dele', async () => {
        const { world, accountId, base } = setup(1000);
        const source = { kind: 'account', accountId } as const;
        const january = await world.create(base, { source, value: 100, dueDate: '2026-01-10', paymentDate: '2026-01-10' });
        await world.create(base, { source, value: 200, dueDate: '2026-02-10', paymentDate: '2026-02-10' });
        await world.create(base, { source, value: 300, dueDate: '2026-03-10', paymentDate: '2026-03-10' });
        expect(world.statementRow(accountId, '2026-03')?.closing).toEqualMoney('400');

        await world.update(base, january.id, { source, value: 150, dueDate: '2026-01-10', paymentDate: '2026-01-10' });

        // Jan 1000 → 850; fev 850 → 650; mar 650 → 350.
        expect(world.statementRow(accountId, '2026-01')?.closing).toEqualMoney('850');
        expect(world.statementRow(accountId, '2026-02')?.opening).toEqualMoney('850');
        expect(world.statementRow(accountId, '2026-02')?.closing).toEqualMoney('650');
        expect(world.statementRow(accountId, '2026-03')?.opening).toEqualMoney('650');
        expect(world.statementRow(accountId, '2026-03')?.closing).toEqualMoney('350');
        expect(world.accountRow(accountId).balance).toEqualMoney('350');
    });

    it('mudar o vencimento de mês recalcula o mês antigo e o novo', async () => {
        const { world, accountId, base } = setup(1000);
        const source = { kind: 'account', accountId } as const;
        const expense = await world.create(base, { source, value: 300, dueDate: '2026-03-10', paymentDate: '2026-03-10' });

        await world.update(base, expense.id, { source, value: 300, dueDate: '2026-04-10', paymentDate: '2026-04-10' });

        expect(world.statementRow(accountId, '2026-03')?.closing).toEqualMoney('1000');
        expect(world.statementRow(accountId, '2026-04')?.opening).toEqualMoney('1000');
        expect(world.statementRow(accountId, '2026-04')?.closing).toEqualMoney('700');
        // Hoje é março: o saldo exibido é o fechamento de março.
        expect(world.accountRow(accountId).balance).toEqualMoney('1000');
    });
});

describe('Teste de mesa 7 e 11 — transferências e contas fora do total', () => {
    it('transferência é uma linha só: sai da origem, entra no destino, soma zero no perfil', async () => {
        const { world, profileId, accountId, base } = setup(1000);
        const savings = world.account(profileId, { openingBalance: 0 });
        await world.create(base, {
            source: { kind: 'account', accountId },
            type: 'transference',
            destinationAccountId: savings,
            value: 300,
            dueDate: '2026-03-05',
            paymentDate: '2026-03-05',
        });

        expect(world.accountRow(accountId).balance).toEqualMoney('700');
        expect(world.accountRow(savings).balance).toEqualMoney('300');
        const balances = await world.ok('balances.ofProfile', { profileId });
        expect(balances.total.consolidated).toEqualMoney('1000');
    });

    it('transferência em aberto só pesa no previsto das duas contas', async () => {
        const { world, profileId, accountId, base } = setup(1000);
        const savings = world.account(profileId, { openingBalance: 0 });
        await world.create(base, {
            source: { kind: 'account', accountId },
            type: 'transference',
            destinationAccountId: savings,
            value: 300,
            dueDate: '2026-03-25',
        });

        expect(world.accountRow(accountId).balance).toEqualMoney('1000');
        expect(world.accountRow(accountId).projected).toEqualMoney('700');
        expect(world.accountRow(savings).balance).toEqualMoney('0');
        expect(world.accountRow(savings).projected).toEqualMoney('300');
    });

    it('conta com consider_balance desligado aparece, mas fica fora do total', async () => {
        const { world, profileId } = setup(1000);
        world.account(profileId, { openingBalance: 500, considerBalance: false, name: 'Exterior' });
        const balances = await world.ok('balances.ofProfile', { profileId });
        expect(balances.accounts).toHaveLength(2);
        expect(balances.total.consolidated).toEqualMoney('1000');
    });
});

describe('Testes de mesa 2, 4 e 12 — cartão de crédito', () => {
    /**
     * Cartão que fecha no dia 10 e vence no dia 17, quitado pela conta principal.
     *
     * @return O cenário com o cartão.
     */
    function cardSetup(): ReturnType<typeof setup> & { creditCardId: string } {
        const scenario = setup(1000);
        return { ...scenario, creditCardId: scenario.world.creditCard(scenario.profileId, scenario.accountId, 10, 17) };
    }

    it('compra antes, no e depois do fechamento; fatura em aberto entra no previsto do vencimento', async () => {
        const { world, accountId, creditCardId, base } = cardSetup();
        const source = { kind: 'creditCard', creditCardId } as const;
        await world.create(base, { source, value: 400, dueDate: '2026-03-05' });
        await world.create(base, { source, value: 100, dueDate: '2026-03-10' });

        expect(world.invoiceRow(creditCardId, '2026-03')?.balance).toEqualMoney('-400');
        expect(world.invoiceRow(creditCardId, '2026-04')?.balance).toEqualMoney('-100');
        // Fatura de março vence 17/03; a de abril, 17/04. Nada pago: consolidado intacto.
        expect(world.statementRow(accountId, '2026-03')?.closing).toEqualMoney('1000');
        expect(world.statementRow(accountId, '2026-03')?.projectedClosing).toEqualMoney('600');
        expect(world.statementRow(accountId, '2026-04')?.projectedOpening).toEqualMoney('600');
        expect(world.statementRow(accountId, '2026-04')?.projectedClosing).toEqualMoney('500');
        expect(world.accountRow(accountId).projected).toEqualMoney('600');
    });

    it('fatura de março paga em abril entra no extrato de abril e sai do previsto de março', async () => {
        const { world, accountId, creditCardId, base } = cardSetup();
        const source = { kind: 'creditCard', creditCardId } as const;
        const purchase = await world.create(base, { source, value: 400, dueDate: '2026-03-05' });
        await world.create(base, { source, value: 100, dueDate: '2026-03-10' });
        if (purchase.container.kind !== 'invoice') {
            throw new Error('compra no cartão deveria cair numa fatura');
        }

        const paid = await world.ok('invoices.pay', { invoiceId: purchase.container.invoiceId, paymentDate: '2026-04-02' });
        expect(paid.status).toBe('paid');
        expect(paid.paidInPeriod).toBe('2026-04');
        expect(paid.amountDue).toEqualMoney('400');

        // Março: nada pago, nenhuma fatura vencendo em aberto. Abril: −400 pago; −100 em aberto no previsto.
        expect(world.statementRow(accountId, '2026-03')?.projectedClosing).toEqualMoney('1000');
        expect(world.statementRow(accountId, '2026-04')?.closing).toEqualMoney('600');
        expect(world.statementRow(accountId, '2026-04')?.projectedClosing).toEqualMoney('500');

        // Reabrir desfaz o pagamento: o saldo volta como se ele não tivesse acontecido.
        await world.ok('invoices.reopen', { invoiceId: purchase.container.invoiceId });
        expect(world.statementRow(accountId, '2026-03')?.projectedClosing).toEqualMoney('600');
        expect(world.statementRow(accountId, '2026-04')?.closing).toEqualMoney('1000');
    });

    it('pagamento parcial é uma transferência negativa na fatura; excluí-lo devolve o valor', async () => {
        const { world, accountId, creditCardId, base } = cardSetup();
        await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 400, dueDate: '2026-03-05' });
        const partial = await world.create(base, {
            source: { kind: 'creditCard', creditCardId, invoicePeriod: '2026-03' },
            type: 'transference',
            destinationAccountId: accountId,
            value: -150,
            dueDate: '2026-03-12',
            paymentDate: '2026-03-12',
        });

        // Fatura: −400 + 150 = −250. Conta: −150 no consolidado; previsto 1000 − 150 − 250 = 600.
        expect(world.invoiceRow(creditCardId, '2026-03')?.balance).toEqualMoney('-250');
        expect(world.statementRow(accountId, '2026-03')?.closing).toEqualMoney('850');
        expect(world.statementRow(accountId, '2026-03')?.projectedClosing).toEqualMoney('600');

        await world.ok('transactions.delete', { id: partial.id });
        expect(world.invoiceRow(creditCardId, '2026-03')?.balance).toEqualMoney('-400');
        expect(world.statementRow(accountId, '2026-03')?.closing).toEqualMoney('1000');
        expect(world.statementRow(accountId, '2026-03')?.projectedClosing).toEqualMoney('600');
    });

    it('lançar numa fatura já paga a reabre', async () => {
        const { world, creditCardId, base } = cardSetup();
        const purchase = await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 400, dueDate: '2026-03-05' });
        if (purchase.container.kind !== 'invoice') {
            throw new Error('compra no cartão deveria cair numa fatura');
        }
        await world.ok('invoices.pay', { invoiceId: purchase.container.invoiceId, paymentDate: '2026-03-17' });
        expect(world.invoiceRow(creditCardId, '2026-03')?.paidIn).toBe('2026-03');

        await world.create(base, { source: { kind: 'creditCard', creditCardId, invoicePeriod: '2026-03' }, value: 50, dueDate: '2026-03-20' });
        expect(world.invoiceRow(creditCardId, '2026-03')?.paidIn).toBeNull();
        expect(world.invoiceRow(creditCardId, '2026-03')?.balance).toEqualMoney('-450');
    });

    it('estorno (despesa negativa) reduz a fatura', async () => {
        const { world, creditCardId, base } = cardSetup();
        const source = { kind: 'creditCard', creditCardId } as const;
        await world.create(base, { source, value: 400, dueDate: '2026-03-05' });
        await world.create(base, { source, value: -80, dueDate: '2026-03-06' });
        expect(world.invoiceRow(creditCardId, '2026-03')?.balance).toEqualMoney('-320');
    });

    it('editar a data da compra no mesmo cartão não move a despesa de fatura', async () => {
        const { world, creditCardId, base } = cardSetup();
        const purchase = await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 400, dueDate: '2026-03-05' });

        // invoicePeriod nulo na edição mantém a fatura atual em vez de reaplicar a sugestão.
        const edited = await world.update(base, purchase.id, {
            source: { kind: 'creditCard', creditCardId, invoicePeriod: null },
            value: 400,
            dueDate: '2026-03-12',
        });
        expect(edited.container.period).toBe('2026-03');
    });
});

describe('Extrato consolidado e virada do mês', () => {
    it('o extrato do mês mostra transações, entradas e faturas que vencem nele', async () => {
        const { world, profileId, accountId, base } = setup(1000);
        const other = world.account(profileId, { openingBalance: 0 });
        const creditCardId = world.creditCard(profileId, accountId, 10, 17);
        await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-03-03', paymentDate: '2026-03-03' });
        await world.create(base, { source: { kind: 'account', accountId: other }, type: 'transference', destinationAccountId: accountId, value: 50, dueDate: '2026-03-04' });
        await world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 400, dueDate: '2026-03-05' });

        const statement = await world.ok('statements.get', { accountId, period: '2026-03' });
        expect(statement.exists).toBe(true);
        expect(statement.transactions).toHaveLength(1);
        expect(statement.incomingTransfers).toHaveLength(1);
        expect(statement.openInvoicesDue).toHaveLength(1);
        expect(statement.paidInvoices).toHaveLength(0);
        // Consolidado: 1000 − 100. Previsto: 1000 − 100 + 50 − 400.
        expect(statement.closing.consolidated).toEqualMoney('900');
        expect(statement.closing.projected).toEqualMoney('550');
        expect(statement.movement.projected).toEqualMoney('-450');
    });

    it('mês sem extrato repete o fechamento anterior', async () => {
        const { world, accountId, base } = setup(1000);
        await world.create(base, { source: { kind: 'account', accountId }, value: 100, dueDate: '2026-01-03', paymentDate: '2026-01-03' });
        const march = await world.ok('statements.get', { accountId, period: '2026-03' });
        expect(march.exists).toBe(false);
        expect(march.opening.consolidated).toEqualMoney('900');
        expect(march.closing.consolidated).toEqualMoney('900');
    });

    it('na virada do mês, o saldo exibido passa a ser o fechamento do novo mês', async () => {
        const { world, profileId, accountId, base } = setup(1000);
        await world.create(base, { source: { kind: 'account', accountId }, value: 200, dueDate: '2026-04-10', paymentDate: '2026-04-10' });
        expect(world.accountRow(accountId).balance).toEqualMoney('1000');

        world.clock.set('2026-04-20');
        const balances = await world.ok('balances.ofProfile', { profileId });
        expect(balances.accounts[0]?.balances.consolidated).toEqualMoney('800');
        expect(world.accountRow(accountId).balance).toEqualMoney('800');
    });
});
