import type { ReportDefinitionResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import {
    describeReportFilters,
    describeReportPeriod,
    draftFromDefinition,
    emptyReportDraft,
    readReportDraft,
    describeReportAnalysis,
    reportDimensionsFor,
    toCreateReportInput,
    type ReportDraft,
    type ReportLookups,
} from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

/**
 * @param overrides Campos que o teste quer fixar.
 * @return O rascunho de um relatório novo em outubro de 2026, com nome.
 */
function draft(overrides: Partial<ReportDraft> = {}): ReportDraft {
    return { ...emptyReportDraft('2026-10'), name: 'Gastos', ...overrides };
}

/** Cadastros com uma categoria, uma conta, um cartão e uma tag; o resto vazio. */
const LOOKUPS: ReportLookups = {
    categories: [{ id: 'cat', profileId: 'p', name: 'Alimentação', subCategories: [{ id: 'sub', categoryId: 'cat', name: 'Mercado', transactionCount: 0 }] }],
    accounts: [{ id: 'acc', name: 'Nubank' }],
    creditCards: [{ id: 'card', name: 'Roxinho' }],
    tags: [{ id: 'trip', name: 'viagem' }],
    partners: [],
    goals: [],
};

describe('editor de relatórios (reports-design §2 e §3)', () => {
    it('o relatório novo abre nas despesas do mês de referência, em tabela por categoria', () => {
        const reading = readReportDraft(draft(), 'BRL');
        expect(reading.errors).toEqual({});
        expect(reading.query).toEqual({
            filter: {
                period: { anchor: { kind: 'reference' }, previousMonths: 0, basis: 'payment' },
                types: ['expense'],
                categoryIds: [],
                subCategoryIds: [],
                accountIds: [],
                creditCardIds: [],
                tagIds: [],
                tagMatch: 'any',
                partnerIds: [],
                goalIds: [],
                status: 'all',
                minValue: null,
                maxValue: null,
            },
            layout: { format: 'table', primary: 'category', secondary: null, measure: 'sum', analysis: false },
        });
    });

    it('o resultado ao vivo não espera o nome: o filtro vale sem ele', () => {
        const reading = readReportDraft(draft({ name: '  ' }), 'BRL');
        expect(reading.name).toBeNull();
        expect(reading.errors.name).toBe('Dê um nome ao relatório.');
        expect(reading.query).not.toBeNull();
        expect(readReportDraft(draft({ name: 'x'.repeat(101) }), 'BRL').errors.name).toBe('O nome tem até 100 caracteres.');
    });

    it('Regra de negócio (Relatórios, F1 e F2): mês fixo obrigatório quando escolhido, e de 0 a 35 meses anteriores', () => {
        expect(readReportDraft(draft({ anchor: 'fixed', fixedMonth: '' }), 'BRL').errors.fixedMonth).toBe('Escolha o mês final.');
        expect(readReportDraft(draft({ anchor: 'fixed', fixedMonth: '2025-12', previousMonths: '11' }), 'BRL').query?.filter.period).toEqual({ anchor: { kind: 'fixed', month: '2025-12' }, previousMonths: 11, basis: 'payment' });
        for (const invalid of ['36', '-1', '1,5', '']) {
            expect(readReportDraft(draft({ previousMonths: invalid }), 'BRL').errors.previousMonths).toBe('Use um número de 0 a 35.');
        }
        expect(readReportDraft(draft({ previousMonths: '35' }), 'BRL').query?.filter.period.previousMonths).toBe(35);
    });

    it('lê os valores-limite em pt-BR e recusa o mínimo acima do máximo', () => {
        expect(readReportDraft(draft({ minValue: '-50', maxValue: '1.200,50' }), 'BRL').query?.filter).toMatchObject({ minValue: -50, maxValue: 1200.5 });
        expect(readReportDraft(draft({ minValue: 'abc' }), 'BRL').errors.minValue).toBe('Valor inválido.');
        const inverted = readReportDraft(draft({ minValue: '100', maxValue: '10' }), 'BRL');
        expect(inverted.errors.maxValue).toBe('O máximo precisa ser maior ou igual ao mínimo.');
        expect(inverted.query).toBeNull();
    });

    it('Regra de negócio (Relatórios, L5): a segunda divisão não repete a primeira', () => {
        const reading = readReportDraft(draft({ primary: 'month', secondary: 'month' }), 'BRL');
        expect(reading.errors.secondary).toBe('Escolha uma divisão diferente da primeira.');
        const pie = readReportDraft(draft({ format: 'pie', primary: 'month', secondary: 'month' }), 'BRL');
        expect(pie.errors.secondary).toBeUndefined();
        expect(pie.query?.layout).toMatchObject({ format: 'pie', secondary: null });
        expect(reading.query).toBeNull();
    });

    it('Regra de negócio (Perfis): agrupar por sócio só no perfil empresarial', () => {
        expect(reportDimensionsFor('personal')).not.toContain('partner');
        expect(reportDimensionsFor('business')).toContain('partner');
        expect(reportDimensionsFor('personal')).toContain('recurrence');
        expect(describeReportAnalysis({ format: 'table', primary: 'month', secondary: 'flow', measure: 'sum' })).toEqual([
            'O resultado: o total das entradas menos o das saídas.',
            'A variação de cada valor em relação ao mês anterior, quando há mais de um mês.',
        ]);
        expect(describeReportAnalysis({ format: 'pie', primary: 'flow', secondary: 'month', measure: 'count' })).toEqual([]);
    });

    it('reabre a definição salva no editor e a regrava igual', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const reading = readReportDraft(draft({ anchor: 'fixed', fixedMonth: '2026-08', previousMonths: '2', basis: 'due', tagIds: [s.tagId], minValue: '10,5', format: 'bar', primary: 'month', secondary: 'tag', measure: 'count' }), 'BRL');
        if (reading.query === null || reading.name === null) {
            throw new Error('rascunho inválido');
        }
        const saved: ReportDefinitionResponse = await world.ok('reports.create', toCreateReportInput(s.profileId, reading.name, reading.query));
        const reopened = draftFromDefinition(saved, '2026-10', 'BRL');
        expect(reopened).toMatchObject({ anchor: 'fixed', fixedMonth: '2026-08', previousMonths: '2', basis: 'due', minValue: '10,50', secondary: 'tag', measure: 'count' });
        expect(readReportDraft(reopened, 'BRL').query).toEqual(reading.query);
    });

    it('o mês fixo sugerido de uma definição que acompanha a barra é o mês de referência', () => {
        const definition: ReportDefinitionResponse = {
            id: 'r',
            profileId: 'p',
            name: 'Mensal',
            filter: { ...readReportDraft(draft(), 'BRL').query?.filter ?? fail(), period: { anchor: { kind: 'reference' }, previousMonths: 0, basis: 'payment' } },
            layout: { format: 'table', primary: 'category', secondary: null, measure: 'sum', analysis: false },
        };
        expect(draftFromDefinition(definition, '2027-01', 'BRL')).toMatchObject({ anchor: 'reference', fixedMonth: '2027-01', secondary: 'none' });
    });
});

