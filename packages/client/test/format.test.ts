import { describe, expect, it } from 'vitest';
import {
    formatAccountType,
    formatDate,
    formatDayMonth,
    formatMoney,
    formatMoneyForInput,
    formatMonthAbbreviation,
    formatMonthLong,
    formatMonthShort,
    formatPercent,
    formatProfileSummary,
    summarizeNote,
    formatProfileType,
    formatVariation,
    parseMoneyInput,
} from '../src/index.ts';

/**
 * @param amount Valor.
 * @param currency Código ISO.
 * @return O dinheiro como vem do núcleo.
 */
function brl(amount: number, currency = 'BRL'): { readonly amount: number; readonly currency: string } {
    return { amount, currency };
}

/*
 * Testes de ouro: as strings esperadas são as dos mockups aprovados, com o `−` tipográfico
 * (U+2212) e espaço comum. Mudar uma delas é mudar o que o usuário lê — precisa aparecer no diff.
 */
describe('formatMoney', () => {
    it.each([
        [1234.56, 'negative', 'R$ 1.234,56'],
        [-1234.56, 'negative', '−R$ 1.234,56'],
        [9500, 'always', '+R$ 9.500,00'],
        [-487.32, 'always', '−R$ 487,32'],
        [0, 'always', 'R$ 0,00'],
        [-2449.75, 'absolute', 'R$ 2.449,75'],
        [1234567.8, 'negative', 'R$ 1.234.567,80'],
        [0.5, 'negative', 'R$ 0,50'],
        [999.999, 'negative', 'R$ 1.000,00'],
    ] as const)('%d com sinal %s → %s', (amount, sign, expected) => {
        expect(formatMoney(brl(amount), sign)).toBe(expected);
    });

    it('arredonda meio para longe do zero, como o Money (1,005 → 1,01; −2,345 → −2,35)', () => {
        expect(formatMoney(brl(1.005))).toBe('R$ 1,01');
        expect(formatMoney(brl(-2.345))).toBe('−R$ 2,35');
    });

    it('não mostra "−R$ 0,00" quando o valor arredonda para zero', () => {
        expect(formatMoney(brl(-0.004), 'always')).toBe('R$ 0,00');
    });

    it('respeita as casas da moeda e usa o código quando não há símbolo', () => {
        expect(formatMoney(brl(1234.5, 'JPY'))).toBe('JPY 1.235');
        expect(formatMoney(brl(10, 'USD'))).toBe('US$ 10,00');
        expect(formatMoney(brl(10.1234, 'KWD'))).toBe('KWD 10,123');
    });

    it('formata para campo de edição sem símbolo, com hífen comum', () => {
        expect(formatMoneyForInput(brl(400))).toBe('400,00');
        expect(formatMoneyForInput(brl(-23.9))).toBe('-23,90');
        expect(formatMoneyForInput(brl(4800))).toBe('4.800,00');
    });
});

describe('datas e meses', () => {
    it('formata dia/mês, data completa e meses nos três tamanhos dos mockups', () => {
        expect(formatDayMonth('2026-10-01')).toBe('01/10');
        expect(formatDate('2026-10-08')).toBe('08/10/2026');
        expect(formatMonthShort('2026-10')).toBe('out/2026');
        expect(formatMonthShort('2026-03')).toBe('mar/2026');
        expect(formatMonthAbbreviation('2026-07')).toBe('jul');
        expect(formatMonthLong('2026-10')).toBe('Outubro de 2026');
        expect(formatMonthLong('2026-03')).toBe('Março de 2026');
    });

    it('recusa data inexistente em vez de rolar para o mês seguinte como o Date faria', () => {
        expect(() => formatDayMonth('2026-02-30')).toThrow();
    });
});

describe('percentual e variação', () => {
    it.each([
        [0.166, 'always', 1, '+16,6%'],
        [-0.201, 'always', 1, '−20,1%'],
        [0.322, 'negative', 1, '32,2%'],
        [0, 'always', 1, '0%'],
        [0.0004, 'always', 1, '0%'],
        [-0.12, 'always', 0, '−12%'],
    ] as const)('%d (%s, %d casa) → %s', (ratio, sign, decimals, expected) => {
        expect(formatPercent(ratio, { sign, decimals })).toBe(expected);
    });

    it('mostra seta, valor com sinal e percentual, como a tabela do relatório', () => {
        expect(formatVariation({ absolute: brl(162.4), change: { kind: 'ratio', ratio: 0.16569 } }))
            .toEqual({ direction: 'up', arrow: '▲', absolute: '+R$ 162,40', percent: '+16,6%' });
        expect(formatVariation({ absolute: brl(-122.68), change: { kind: 'ratio', ratio: -0.2011 } }))
            .toEqual({ direction: 'down', arrow: '▼', absolute: '−R$ 122,68', percent: '−20,1%' });
        expect(formatVariation({ absolute: brl(0), change: { kind: 'ratio', ratio: 0 } }))
            .toEqual({ direction: 'flat', arrow: '=', absolute: 'R$ 0,00', percent: '0%' });
    });

    it('Regra de negócio (Relatórios, R6): base zero aparece como "novo", não ∞ nem 0%', () => {
        expect(formatVariation({ absolute: brl(80), change: { kind: 'new' } }).percent).toBe('novo');
    });
});

