import type { PartnerResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { buildPartnerRosterView, draftFromPartners, parsePercentageInput, toSavePartnersInput, type PartnerDraftRow } from '../src/index.ts';

/** Os sócios gravados do mockup `DesktopSocios`: Gustavo (60%) e Ana (40%), ela com 3 lançamentos vinculados. */
const SAVED: readonly PartnerResponse[] = [
    { id: 'gustavo', profileId: 'estudio', name: 'Gustavo', percentage: 60, transactionCount: 5 },
    { id: 'ana', profileId: 'estudio', name: 'Ana', percentage: 40, transactionCount: 3 },
];

/**
 * @param draft Formulário.
 * @return A tela montada com os sócios do mockup.
 */
function view(draft: readonly PartnerDraftRow[]): ReturnType<typeof buildPartnerRosterView> {
    return buildPartnerRosterView({ draft, saved: SAVED });
}

describe('cadastro de sócios (mockup DesktopSocios)', () => {
    it('monta a tabela, a barra e a soma como no mockup, sem nada para salvar', () => {
        const roster = view(draftFromPartners(SAVED));

        expect(roster.rows.map(({ label, share, color }) => ({ label, share, color }))).toEqual([
            { label: 'Gustavo', share: '60%', color: 0 },
            { label: 'Ana', share: '40%', color: 1 },
        ]);
        expect(roster.segments.map((segment) => segment.width)).toEqual([60, 40]);
        expect(roster.sumLabel).toBe('Soma: 100%');
        expect(roster.barLabel).toBe('Gustavo 60%, Ana 40%');
        expect(roster.status).toEqual({ kind: 'ok', text: 'A soma dá 100%. Pode salvar.' });
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

    it('Regra de negócio (Sócios): remover quem tem lançamentos avisa quantos ficam sem sócio', () => {
        const [gustavo] = draftFromPartners(SAVED);
        if (gustavo === undefined) {
            throw new Error('cenário sem o Gustavo');
        }
        const roster = view([{ ...gustavo, percentage: '100' }]);
        expect(roster.removedWarning).toBe('Ao salvar, os 3 lançamentos vinculados a Ana ficam “sem sócio atribuído”.');
        expect(roster.canSave).toBe(true);

        const single = buildPartnerRosterView({ draft: [], saved: [{ id: 'ana', profileId: 'estudio', name: 'Ana', percentage: 100, transactionCount: 1 }] });
        expect(single.removedWarning).toBe('Ao salvar, o lançamento vinculado a Ana fica “sem sócio atribuído”.');
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
        expect(roster.removedWarning).toBe('Ao salvar, os 8 lançamentos vinculados a Gustavo e Ana ficam “sem sócio atribuído”.');
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

    it('espaços nas pontas do nome não contam como mudança', () => {
        const [gustavo, ana] = draftFromPartners(SAVED);
        if (gustavo === undefined || ana === undefined) {
            throw new Error('cenário sem os dois sócios');
        }
        expect(view([{ ...gustavo, name: ' Gustavo ' }, { ...ana, percentage: '40,00' }]).dirty).toBe(false);
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