describe('descrição do relatório', () => {
    it('diz os meses e a base de data', () => {
        const filter = readReportDraft(draft({ basis: 'due' }), 'BRL').query?.filter ?? fail();
        expect(describeReportPeriod(filter, '2026-10', '2026-10')).toBe('out/2026 · pela data de vencimento');
        expect(describeReportPeriod(filter, '2025-11', '2026-10')).toBe('nov/2025 a out/2026 · pela data de vencimento');
    });

    it('descreve cada filtro ativo e marca o cadastro excluído depois de salvo', () => {
        const filter = readReportDraft(draft({ types: ['expense', 'income'], subCategoryIds: ['sub'], creditCardIds: ['card'], tagIds: ['trip', 'gone'], tagMatch: 'all', status: 'paid', maxValue: '200' }), 'BRL').query?.filter ?? fail();
        expect(describeReportFilters(filter, LOOKUPS, 'BRL')).toEqual([
            'Tipo: Despesa, Receita',
            'Categoria: Alimentação › Mercado',
            'Conta ou cartão: Roxinho',
            'Tag (todas): viagem, (excluída)',
            'Só pagos',
            'Valor até R$ 200,00',
        ]);
        expect(describeReportFilters({ ...filter, types: [], subCategoryIds: [], creditCardIds: [], tagIds: [], status: 'all', maxValue: null }, LOOKUPS, 'BRL')).toEqual([]);
    });
});

/**
 * @return Nunca: falha o teste quando o rascunho do cenário não é válido.
 * @throws {Error} Sempre.
 */
function fail(): never {
    throw new Error('rascunho inválido no cenário do teste');
}
