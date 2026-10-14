import { describe, expect, it } from 'vitest';
import { ALL_ACCOUNTS, chooseAccountFlow, parseAccountFlowSearch } from '../src/renderer/src/reports/accountFlowSearch.ts';
import { parseTagReportSearch, withTagRange } from '../src/renderer/src/reports/tagReportSearch.ts';

const NUBANK = '11111111-1111-4111-8111-111111111111';
const ITAU = '22222222-2222-4222-8222-222222222222';
const TRIP = '33333333-3333-4333-8333-333333333333';

/**
 * @param ids Contas da lista, na ordem.
 * @return As contas com o único campo que a escolha lê.
 */
function accounts(ids: readonly string[]): readonly { readonly id: string }[] {
    return ids.map((id) => ({ id }));
}

describe('fluxo por conta na URL (desktop-mvp-plan Fase 12.1)', () => {
    it('aceita uma conta ou "total" e descarta o resto', () => {
        expect(parseAccountFlowSearch({ account: NUBANK, period: '2026-10' })).toEqual({ account: NUBANK });
        expect(parseAccountFlowSearch({ account: ALL_ACCOUNTS })).toEqual({ account: 'total' });
        expect(parseAccountFlowSearch({ account: 'nubank' })).toEqual({});
    });

    it('a conta que sumiu volta à primeira; "total" soma as do total', () => {
        expect(chooseAccountFlow(accounts([NUBANK, ITAU]), { account: ITAU })).toEqual({ kind: 'account', accountId: ITAU });
        expect(chooseAccountFlow(accounts([NUBANK, ITAU]), { account: TRIP })).toEqual({ kind: 'account', accountId: NUBANK });
        expect(chooseAccountFlow(accounts([NUBANK]), {})).toEqual({ kind: 'account', accountId: NUBANK });
        expect(chooseAccountFlow(accounts([NUBANK]), { account: ALL_ACCOUNTS })).toEqual({ kind: 'total' });
        expect(chooseAccountFlow(accounts([]), {})).toBeNull();
    });
});

describe('relatório por tag na URL (desktop-mvp-plan Fase 12.2)', () => {
    it('descarta cada parâmetro inválido sozinho e deixa o período padrão fora da URL', () => {
        expect(parseTagReportSearch({ tag: TRIP, range: 'month' })).toEqual({ tag: TRIP, range: 'month' });
        expect(parseTagReportSearch({ tag: 'viagem', range: 'all' })).toEqual({});
        expect(parseTagReportSearch({ range: 'ano' })).toEqual({});
    });

    it('trocar o período mantém a tag e o mês', () => {
        expect(withTagRange({ period: '2026-10', tag: TRIP }, 'month')).toEqual({ period: '2026-10', tag: TRIP, range: 'month' });
        expect(withTagRange({ period: '2026-10', tag: TRIP, range: 'month' }, 'all')).toEqual({ period: '2026-10', tag: TRIP, range: undefined });
    });
});
