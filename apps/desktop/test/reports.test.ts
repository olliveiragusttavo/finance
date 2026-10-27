import type { ReportDefinitionResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { fixedReportsFor, openReport, parseReportEditorSearch, parseReportsSearch } from '../src/renderer/src/reports/reportsSearch.ts';

const ID = '00000000-0000-4000-8000-000000000001';

/**
 * @param id Id do relatório.
 * @param name Nome do relatório.
 * @return Uma definição mínima, só com o que a página lê para escolher o aberto.
 */
function report(id: string, name: string): ReportDefinitionResponse {
    return {
        id,
        profileId: 'p',
        name,
        filter: {
            period: { anchor: { kind: 'reference' }, previousMonths: 0, basis: 'payment' },
            types: [],
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
    };
}

describe('relatório aberto na URL (reports-design, Fase 15, §8 e §9)', () => {
    it('aceita um UUID ou a chave de um fixo na página, e só o UUID no editor', () => {
        expect(parseReportsSearch({ report: ID, other: 'x' })).toEqual({ report: ID });
        expect(parseReportsSearch({ report: 'partners' })).toEqual({ report: 'partners' });
        expect(parseReportsSearch({ report: 'abc' })).toEqual({});
        expect(parseReportsSearch({})).toEqual({});
        expect(parseReportEditorSearch({ report: ID })).toEqual({ report: ID });
        expect(parseReportEditorSearch({ report: 'projection' })).toEqual({});
    });

    it('Regra de negócio (Perfis): a distribuição por sócio só fica fixada no perfil empresarial', () => {
        expect(fixedReportsFor('business')).toEqual(['projection', 'partners']);
        expect(fixedReportsFor('personal')).toEqual(['projection']);
    });

    it('abre o relatório da URL e, sem ele ou com um que não existe mais, o primeiro fixo', () => {
        const list = [report('00000000-0000-4000-8000-00000000000a', 'Aluguel'), report(ID, 'Viagens')];
        const business = fixedReportsFor('business');
        const personal = fixedReportsFor('personal');
        expect(openReport(list, business, { report: ID })).toMatchObject({ kind: 'saved', report: { name: 'Viagens' } });
        expect(openReport(list, business, { report: 'partners' })).toEqual({ kind: 'fixed', report: 'partners' });
        expect(openReport(list, business, {})).toEqual({ kind: 'fixed', report: 'projection' });
        expect(openReport(list, business, { report: '00000000-0000-4000-8000-0000000000ff' })).toEqual({ kind: 'fixed', report: 'projection' });
        // Trocar para um perfil pessoal com a distribuição aberta cai na projeção.
        expect(openReport([], personal, { report: 'partners' })).toEqual({ kind: 'fixed', report: 'projection' });
    });
});
