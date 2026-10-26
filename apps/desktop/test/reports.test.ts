import type { ReportDefinitionResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { openReport, parseReportsSearch } from '../src/renderer/src/reports/reportsSearch.ts';

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
        layout: { format: 'table', primary: 'category', secondary: null, measure: 'sum' },
    };
}

describe('relatório aberto na URL (reports-design, Fase 15)', () => {
    it('aceita só um UUID e descarta o resto', () => {
        expect(parseReportsSearch({ report: ID, other: 'x' })).toEqual({ report: ID });
        expect(parseReportsSearch({ report: 'abc' })).toEqual({});
        expect(parseReportsSearch({})).toEqual({});
    });

    it('abre o relatório da URL e, sem ele ou com um que não existe mais, o primeiro da lista', () => {
        const list = [report('00000000-0000-4000-8000-00000000000a', 'Aluguel'), report(ID, 'Viagens')];
        expect(openReport(list, { report: ID })?.name).toBe('Viagens');
        expect(openReport(list, {})?.name).toBe('Aluguel');
        expect(openReport(list, { report: '00000000-0000-4000-8000-0000000000ff' })?.name).toBe('Aluguel');
        expect(openReport([], {})).toBeNull();
    });
});
