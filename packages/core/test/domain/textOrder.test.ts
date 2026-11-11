import { describe, expect, it } from 'vitest';
import { compareCodeUnits, compareNames, nameSortKey } from '../../src/domain/shared/textOrder.ts';
import { buildPendingSummary, type PendingItem } from '../../src/domain/overview/PendingItems.ts';
import { Currency } from '../../src/domain/shared/Currency.ts';
import { TransactionId } from '../../src/domain/shared/ids.ts';
import { LocalDate } from '../../src/domain/shared/LocalDate.ts';
import { Money } from '../../src/domain/shared/Money.ts';

/**
 * Ordena uma cópia, para os casos lerem como "esta lista sai nesta ordem".
 *
 * @param names Nomes em qualquer ordem.
 * @return Os nomes pelo `compareNames`.
 */
function sorted(names: readonly string[]): readonly string[] {
    return [...names].sort(compareNames);
}

describe('compareNames', () => {
    it('ignora o acento: "Água" vem antes de "Bebida", como no localeCompare pt-BR que substitui', () => {
        expect(sorted(['Bebida', 'Água', 'Mercado', 'Ótica', 'Ônibus'])).toEqual(['Água', 'Bebida', 'Mercado', 'Ônibus', 'Ótica']);
    });

    it('ignora a caixa: minúsculas e maiúsculas se misturam pela letra, e não pelo código ASCII', () => {
        expect(sorted(['zebra', 'Banana', 'abacate', 'Cenoura'])).toEqual(['abacate', 'Banana', 'Cenoura', 'zebra']);
    });

    it('trata o acento decomposto (e + U+0301) como o composto, sem depender de normalize', () => {
        expect(nameSortKey('café')).toBe(nameSortKey('café'));
        expect(sorted(['Cafeteria', 'café', 'Cabana'])).toEqual(['Cabana', 'café', 'Cafeteria']);
    });

    it('desempata nomes que só diferem no acento ou na caixa pelo texto original, para a ordem ser total', () => {
        expect(compareNames('Saúde', 'SAÚDE')).not.toBe(0);
        expect(sorted(['Saúde', 'SAÚDE', 'saude'])).toEqual(sorted(['saude', 'SAÚDE', 'Saúde']));
        expect(compareNames('Mercado', 'Mercado')).toBe(0);
    });

    it('dobra as letras fora do português pela tabela própria', () => {
        expect(nameSortKey('Ångström')).toBe('angstrom');
        expect(nameSortKey('Straße')).toBe('strasse');
        expect(nameSortKey('Œuvre')).toBe('oeuvre');
        expect(nameSortKey('  Çedilha  ')).toBe('cedilha');
    });

    it('mantém pelo código do caractere o que está fora da tabela', () => {
        expect(nameSortKey('Ελλάδα')).toBe('Ελλάδα');
        expect(sorted(['☕ Café', 'Zebra', 'Ελλάδα'])).toEqual(['Zebra', 'Ελλάδα', '☕ Café']);
    });
});

describe('compareCodeUnits', () => {
    it('é uma ordem total pelo código, sem localidade', () => {
        expect([...['b', 'B', 'a', 'á'].sort(compareCodeUnits)]).toEqual(['B', 'a', 'b', 'á']);
        expect(compareCodeUnits('x', 'x')).toBe(0);
    });
});

describe('ordem das pendências da Visão geral', () => {
    const brl = Currency.of('BRL');

    /**
     * @param id Sufixo do id, que desempata nomes iguais.
     * @param name Nome do lançamento.
     * @return Um lançamento em aberto que vence hoje.
     */
    function item(id: string, name: string): PendingItem {
        return {
            kind: 'transaction',
            id: TransactionId(`00000000-0000-4000-8000-${id.padStart(12, '0')}`),
            name,
            dueDate: LocalDate.parse('2026-10-10'),
            direction: 'out',
            amount: Money.of(10, brl),
            where: 'Conta',
            canMarkPaid: true,
        };
    }

    it('no mesmo dia, ordena pelo nome sem acento e desempata pelo id', () => {
        const summary = buildPendingSummary(LocalDate.parse('2026-10-10'), [item('3', 'Luz'), item('2', 'Água'), item('1', 'Luz'), item('4', 'Bebida')], brl);

        expect(summary.upcoming.map((pending) => `${pending.name}#${pending.id.slice(-1)}`)).toEqual(['Água#2', 'Bebida#4', 'Luz#1', 'Luz#3']);
    });
});
