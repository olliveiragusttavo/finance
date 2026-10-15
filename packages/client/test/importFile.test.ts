import { describe, expect, it } from 'vitest';
import {
    applyTemplate,
    assignField,
    columnHint,
    columnLetter,
    columnSamples,
    completeMapping,
    detectDateFormat,
    detectDecimalSeparator,
    detectDelimiter,
    detectFileKind,
    detectReadSettings,
    findTemplate,
    interpretRows,
    mappingForKind,
    missingRequired,
    parseCsv,
    parseDateCell,
    parseNumberCell,
    readTable,
    suggestMapping,
    templateFrom,
    withoutColumn,
    withTemplate,
} from '../src/index.ts';

/** Começo de um export de despesas no formato do app de origem (import-design §1). */
const EXPENSES = [
    '﻿"Descrição","Valor","Encargos","Lançamento","Vencimento","Efetivação","Recorrência","Parcela","Parcelas","Categoria","Subcategoria","Cartão","Conta","Observações"',
    '"Mercado Oba","46.88","0.00","10/10/2026 10:04","15/11/2026","-","Nenhuma","0","0","Moradia","Mercado","Inter","Banco Inter",""',
    '"Milson  12/12","596.66","0.00","30/06/2026 11:53","16/06/2027","-","Parcelada (mensal)","12","12","Compras","Outros","NuBank","Banco Inter","scooter, elétrica"',
    '"Seguro","202.65","1.36","12/08/2025 23:09","20/12/2025","20/12/2025","Fixa mensal","0","0","Carro","Seguro","-","Banco Inter","Atraso\nPaga 12/08/2025"',
].join('\r\n');

