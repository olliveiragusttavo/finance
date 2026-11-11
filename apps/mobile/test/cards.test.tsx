import { formatInvoiceAmount, formatInvoiceSituation, formatMoney } from '@finance/client';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { fixToday, restoreToday } from './support/fixedToday.ts';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';
import { ok, SCENARIO_PERIOD, SCENARIO_TODAY, seedScenario, type Scenario } from './support/scenario.ts';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/** Competência da fatura que recebe a compra de 06/10 do cenário: o Roxinho fecha no dia 3. */
const NOVEMBER = '2026-11';

/** O que os testes de Cartões usam: o núcleo, os ids do cenário e o app aberto. */
interface OpenedCards {
    readonly core: ReturnType<typeof testCore>['core'];
    readonly s: Scenario;
    readonly app: Awaited<ReturnType<typeof renderApp>>;
}

/**
 * @param period Mês de referência guardado no aparelho.
 * @param initialUrl Tela em que o app abre.
 * @return O núcleo com o cenário, o Roxinho como cartão padrão e o app aberto.
 */
async function openApp(period: string, initialUrl: string): Promise<OpenedCards> {
    fixToday(2026, 10, 15);
    const { core } = testCore(SCENARIO_TODAY);
    const s = await seedScenario(core);
    await ok(core, 'profiles.setDefaultCreditCard', { profileId: s.profileId, creditCardId: s.creditCardId });
    const app = await renderApp(core, { preferences: { lastPeriod: period }, initialUrl });
    return { core, s, app };
}

/**
 * Abre a aba Cartões em novembro e a fatura do Roxinho pela lista, como o usuário faz.
 *
 * @return O app aberto na fatura de novembro.
 */
async function openNovemberInvoice(): Promise<OpenedCards> {
    const opened = await openApp(NOVEMBER, '/cards');
    await fireEvent.press(await screen.findByRole('button', { name: /^Roxinho, / }));
    await waitFor(() => {
        expect(opened.app.getPathname()).toBe(`/cards/${opened.s.creditCardId}`);
    });
    await screen.findByRole('button', { name: /^Supermercado, / });
    return opened;
}

/**
 * @param core Núcleo do teste.
 * @param s Ids do cenário.
 * @return A fatura de novembro do Roxinho, como o núcleo a tem agora.
 * @throws {Error} Quando a competência não tem fatura.
 */
async function novemberInvoice(core: OpenedCards['core'], s: Scenario): Promise<NonNullable<Awaited<ReturnType<typeof ok<'invoices.listByCard'>>>[number]['invoice']>> {
    const [cycle] = await ok(core, 'invoices.listByCard', { creditCardId: s.creditCardId, from: NOVEMBER });
    if (cycle?.invoice === null || cycle?.invoice === undefined) {
        throw new Error('sem a fatura de novembro');
    }
    return cycle.invoice;
}

/**
 * @return A última folha aberta.
 * @throws {Error} Quando nenhuma folha está aberta.
 */
function lastSheet(): ReturnType<typeof screen.getByTestId> {
    const sheet = screen.getAllByTestId('bottom-sheet').at(-1);
    if (sheet === undefined) {
        throw new Error('nenhuma folha aberta');
    }
    return sheet;
}

afterEach(restoreToday);

