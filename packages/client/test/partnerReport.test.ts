import type { EntriesWithoutPartnerResponse, MoneyResponse, PartnerLineResponse, PartnerReportResponse, TransactionResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { buildPartnerReportView, buildUnassignedEntryList } from '../src/index.ts';

/**
 * @param amount Valor.
 * @return Dinheiro em BRL como vem do núcleo.
 */
function brl(amount: number): MoneyResponse {
    return { amount, currency: 'BRL' };
}

const MATHEUS: PartnerLineResponse = { partnerId: 'matheus', name: 'Matheus', share: 0.6, contributed: brl(1000), expected: brl(1200), difference: brl(-200), count: 2 };
const GUSTAVO: PartnerLineResponse = { partnerId: 'gustavo', name: 'Gustavo', share: 0.4, contributed: brl(1000), expected: brl(800), difference: brl(200), count: 1 };

/** O exemplo dos aportes: R$ 2.000,00 no total, Matheus (60%) e Gustavo (40%) com R$ 1.000,00 cada. */
const REPORT: PartnerReportResponse = {
    period: '2026-10',
    contributions: brl(2000),
    monthContributions: brl(500),
    monthContributionCount: 1,
    unassigned: brl(4000),
    unassignedCount: 2,
    partners: [MATHEUS, GUSTAVO],
    sharesTotal: 1,
    settlements: [{ fromPartnerId: 'matheus', toPartnerId: 'gustavo', amount: brl(200) }],
};

describe('relatório por sócio — aportes', () => {
    it('monta indicadores, tabela, gráfico e acerto do exemplo', () => {
        const view = buildPartnerReportView(REPORT);

        expect(view.kpis).toEqual({
            contributions: { label: 'Total de aportes', value: 'R$ 2.000,00', sub: 'todos os períodos · base da divisão' },
            month: { label: 'Aportes em out/2026', value: 'R$ 500,00', sub: '1 lançamento' },
            unassigned: { label: 'Entradas sem sócio em out/2026', value: 'R$ 4.000,00', sub: '2 lançamentos · fora da divisão' },
        });
        expect(view.rows).toEqual([
            { partnerId: 'matheus', name: 'Matheus', share: '60%', expected: 'R$ 1.200,00', contributed: 'R$ 1.000,00', difference: '▼ −R$ 200,00 · aportou a menos', balance: 'less' },
            { partnerId: 'gustavo', name: 'Gustavo', share: '40%', expected: 'R$ 800,00', contributed: 'R$ 1.000,00', difference: '▲ +R$ 200,00 · aportou a mais', balance: 'more' },
        ]);
        expect(view.total).toEqual({ share: '100%', expected: 'R$ 2.000,00', contributed: 'R$ 2.000,00' });
        expect(view.bars).toEqual([
            { partnerId: 'matheus', name: 'Matheus', contributedWidth: 83.3, expectedWidth: 100 },
            { partnerId: 'gustavo', name: 'Gustavo', contributedWidth: 83.3, expectedWidth: 66.7 },
        ]);
        expect(view.transfers).toEqual([{ from: 'Matheus', to: 'Gustavo', amount: 'R$ 200,00' }]);
        expect(view.note).toBeNull();
        expect(view.sharesWarning).toBeNull();
    });

    it('sem entrada sem sócio no mês, o indicador diz que não há', () => {
        const view = buildPartnerReportView({ ...REPORT, unassigned: brl(0), unassignedCount: 0 });
        expect(view.kpis.unassigned.sub).toBe('nenhuma entrada sem sócio');
    });

    it('explica a falta de acerto: aportes equilibrados, nenhum aporte, participações fora de 100% e perfil sem sócio', () => {
        const even = buildPartnerReportView({
            ...REPORT,
            partners: [{ ...MATHEUS, contributed: brl(1200), difference: brl(0) }, { ...GUSTAVO, contributed: brl(800), difference: brl(0) }],
            settlements: [],
        });
        expect(even.note).toBe('Os aportes estão equilibrados: cada sócio aportou a sua parte.');
        expect(even.rows.map((row) => [row.difference, row.balance])).toEqual([['em dia', 'even'], ['em dia', 'even']]);

        const none = buildPartnerReportView({ ...REPORT, contributions: brl(0), partners: [{ ...MATHEUS, contributed: brl(0), expected: brl(0), difference: brl(0) }], settlements: [] });
        expect(none.note).toContain('Nenhum aporte com sócio ainda');

        const partial = buildPartnerReportView({ ...REPORT, partners: [MATHEUS, { ...GUSTAVO, share: 1 / 3 }], sharesTotal: 0.6 + 1 / 3, settlements: [] });
        expect(partial.rows[1]?.share).toBe('33,3%');
        expect(partial.total.share).toBe('93,3%');
        expect(partial.sharesWarning).toContain('somam 93,3%');
        expect(partial.note).toBe('Sem acerto sugerido: as participações não somam 100%.');

        const alone = buildPartnerReportView({ ...REPORT, contributions: brl(0), partners: [], sharesTotal: 0, settlements: [] });
        expect(alone.hasPartners).toBe(false);
        expect(alone.sharesWarning).toBeNull();
        expect(alone.note).toContain('ainda não tem sócios cadastrados');
    });
});

/**
 * @param overrides Campos da transação que o teste fixa.
 * @return Uma transação do núcleo com padrões válidos.
 */
function transaction(overrides: Partial<TransactionResponse> & Pick<TransactionResponse, 'id' | 'profileId' | 'type' | 'container'>): TransactionResponse {
    return {
        recurrenceId: null,
        occurrence: null,
        subCategoryId: 'servicos',
        destinationAccountId: null,
        partnerId: null,
        goalId: null,
        goalWithdrawal: false,
        name: 'Lançamento',
        description: null,
        value: brl(100),
        charges: brl(0),
        originCurrency: 'BRL',
        conversionRate: 1,
        dueDate: '2026-10-14',
        paymentDate: '2026-10-14',
        paid: true,
        tagIds: [],
        originEffect: brl(100),
        destinationEffect: null,
        ...overrides,
    };
}

describe('lista de entradas sem sócio', () => {
    it('a receita sai com +, e a transferência vinda do perfil pessoal como recebida, com a conta de origem e o perfil', () => {
        const response: EntriesWithoutPartnerResponse = {
            period: '2026-10',
            total: brl(4500),
            transactions: [
                transaction({ id: 'projeto', profileId: 'empresa', type: 'income', name: 'Projeto do cliente', value: brl(4000), originEffect: brl(4000), container: { kind: 'statement', statementId: 's1', accountId: 'pj', period: '2026-10' } }),
                transaction({
                    id: 'pix',
                    profileId: 'pessoal',
                    type: 'transference',
                    name: 'Pix do Gustavo',
                    subCategoryId: 'sub-pessoal',
                    value: brl(500),
                    originEffect: brl(-500),
                    destinationAccountId: 'pj',
                    destinationEffect: brl(500),
                    dueDate: '2026-10-20',
                    paymentDate: '2026-10-20',
                    container: { kind: 'statement', statementId: 's2', accountId: 'nubank', period: '2026-10' },
                }),
            ],
        };
        const list = buildUnassignedEntryList(response, {
            profileId: 'empresa',
            accounts: [{ id: 'pj', name: 'Conta PJ' }],
            creditCards: [],
            categories: [{ id: 'receitas', profileId: 'empresa', name: 'Receitas', subCategories: [{ id: 'servicos', categoryId: 'receitas', name: 'Serviços', transactionCount: 1 }] }],
            tags: [],
            otherProfileAccounts: [{ id: 'nubank', name: 'Nubank', profileName: 'Pessoal' }],
        });

        expect(list.rows.map((row) => [row.name, row.category, row.container, row.amountText])).toEqual([
            ['Projeto do cliente', 'Receitas › Serviços', 'Conta PJ', '+R$ 4.000,00'],
            ['Pix do Gustavo', 'Transferência recebida', 'Nubank (Pessoal) → Conta PJ', '⇄ +R$ 500,00'],
        ]);
        expect(list.totalText).toBe('+R$ 4.500,00');
    });
});
