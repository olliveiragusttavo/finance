import { describe, expect, it } from 'vitest';
import { isItemActive, MENU, showsReferenceMonth, visibleChildren, type MenuItem } from '../src/renderer/src/shell/navigation.ts';
import { pickActiveProfile } from '../src/renderer/src/shell/pickActiveProfile.ts';
import { currentPeriod, parseShellSearch, resolveReferenceMonth, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { shortcutFor, type KeyPress } from '../src/renderer/src/shell/shortcuts.ts';

/**
 * @param label Rótulo do item no menu.
 * @return O item, para o teste não depender da posição dele na lista.
 * @throws {Error} Quando o menu não tem o item, o que já é a falha que o teste quer apontar.
 */
function menuItem(label: string): MenuItem {
    const item = MENU.find((candidate) => candidate.label === label);
    if (item === undefined) {
        throw new Error(`menu sem o item ${label}`);
    }
    return item;
}

describe('menu do shell (desktop-mvp-plan Fase 4)', () => {
    it('tem os itens do mockup, na ordem da barra lateral', () => {
        expect(MENU.map((item) => item.label)).toEqual(['Visão geral', 'Transações', 'Contas', 'Cartões', 'Relatórios', 'Metas', 'Cadastros', 'Dispositivos', 'Ajustes']);
    });

    it('Visão geral só fica marcada na raiz, e as seções em todo caminho delas', () => {
        expect(isItemActive(menuItem('Visão geral'), '/')).toBe(true);
        expect(isItemActive(menuItem('Visão geral'), '/accounts')).toBe(false);
        expect(isItemActive(menuItem('Contas'), '/accounts/123')).toBe(true);
        expect(isItemActive(menuItem('Contas'), '/accountsx')).toBe(false);
        expect(isItemActive(menuItem('Relatórios'), '/reports/tag')).toBe(true);
    });

    it('os relatórios só se abrem com a seção ativa, e "Por sócio" só no perfil empresarial', () => {
        const reports = menuItem('Relatórios');
        expect(visibleChildren(reports, '/accounts', 'business')).toEqual([]);
        expect(visibleChildren(reports, '/reports/category', 'personal').map((child) => child.label)).toEqual(['Por categoria', 'Fluxo por conta', 'Impacto do cartão', 'Por tag']);
        expect(visibleChildren(reports, '/reports/category', 'business').map((child) => child.label)).toEqual(['Por categoria', 'Fluxo por conta', 'Impacto do cartão', 'Por sócio', 'Por tag']);
    });

    it('esconde o mês de referência só em Cadastros, Dispositivos e Ajustes', () => {
        const hidden = MENU.filter((item) => !showsReferenceMonth(item.to)).map((item) => item.label);
        expect(hidden).toEqual(['Cadastros', 'Dispositivos', 'Ajustes']);
        expect(showsReferenceMonth('/reports/partner')).toBe(true);
    });
});

describe('mês de referência', () => {
    it('aceita só um mês válido na URL e descarta o resto', () => {
        expect(parseShellSearch({ period: '2026-10', other: 'x' })).toEqual({ period: '2026-10' });
        expect(parseShellSearch({ period: '2026-13' })).toEqual({});
        expect(parseShellSearch({ period: '1899-12' })).toEqual({});
        expect(parseShellSearch({ period: 202610 })).toEqual({});
        expect(parseShellSearch({})).toEqual({});
    });

    it('a URL vence o último mês do aparelho, que vence o mês corrente', () => {
        expect(resolveReferenceMonth({ period: '2026-08' }, '2026-09', '2026-10')).toBe('2026-08');
        expect(resolveReferenceMonth({}, '2026-09', '2026-10')).toBe('2026-09');
        expect(resolveReferenceMonth({}, null, '2026-10')).toBe('2026-10');
    });

    it('o mês corrente é o do calendário local', () => {
        expect(currentPeriod(new Date(2026, 9, 31, 23, 59))).toBe('2026-10');
        expect(currentPeriod(new Date(2027, 0, 1, 0, 0))).toBe('2027-01');
    });

    it('anda um mês para cada lado, com a virada de ano', () => {
        expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
        expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
    });
});

describe('atalhos globais', () => {
    const plain: KeyPress = { key: 'n', ctrlKey: false, altKey: false, metaKey: false, repeat: false, defaultPrevented: false, inEditableField: false, inOverlay: false };
    const withMonth = { referenceMonthVisible: true };

    it('N abre o lançamento, mesmo com Caps Lock; [ e ] trocam o mês', () => {
        expect(shortcutFor(plain, withMonth)).toBe('newTransaction');
        expect(shortcutFor({ ...plain, key: 'N' }, withMonth)).toBe('newTransaction');
        expect(shortcutFor({ ...plain, key: '[' }, withMonth)).toBe('previousMonth');
        expect(shortcutFor({ ...plain, key: ']' }, withMonth)).toBe('nextMonth');
        expect(shortcutFor({ ...plain, key: 'x' }, withMonth)).toBeNull();
    });

    it('não dispara ao digitar, com modificador, com tecla segurada nem dentro de menu ou diálogo', () => {
        expect(shortcutFor({ ...plain, inEditableField: true }, withMonth)).toBeNull();
        expect(shortcutFor({ ...plain, ctrlKey: true }, withMonth)).toBeNull();
        expect(shortcutFor({ ...plain, altKey: true }, withMonth)).toBeNull();
        expect(shortcutFor({ ...plain, metaKey: true }, withMonth)).toBeNull();
        expect(shortcutFor({ ...plain, repeat: true }, withMonth)).toBeNull();
        expect(shortcutFor({ ...plain, defaultPrevented: true }, withMonth)).toBeNull();
        expect(shortcutFor({ ...plain, inOverlay: true }, withMonth)).toBeNull();
    });

    it('sem a barra do mês, [ e ] não trocam um mês que não está na tela; N continua', () => {
        const withoutMonth = { referenceMonthVisible: false };
        expect(shortcutFor({ ...plain, key: '[' }, withoutMonth)).toBeNull();
        expect(shortcutFor({ ...plain, key: ']' }, withoutMonth)).toBeNull();
        expect(shortcutFor(plain, withoutMonth)).toBe('newTransaction');
    });
});

describe('perfil ativo', () => {
    const personal = { id: 'a', name: 'Gustavo', type: 'personal', currency: 'BRL' } as const;
    const business = { id: 'b', name: 'Estúdio GO', type: 'business', currency: 'BRL' } as const;

    it('reabre o último perfil do aparelho e cai no primeiro quando ele não existe mais', () => {
        expect(pickActiveProfile([personal, business], 'b')).toBe(business);
        expect(pickActiveProfile([personal, business], 'excluído')).toBe(personal);
        expect(pickActiveProfile([personal, business], null)).toBe(personal);
        expect(pickActiveProfile([], 'b')).toBeNull();
    });
});