describe('Cartões (mobile-mvp-plan, Fase 13)', () => {
    it('lista os cartões com a fatura do mês, o selo Padrão e os totais do núcleo', async () => {
        const { core, s } = await openApp(NOVEMBER, '/cards');
        const list = await ok(core, 'creditCards.list', { profileId: s.profileId, period: NOVEMBER });
        const [card] = list.creditCards;
        if (card === undefined) {
            throw new Error('sem o cartão');
        }

        expect(await screen.findByRole('button', { name: `Roxinho, padrão, ${formatInvoiceSituation(card.invoiceOfMonth)}, ${formatInvoiceAmount(card.invoiceOfMonth)}` })).toBeOnTheScreen();
        const totals = screen.getByLabelText('Totais das faturas');
        // Só o Roxinho tem fatura em novembro: "em aberto" e "total das faturas" coincidem.
        expect(within(totals).getAllByText(formatMoney(list.openTotal, 'absolute'))).toHaveLength(2);
    });

    it('a fatura mostra o resumo, os lançamentos e abre a compra na aba Cartões', async () => {
        const { s, app } = await openNovemberInvoice();

        const summary = screen.getByLabelText('Resumo da fatura');
        expect(within(summary).getByText('R$ 487,32')).toBeOnTheScreen();
        expect(within(summary).getByText('Em aberto')).toBeOnTheScreen();

        await fireEvent.press(screen.getByRole('button', { name: /^Supermercado, / }));
        await waitFor(() => {
            expect(app.getPathname()).toBe(`/cards/transaction/${s.purchaseId}`);
        });
        expect(await screen.findByText('Despesa')).toBeOnTheScreen();
    });

    it('paga a fatura inteira, e o saldo da conta pagadora cai no extrato do pagamento', async () => {
        const { core, s } = await openNovemberInvoice();
        const before = await ok(core, 'statements.get', { accountId: s.checkingId, period: SCENARIO_PERIOD });

        await fireEvent.press(screen.getByRole('button', { name: 'Pagar fatura' }));
        expect(within(lastSheet()).getByText('Nubank')).toBeOnTheScreen();
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Confirmar pagamento' }));

        expect(await screen.findByRole('button', { name: 'Reabrir fatura' })).toBeOnTheScreen();
        expect(await novemberInvoice(core, s)).toMatchObject({ status: 'paid', paidInPeriod: SCENARIO_PERIOD });
        const after = await ok(core, 'statements.get', { accountId: s.checkingId, period: SCENARIO_PERIOD });
        expect(after.closing.consolidated.amount).toBeCloseTo(before.closing.consolidated.amount - 487.32, 2);
    });

    it('reabre a fatura paga', async () => {
        const opened = await openApp(NOVEMBER, '/cards');
        const { core, s } = opened;
        await ok(core, 'invoices.pay', { invoiceId: (await novemberInvoice(core, s)).id, paymentDate: SCENARIO_TODAY });
        await fireEvent.press(await screen.findByRole('button', { name: /^Roxinho, / }));

        await fireEvent.press(await screen.findByRole('button', { name: 'Reabrir fatura' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Reabrir fatura' }));

        expect(await screen.findByRole('button', { name: 'Pagar fatura' })).toBeOnTheScreen();
        expect((await novemberInvoice(core, s)).status).toBe('open');
    });

    it('lança um pagamento parcial, que abate a fatura e a deixa em aberto', async () => {
        const { core, s } = await openNovemberInvoice();

        await fireEvent.press(screen.getByRole('button', { name: 'Parcial' }));
        await fireEvent.changeText(screen.getByLabelText('Valor pago'), '100,00');
        await fireEvent.press(screen.getByRole('button', { name: 'Subcategoria: Escolha a subcategoria' }));
        await fireEvent.press(within(lastSheet()).getByRole('radio', { name: 'Alimentação › Mercado' }));
        await fireEvent.press(screen.getByRole('button', { name: 'Lançar pagamento' }));

        await waitFor(() => {
            expect(screen.queryAllByTestId('bottom-sheet')).toHaveLength(0);
        });
        const invoice = await novemberInvoice(core, s);
        expect(invoice.status).toBe('open');
        expect(invoice.amountDue.amount).toBeCloseTo(387.32, 2);
    });

    it('cria um cartão pelo + com a conta pagadora sugerida e abre a fatura dele', async () => {
        const { core, s, app } = await openApp(NOVEMBER, '/cards');
        await screen.findByRole('button', { name: /^Roxinho, / });

        await fireEvent.press(screen.getByRole('button', { name: 'Adicionar cartão' }));
        await fireEvent.changeText(screen.getByLabelText('Nome do cartão'), 'Platinum');
        await fireEvent.changeText(screen.getByLabelText('Limite'), '3.000,00');
        await fireEvent.changeText(screen.getByLabelText('Dia do fechamento'), '30');
        expect(screen.getByText('Nos meses sem o dia 30, a fatura fecha no último dia do mês.')).toBeOnTheScreen();
        await fireEvent.changeText(screen.getByLabelText('Dia do vencimento'), '7');
        await fireEvent.press(screen.getByRole('button', { name: 'Criar cartão' }));

        await waitFor(() => {
            expect(app.getPathname()).toMatch(/^\/cards\/[^/]+$/);
        });
        expect(await screen.findByText('Platinum')).toBeOnTheScreen();
        const list = await ok(core, 'creditCards.list', { profileId: s.profileId, period: NOVEMBER });
        expect(list.creditCards.find((card) => card.name === 'Platinum')).toMatchObject({ accountId: s.checkingId, closingDay: 30, dueDay: 7, limit: { amount: 3000 } });
    });

    it('exclui o cartão em cadeia só depois de mostrar o impacto e de digitar o nome', async () => {
        const { core, s, app } = await openNovemberInvoice();

        await fireEvent.press(screen.getByRole('button', { name: 'Ações do cartão' }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Excluir cartão…' }));
        expect(await screen.findByText('Também serão apagados:')).toBeOnTheScreen();
        expect(screen.getByRole('button', { name: 'Excluir cartão' })).toBeDisabled();

        await fireEvent.changeText(screen.getByLabelText('Digite Roxinho para confirmar'), 'Roxinho');
        await fireEvent.press(screen.getByRole('button', { name: 'Excluir cartão' }));

        await waitFor(() => {
            expect(app.getPathname()).toBe('/cards');
        });
        expect(await screen.findByText('Nenhum cartão')).toBeOnTheScreen();
        expect((await ok(core, 'creditCards.list', { profileId: s.profileId, period: NOVEMBER })).creditCards).toHaveLength(0);
    });

    it('a linha da fatura em Transações abre aquela fatura, e o aviso leva à do mês', async () => {
        const { s, app } = await openApp(SCENARIO_PERIOD, '/transactions');

        await fireEvent.press(await screen.findByRole('button', { name: /^Fatura Roxinho · set, / }));
        await waitFor(() => {
            expect(app.getPathname()).toBe(`/cards/${s.creditCardId}`);
        });
        expect(await screen.findByText('Esta é a fatura de set/2026, não a do mês de referência.')).toBeOnTheScreen();
        expect(await screen.findByRole('button', { name: 'Reabrir fatura' })).toBeOnTheScreen();

        await fireEvent.press(screen.getByRole('link', { name: 'Ver a fatura de out/2026' }));
        await waitFor(() => {
            expect(screen.queryByText(/não a do mês de referência/)).toBeNull();
        });
    });
});
