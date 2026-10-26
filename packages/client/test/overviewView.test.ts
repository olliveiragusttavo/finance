import { describe, expect, it } from 'vitest';
import { overviewAccountRows, overviewCardRows, overviewKpis } from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

describe('indicadores da Visão geral (mockup Main)', () => {
    it('consolidado e previsto iguais ao total de Contas', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const accounts = await world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' });
        const kpis = overviewKpis(accounts);

        expect(kpis.consolidated).toEqual({ label: 'Saldo consolidado', value: formatTotal(accounts.total.consolidated.amount), sub: 'Já pago/recebido · 2 contas', tone: 'strong' });
        expect(kpis.projected).toMatchObject({ label: 'Saldo previsto', value: formatTotal(accounts.total.projected.amount), sub: 'Fim do mês, com tudo lançado', tone: 'projected' });
    });

    it('Regra de negócio (Contas): a contagem do consolidado ignora a conta fora do total, como o próprio total', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        await world.ok('accounts.create', { profileId: s.profileId, name: 'Wise', type: 'checking', considerBalance: false, openingBalance: 2100 });
        const accounts = await world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' });

        expect(overviewKpis(accounts).consolidated.sub).toBe('Já pago/recebido · 2 contas');
    });
});

describe('resumos de contas e cartões', () => {
    it('Regra de negócio (Contas): conta fora do total apagada e só com o consolidado; desativada continua', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const wise = await world.ok('accounts.create', { profileId: s.profileId, name: 'Wise', type: 'checking', considerBalance: false, openingBalance: 2100 });
        await world.ok('accounts.disable', { id: s.savingsId });
        const rows = overviewAccountRows((await world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' })).accounts);

        expect(rows.find((row) => row.accountId === wise.id)).toEqual({
            accountId: wise.id,
            name: 'Wise',
            detail: 'Corrente · fora do total',
            consolidated: 'R$ 2.100,00',
            projected: null,
            outsideTotal: true,
            disabled: false,
        });
        expect(rows.find((row) => row.accountId === s.savingsId)).toMatchObject({ detail: 'Investimentos', outsideTotal: false, disabled: true });
        expect(rows.find((row) => row.accountId === s.checkingId)?.projected).toMatch(/^previsto R\$ /);
    });

    it('Regra de negócio (Fatura): paga, em aberto ou sem fatura no mês, com o vencimento e a conta que paga', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const accounts = (await world.ok('accounts.list', { profileId: s.profileId, period: '2026-10' })).accounts;
        const rowOf = async (period: string): Promise<ReturnType<typeof overviewCardRows>[number] | undefined> =>
            overviewCardRows(await world.ok('creditCards.list', { profileId: s.profileId, period }), accounts)[0];

        expect(await rowOf('2026-09')).toEqual({ creditCardId: s.creditCardId, name: 'Roxinho', detail: 'vence 10/09 · paga com Nubank', status: { text: 'Paga', tone: 'ok' }, amount: 'R$ 120,00', disabled: false });
        expect(await rowOf('2026-11')).toMatchObject({ detail: 'vence 10/11 · paga com Nubank', status: { text: 'Em aberto', tone: 'warn' }, amount: 'R$ 487,32' });
        expect(await rowOf('2026-10')).toMatchObject({ detail: 'vence 10/10 · paga com Nubank', status: null, amount: '—' });
    });
});

/**
 * Formata um saldo pelo caminho mais curto, sem os formatadores do `client`, para que o teste
 * não confira o formatador contra ele mesmo.
 *
 * @param amount Valor em reais.
 * @return `R$ 1.234,56` ou `−R$ 1.234,56`.
 */
function formatTotal(amount: number): string {
    const [integer = '0', fraction = '00'] = Math.abs(amount).toFixed(2).split('.');
    return `${amount < 0 ? '−' : ''}R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction}`;
}