describe('CSV (import-design §3)', () => {
    it('lê aspas, aspas dobradas, separador e quebra de linha dentro de aspas', () => {
        expect(parseCsv('a,"b,1","c ""x"""\n"d\ne",f,\n\n', ',')).toEqual([
            ['a', 'b,1', 'c "x"'],
            ['d\ne', 'f', ''],
        ]);
    });

    it('detecta o separador pela consistência das colunas, não pela contagem', () => {
        expect(detectDelimiter('a;b;c\n1,5;2,5;3\n4;5;6')).toBe(';');
        expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
        expect(detectDelimiter(EXPENSES)).toBe(',');
    });

    it('nomeia colunas como numa planilha', () => {
        expect([0, 25, 26, 27, 51, 52].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
    });
});

describe('números e datas', () => {
    it.each([
        ['46.88', 'dot', 46.88],
        ['1,234.50', 'dot', 1234.5],
        ['46,88', 'dot', null],
        ['R$ 1.234,50', 'comma', 1234.5],
        ['-15,60', 'comma', -15.6],
        ['(15,60)', 'comma', -15.6],
        ['15,60-', 'comma', -15.6],
        ['9000', 'comma', 9000],
        ['', 'comma', null],
        ['abc', 'dot', null],
    ] as const)('lê %s com decimal %s como %s', (text, decimal, expected) => {
        expect(parseNumberCell(text, decimal)).toBe(expected);
    });

    it.each([
        ['15/11/2026', 'dmy', { kind: 'date', date: '2026-11-15' }],
        ['12/08/2025 23:09', 'dmy', { kind: 'date', date: '2025-08-12' }],
        ['2026-11-15', 'ymd', { kind: 'date', date: '2026-11-15' }],
        ['11/15/26', 'mdy', { kind: 'date', date: '2026-11-15' }],
        ['-', 'dmy', { kind: 'empty' }],
        ['', 'dmy', { kind: 'empty' }],
        ['31/02/2026', 'dmy', { kind: 'invalid' }],
        ['amanhã', 'dmy', { kind: 'invalid' }],
    ] as const)('lê a data %s em %s', (text, format, expected) => {
        expect(parseDateCell(text, format)).toEqual(expected);
    });

    it('detecta decimal e ordem das datas pelas células', () => {
        expect(detectDecimalSeparator(['46.88', '0.00', '1.234'])).toBe('dot');
        expect(detectDecimalSeparator(['46,88', '1.234,50'])).toBe('comma');
        expect(detectDecimalSeparator(['10'])).toBe('comma');
        expect(detectDateFormat(['15/11/2026', '01/02/2026'])).toBe('dmy');
        expect(detectDateFormat(['2026-11-15'])).toBe('ymd');
        expect(detectDateFormat(['11/15/2026'])).toBe('mdy');
    });
});

describe('arquivo e tipo', () => {
    it('detecta como ler o export e completa a linha curta', () => {
        const settings = detectReadSettings(EXPENSES);
        expect(settings).toEqual({ delimiter: ',', decimal: 'dot', dateFormat: 'dmy', hasHeader: true });
        const table = readTable(`${EXPENSES}\n"curta","1.00"`, settings);
        expect(table.headers[0]).toBe('Descrição');
        expect(table.rows).toHaveLength(4);
        expect(table.rows[3]).toHaveLength(14);
        expect(columnSamples(table, 11)).toEqual(['Inter', 'NuBank', '-']);
        expect(columnSamples(table, 13)).toEqual(['(vazio)', 'scooter, elétrica', 'Atraso Paga 12/08/2025']);
    });

    it('sem cabeçalho, as colunas viram letras', () => {
        const table = readTable('1,2\n3,4', { delimiter: ',', decimal: 'dot', dateFormat: 'dmy', hasHeader: false });
        expect(table.headers).toEqual(['Coluna A', 'Coluna B']);
        expect(detectReadSettings('15/01/2026,10.00\n16/01/2026,20.00').hasHeader).toBe(false);
    });

    it.each([
        ['Despesas.csv', ['Descrição', 'Cartão'], 'expenses', ['nome do arquivo', 'coluna “Cartão”']],
        ['Receitas.csv', ['Descrição', 'Conta'], 'incomes', ['nome do arquivo']],
        ['export.csv', ['Descrição', '▲ Origem', '▼ Destino'], 'transfers', ['colunas de origem e destino']],
        ['Transferências.csv', ['Descrição'], 'transfers', ['nome do arquivo']],
        ['banco.csv', ['Data', 'Tipo', 'Valor'], 'mixed', ['coluna “Tipo”']],
        ['banco.csv', ['Data', 'Valor'], 'expenses', []],
    ] as const)('detecta em %s e %j o tipo %s', (fileName, headers, kind, reasons) => {
        expect(detectFileKind(fileName, headers)).toEqual({ kind, reasons });
    });
});

describe('ligação de colunas (import-design §4)', () => {
    const table = readTable(EXPENSES, detectReadSettings(EXPENSES));

    it('liga pelo cabeçalho, deixando "Efetivação" e "Lançamento" como dica', () => {
        const mapping = suggestMapping(table.headers, 'expenses');
        expect(mapping).toEqual({ name: 0, value: 1, charges: 2, dueDate: 4, repetition: 6, installment: 7, installments: 8, category: 9, subCategory: 10, creditCard: 11, account: 12, description: 13 });
        expect(columnHint('Efetivação', 'expenses', mapping)).toBe('Parece ser: Data de pagamento');
        expect(columnHint('Lançamento', 'expenses', mapping)).toBe('Parece ser: Data da compra');
        expect(columnHint('Lançamento', 'transfers', mapping)).toBeNull();
        expect(columnHint('Efetivação', 'expenses', { ...mapping, paymentDate: 3 })).toBeNull();
    });

    it('liga cada campo a uma coluna e cada coluna a um campo', () => {
        const moved = assignField({ name: 0, value: 1 }, 'name', 1);
        expect(moved).toEqual({ name: 1 });
        expect(withoutColumn({ name: 0, value: 1 }, 0)).toEqual({ value: 1 });
        expect(mappingForKind({ name: 0, creditCard: 1 }, 'incomes')).toEqual({ name: 0 });
        expect(completeMapping({ name: 2 }, { name: 0, value: 2, dueDate: 3 })).toEqual({ name: 2, dueDate: 3 });
        expect(missingRequired({ name: 0, value: 1, dueDate: 2 }, 'transfers').map((field) => field.id)).toEqual(['origin', 'destination']);
    });

    it('salva o mapeamento pelo cabeçalho e o reconhece em outra ordem', () => {
        const mapping = { ...suggestMapping(table.headers, 'expenses'), paymentDate: 5 };
        const template = templateFrom(' Meu app ', 'expenses', table.headers, mapping);
        expect(template.name).toBe('Meu app');
        const reordered = [...table.headers].reverse();
        expect(findTemplate([template], reordered)).toBe(template);
        expect(findTemplate([template], table.headers.slice(1))).toBeNull();
        expect(applyTemplate(template, reordered)).toMatchObject({ name: 13, paymentDate: 8 });
        const updated = templateFrom('Meu app', 'expenses', table.headers, { name: 0 });
        expect(withTemplate([template], updated)).toEqual([updated]);
    });
});

describe('interpretação das linhas', () => {
    const table = readTable(EXPENSES, detectReadSettings(EXPENSES));
    const mapping = { ...suggestMapping(table.headers, 'expenses'), paymentDate: 5, purchaseDate: 3 };

    it('lê a linha com datas, cartão, parcela e observação de várias linhas', () => {
        const { rows, problems } = interpretRows(table, mapping, { kind: 'expenses', decimal: 'dot', dateFormat: 'dmy' });
        expect(problems).toEqual([]);
        expect(rows[0]).toEqual({
            line: 1,
            type: 'expense',
            name: 'Mercado Oba',
            value: 46.88,
            charges: 0,
            dueDate: '2026-11-15',
            paymentDate: null,
            purchaseDate: '2026-10-10',
            account: 'Banco Inter',
            creditCard: 'Inter',
            destination: null,
            category: 'Moradia',
            subCategory: 'Mercado',
            description: null,
            tags: [],
            repetition: { kind: 'none' },
        });
        expect(rows[1]?.repetition).toEqual({ kind: 'installments', frequency: 'monthly', installment: 12, installments: 12 });
        expect(rows[2]).toMatchObject({ creditCard: null, charges: 1.36, paymentDate: '2025-12-20', description: 'Atraso\nPaga 12/08/2025', repetition: { kind: 'fixed', frequency: 'monthly' } });
    });

    it('aponta o problema de cada linha ilegível', () => {
        const broken = { headers: table.headers, rows: [
            ['', '1.00', '', '', '15/11/2026', '', '', '', '', 'A', 'B', '', 'Conta', ''],
            ['X', 'dez', '', '', '15/11/2026', '', '', '', '', 'A', 'B', '', 'Conta', ''],
            ['X', '1.00', '', '', '31/11/2026', '', '', '', '', 'A', 'B', '', 'Conta', ''],
            ['X', '1.00', '', '', '15/11/2026', '', '', '', '', 'A', 'B', '', '-', ''],
        ] };
        expect(interpretRows(broken, mapping, { kind: 'expenses', decimal: 'dot', dateFormat: 'dmy' }).problems).toEqual([
            { line: 1, field: 'name', reason: 'required-empty' },
            { line: 2, field: 'value', reason: 'invalid-number' },
            { line: 3, field: 'dueDate', reason: 'invalid-date' },
            { line: 4, field: 'account', reason: 'required-empty' },
        ]);
    });

    it('lê o tipo de cada linha num arquivo de vários tipos e a transferência pelo destino', () => {
        const mixed = { headers: ['Tipo', 'Nome', 'Valor', 'Data', 'Conta', 'Destino', 'Categoria', 'Sub', 'Tags'], rows: [
            ['Receita', 'Salário', '1000,00', '05/03/2026', 'Banco', '', 'Renda', 'Salário', 'casa; #extra'],
            ['Transferência', 'Aplicação', '200,00', '06/03/2026', 'Banco', 'Corretora', 'X', 'Y', ''],
            ['Transferência', 'Aplicação', '200,00', '06/03/2026', 'Banco', '', '', '', ''],
            ['Bônus', 'Outro', '1,00', '06/03/2026', 'Banco', '', '', '', ''],
        ] };
        const result = interpretRows(mixed, { type: 0, name: 1, value: 2, dueDate: 3, account: 4, destination: 5, category: 6, subCategory: 7, tags: 8 }, { kind: 'mixed', decimal: 'comma', dateFormat: 'dmy' });
        expect(result.rows.map((row) => [row.type, row.destination ?? null, row.category ?? null, row.tags])).toEqual([
            ['income', null, 'Renda', ['casa', 'extra']],
            ['transference', 'Corretora', null, []],
        ]);
        expect(result.problems).toEqual([
            { line: 3, field: 'destination', reason: 'required-empty' },
            { line: 4, field: 'type', reason: 'unknown-type' },
        ]);
    });
});