describe('parseMoneyInput', () => {
    it.each([
        ['1.234,56', 1234.56],
        ['1234,56', 1234.56],
        ['400', 400],
        ['0,5', 0.5],
        [',50', 0.5],
        ['-23,90', -23.9],
        ['−23,90', -23.9],
        ['+10', 10],
        ['R$ 1.234,56', 1234.56],
        ['-R$ 10,00', -10],
        ['R$ -10,00', -10],
        [' 1 234,56 ', 1234.56],
        ['1.000.000', 1000000],
        ['2,345', 2.35],
        ['-2,345', -2.35],
        ['1,005', 1.01],
    ] as const)('"%s" → %d', (text, amount) => {
        expect(parseMoneyInput(text, 'BRL')).toEqual({ ok: true, amount });
    });

    it.each(['1.5', '1.23,00', '12,34,56', 'abc', '--1', '-R$ -1', ',', '1e3'])('recusa "%s"', (text) => {
        expect(parseMoneyInput(text, 'BRL')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('distingue campo vazio, que o formulário trata como obrigatório', () => {
        expect(parseMoneyInput('  ', 'BRL')).toEqual({ ok: false, reason: 'empty' });
    });

    it('arredonda na precisão da moeda do perfil', () => {
        expect(parseMoneyInput('1.234,5', 'JPY')).toEqual({ ok: true, amount: 1235 });
    });

    it('aceita até 1 trilhão, nos dois sentidos (Regra de negócio: Dinheiro)', () => {
        expect(parseMoneyInput('1.000.000.000.000,00', 'BRL')).toEqual({ ok: true, amount: 1_000_000_000_000 });
        expect(parseMoneyInput('-1000000000000', 'BRL')).toEqual({ ok: true, amount: -1_000_000_000_000 });
    });

    it.each(['1.000.000.000.000,01', '-1000000000000,01', '9'.repeat(400)])('recusa "%s" por passar do teto, sem lançar erro', (text) => {
        expect(parseMoneyInput(text, 'BRL')).toEqual({ ok: false, reason: 'tooLarge' });
    });

    it('lê de volta o que formatMoneyForInput escreveu', () => {
        for (const amount of [0, 0.01, -23.9, 1234.56, 1000000]) {
            expect(parseMoneyInput(formatMoneyForInput(brl(amount)), 'BRL')).toEqual({ ok: true, amount });
        }
    });
});

describe('perfil', () => {
    it('escreve o tipo como o seletor de perfil do mockup', () => {
        expect(formatProfileType('personal')).toBe('Pessoal');
        expect(formatProfileType('business')).toBe('Empresarial');
        expect(formatProfileSummary({ type: 'business', currency: 'BRL' })).toBe('Empresarial · BRL');
    });
});

describe('conta', () => {
    it('escreve o tipo como o primeiro uso e Cadastros do mockup', () => {
        expect(formatAccountType('checking')).toBe('Corrente');
        expect(formatAccountType('investment')).toBe('Investimentos');
    });
});

describe('anotação na lista (mockups, decisão de interface 9)', () => {
    it('a primeira linha é o título e o resto vira a prévia numa linha só', () => {
        expect(summarizeNote('IPTU 2027\nCota única vence em fevereiro.\n\nValor: R$ 1.200,00')).toEqual({
            title: 'IPTU 2027',
            preview: 'Cota única vence em fevereiro. Valor: R$ 1.200,00',
        });
    });

    it('anotação de uma linha não tem prévia, e linhas em branco no começo não viram título', () => {
        expect(summarizeNote('Reembolsos pendentes')).toEqual({ title: 'Reembolsos pendentes', preview: '' });
        expect(summarizeNote('\r\n  \r\nLembrete\r\n')).toEqual({ title: 'Lembrete', preview: '' });
    });
});
