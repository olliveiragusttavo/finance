import type { MoneyResponse, PartnerReportResponse, PartnerResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { buildPartnerRosterView, draftFromPartners, parsePercentageInput, toSavePartnersInput, type PartnerDraftRow } from '../src/index.ts';

/**
 * @param amount Valor.
 * @return Dinheiro em BRL como vem do núcleo.
 */
function brl(amount: number): MoneyResponse {
    return { amount, currency: 'BRL' };
}

/** Os sócios gravados do mockup `DesktopSocios`: Gustavo (60%) e Ana (40%), ela com 3 lançamentos vinculados. */
const SAVED: readonly PartnerResponse[] = [
    { id: 'gustavo', profileId: 'estudio', name: 'Gustavo', percentage: 60, transactionCount: 5 },
    { id: 'ana', profileId: 'estudio', name: 'Ana', percentage: 40, transactionCount: 3 },
];

/** Gustavo aportou R$ 3.200,00 e Ana R$ 1.800,00: o total de aportes de R$ 5.000,00. */
const REPORT: PartnerReportResponse = {
    period: '2026-10',
    contributions: brl(5000),
    monthContributions: brl(0),
    monthContributionCount: 0,
    unassigned: brl(150),
    unassignedCount: 2,
    partners: [
        { partnerId: 'gustavo', name: 'Gustavo', share: 0.6, contributed: brl(3200), expected: brl(3000), difference: brl(200), count: 4 },
        { partnerId: 'ana', name: 'Ana', share: 0.4, contributed: brl(1800), expected: brl(2000), difference: brl(-200), count: 3 },
    ],
    sharesTotal: 1,
    settlements: [],
};

/**
 * @param draft Formulário.
 * @return A tela montada com os sócios e o relatório do mockup.
 */
function view(draft: readonly PartnerDraftRow[]): ReturnType<typeof buildPartnerRosterView> {
    return buildPartnerRosterView({ draft, saved: SAVED, report: REPORT });
}

describe('cadastro de sócios (mockup DesktopSocios)', () => {
    it('monta a tabela, a barra e a soma como no mockup, sem nada para salvar', () => {
        const roster = view(draftFromPartners(SAVED));

        expect(roster.rows.map(({ label, share, contributed, expected, color }) => ({ label, share, contributed, expected, color }))).toEqual([
            { label: 'Gustavo', share: '60%', contributed: 'R$ 3.200,00', expected: 'R$ 3.000,00', color: 0 },
            { label: 'Ana', share: '40%', contributed: 'R$ 1.800,00', expected: 'R$ 2.000,00', color: 1 },
        ]);
        expect(roster.segments.map((segment) => segment.width)).toEqual([60, 40]);
        expect(roster.sumLabel).toBe('Soma: 100%');
        expect(roster.barLabel).toBe('Gustavo 60%, Ana 40%');
        expect(roster.status).toEqual({ kind: 'ok', text: 'A soma dá 100%. Pode salvar.' });
        expect(roster.base).toBe('R$ 5.000,00');
        expect(roster.dirty).toBe(false);
        expect(roster.canSave).toBe(false);
    });

    it('lê a participação com vírgula ou ponto e até duas casas, de 0 a 100', () => {
        expect(parsePercentageInput('33,33')).toBe(3333);
        expect(parsePercentageInput('12.5')).toBe(1250);
        expect(parsePercentageInput(' 100 ')).toBe(10000);
        expect(parsePercentageInput('0')).toBe(0);
        expect(parsePercentageInput('100,01')).toBeNull();
        expect(parsePercentageInput('33,333')).toBeNull();
        expect(parsePercentageInput('')).toBeNull();
        expect(parsePercentageInput('-5')).toBeNull();
        expect(parsePercentageInput('1.000')).toBeNull();
    });

    it('Regra de negócio (Sócios): a soma ao vivo diz quanto falta ou quanto passou, e só 100% libera o salvar', () => {
        const [gustavo, ana] = draftFromPartners(SAVED);
        if (gustavo === undefined || ana === undefined) {
            throw new Error('cenário sem os dois sócios');
        }
        const short = view([gustavo, { ...ana, percentage: '30' }]);
        expect(short.status).toEqual({ kind: 'off', text: 'Faltam 10% para fechar 100%.' });
        expect(short.sumLabel).toBe('Soma: 90%');
        expect(short.canSave).toBe(false);

        const over = view([gustavo, { ...ana, percentage: '40,5' }]);
        expect(over.status).toEqual({ kind: 'off', text: 'A soma passou 0,5% de 100%. Reduza a participação de alguém.' });
        // Acima de 100% a barra encolhe na proporção, em vez de cortar o último sócio.
        expect(over.segments.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(100);

        const fixed = view([{ ...gustavo, percentage: '59,5' }, { ...ana, percentage: '40,5' }]);
        expect(fixed.status.kind).toBe('ok');
        expect(fixed.canSave).toBe(true);
    });

    it('"Deveria ter aportado" acompanha a participação digitada, pela divisão do relatório', () => {
        const [gustavo, ana] = draftFromPartners(SAVED);
        if (gustavo === undefined || ana === undefined) {
            throw new Error('cenário sem os dois sócios');
        }
        const roster = view([{ ...gustavo, percentage: '33,33' }, { ...ana, percentage: '33,33' }, { key: 'novo-1', id: null, name: 'Bruno', percentage: '33,34' }]);
        // R$ 5.000,00 em 33,34 + 33,33 + 33,33: a sobra do centavo vai para o maior resto e a soma fecha.
        expect(roster.rows.map((row) => [row.label, row.contributed, row.expected])).toEqual([
            ['Gustavo', 'R$ 3.200,00', 'R$ 1.666,50'],
            ['Ana', 'R$ 1.800,00', 'R$ 1.666,50'],
            ['Bruno', 'R$ 0,00', 'R$ 1.667,00'],
        ]);
    });

    it('Regra de negócio (Sócios): remover quem tem lançamentos avisa quantos ficam sem sócio e tira os aportes dele da base', () => {
        const [gustavo] = draftFromPartners(SAVED);
        if (gustavo === undefined) {
            throw new Error('cenário sem o Gustavo');
        }
        const roster = view([{ ...gustavo, percentage: '100' }]);
        expect(roster.removedWarning).toBe('Ao salvar, os 3 lançamentos vinculados a Ana ficam “sem sócio atribuído” e saem da divisão.');
        expect(roster.base).toBe('R$ 3.200,00');
        expect(roster.rows[0]?.expected).toBe('R$ 3.200,00');
        expect(roster.canSave).toBe(true);

        const single = buildPartnerRosterView({ draft: [], saved: [{ id: 'ana', profileId: 'estudio', name: 'Ana', percentage: 100, transactionCount: 1 }], report: REPORT });
        expect(single.removedWarning).toBe('Ao salvar, o lançamento vinculado a Ana fica “sem sócio atribuído” e sai da divisão.');
    });

    it('a cor de cada sócio não muda quando outro sai, e o novo continua a sequência', () => {
        const [, ana] = draftFromPartners(SAVED);
        if (ana === undefined) {
            throw new Error('cenário sem a Ana');
        }
        const roster = view([ana, { key: 'novo-1', id: null, name: 'Bruno', percentage: '0' }]);
        expect(roster.rows.map((row) => [row.label, row.color])).toEqual([
            ['Ana', 1],
            ['Bruno', 2],
        ]);
        expect(roster.nextColor).toBe(3);
    });

    it('remover todos é permitido: a lista vazia salva e explica o que acontece', () => {
        const roster = view([]);
        expect(roster.status.kind).toBe('empty');
        expect(roster.removedWarning).toBe('Ao salvar, os 8 lançamentos vinculados a Gustavo e Ana ficam “sem sócio atribuído” e saem da divisão.');
        expect(roster.canSave).toBe(true);
    });

    it('sócio novo sem nome ou com participação inválida trava o salvar e aponta o campo', () => {
        const [gustavo, ana] = draftFromPartners(SAVED);
        if (gustavo === undefined || ana === undefined) {
            throw new Error('cenário sem os dois sócios');
        }
        const roster = view([gustavo, { ...ana, percentage: '30' }, { key: 'novo-1', id: null, name: '  ', percentage: '10,005' }]);
        expect(roster.rows[2]).toMatchObject({ label: 'Sem nome', share: '0%', nameError: 'Informe o nome do sócio.', percentageError: 'Use um número de 0 a 100, com até duas casas decimais.' });
        expect(roster.canSave).toBe(false);
    });

    it('espaços nas pontas do nome não contam como mudança, e "Aportou" espera o relatório', () => {
        const [gustavo, ana] = draftFromPartners(SAVED);
        if (gustavo === undefined || ana === undefined) {
            throw new Error('cenário sem os dois sócios');
        }
        expect(view([{ ...gustavo, name: ' Gustavo ' }, { ...ana, percentage: '40,00' }]).dirty).toBe(false);

        const loading = buildPartnerRosterView({ draft: [gustavo, ana], saved: SAVED, report: undefined });
        expect(loading.rows.map((row) => [row.contributed, row.expected])).toEqual([
            ['—', '—'],
            ['—', '—'],
        ]);
        expect(loading.base).toBe('—');
    });

    it('a gravação leva a lista inteira, com os nomes aparados e a participação de 0 a 100', () => {
        const draft: readonly PartnerDraftRow[] = [
            { key: 'gustavo', id: 'gustavo', name: ' Gustavo ', percentage: '66,67' },
            { key: 'novo-1', id: null, name: 'Bruno', percentage: '33,33' },
        ];
        expect(toSavePartnersInput(draft, 'estudio')).toEqual({
            profileId: 'estudio',
            partners: [
                { id: 'gustavo', name: 'Gustavo', percentage: 66.67 },
                { id: null, name: 'Bruno', percentage: 33.33 },
            ],
        });
    });

    it('a participação gravada com casas decimais volta ao campo no formato pt-BR', () => {
        const draft = draftFromPartners([{ id: 'a', profileId: 'p', name: 'A', percentage: 33.33, transactionCount: 0 }, { id: 'b', profileId: 'p', name: 'B', percentage: 12.5, transactionCount: 0 }]);
        expect(draft.map((row) => row.percentage)).toEqual(['33,33', '12,5']);
    });
});
