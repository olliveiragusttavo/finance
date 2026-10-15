import { describe, expect, it } from 'vitest';
import { analyzeImport, LocalDate, YearMonth, type ImportOptions, type ImportRow } from '../../src/index.ts';
import { BillingCycle } from '../../src/domain/creditCard/BillingCycle.ts';

/** "Hoje" dos testes: o horizonte das fixas vai até 15/10/2027. */
const TODAY = LocalDate.parse('2026-10-15');

const OPTIONS: ImportOptions = { groupSeries: true, keepFutureOccurrences: true, hashtagsAsTags: true, pastDueAsPaid: false };

/**
 * Linha de despesa numa conta, com o mínimo que a análise exige; cada teste muda só o que importa
 * para a regra dele.
 *
 * @param line Número da linha no arquivo.
 * @param overrides Campos a trocar.
 * @return A linha.
 */
function row(line: number, overrides: Partial<ImportRow> = {}): ImportRow {
    return {
        line,
        type: 'expense',
        name: 'Mercado',
        value: 100,
        charges: 0,
        dueDate: LocalDate.parse('2026-03-10'),
        paymentDate: null,
        purchaseDate: null,
        account: 'Banco',
        creditCard: null,
        destination: null,
        category: 'Moradia',
        subCategory: 'Mercado',
        description: null,
        tags: [],
        repetition: { kind: 'none' },
        ...overrides,
    };
}

/**
 * @param line Número da linha.
 * @param dueDate Vencimento da ocorrência.
 * @param overrides Campos a trocar.
 * @return Uma linha de série fixa mensal.
 */
function fixed(line: number, dueDate: string, overrides: Partial<ImportRow> = {}): ImportRow {
    return row(line, { name: 'Aluguel', dueDate: LocalDate.parse(dueDate), repetition: { kind: 'fixed', frequency: 'monthly' }, ...overrides });
}

/**
 * @param line Número da linha.
 * @param installment Número da parcela.
 * @param overrides Campos a trocar.
 * @return Uma parcela de "Mouse" em 3x no cartão, comprada em 20/01/2026.
 */
function installment(line: number, installment: number, overrides: Partial<ImportRow> = {}): ImportRow {
    return row(line, {
        name: `Mouse  ${String(installment)}/3`,
        creditCard: 'Nubank',
        purchaseDate: LocalDate.parse('2026-01-20'),
        dueDate: LocalDate.of(2026, 2 + installment, 15),
        repetition: { kind: 'installments', frequency: 'monthly', installment, installments: 3 },
        ...overrides,
    });
}

describe('BillingCycle.invoicePeriodDueIn — fatura pelo mês do vencimento (import-design §5.4)', () => {
    it.each([
        // Fecha no 8 e vence no 15: a fatura vence no próprio mês.
        [8, 15, '2026-11', '2026-11'],
        // Fecha no 25 e vence no 5: a fatura de outubro vence em novembro.
        [25, 5, '2026-11', '2026-10'],
        [31, 10, '2026-03', '2026-02'],
    ])('fechamento %i e vencimento %i: o vencimento em %s é da fatura %s', (closing, due, duePeriod, invoice) => {
        expect(BillingCycle.of(closing, due).invoicePeriodDueIn(YearMonth.parse(duePeriod)).toString()).toBe(invoice);
    });

    it('é o inverso do vencimento da fatura em todo mês de um ano', () => {
        const cycle = BillingCycle.of(7, 15);
        for (let month = 1; month <= 12; month++) {
            const invoice = YearMonth.of(2026, month);
            expect(cycle.invoicePeriodDueIn(cycle.dueDateOf(invoice).period).equals(invoice)).toBe(true);
        }
    });
});

describe('analyzeImport — linhas recusadas', () => {
    it.each([
        [row(1, { category: null }), 'category-missing'],
        [row(1, { subCategory: ' ' }), 'category-missing'],
        [row(1, { category: 'x'.repeat(46) }), 'category-invalid'],
        [row(1, { name: 'x'.repeat(101) }), 'name-invalid'],
        [row(1, { account: '' }), 'account-invalid'],
        [row(1, { type: 'transference', category: null, subCategory: null }), 'destination-missing'],
        [row(1, { type: 'transference', destination: ' banco ' }), 'destination-equals-origin'],
        [row(1, { tags: ['x'.repeat(46)] }), 'tag-invalid'],
    ])('recusa a linha %# pelo motivo esperado', (input, reason) => {
        const analysis = analyzeImport([input], OPTIONS, TODAY);
        expect(analysis.issues).toEqual([{ line: 1, reason }]);
        expect(analysis.standalone).toHaveLength(0);
    });

    it('aceita transferência sem categoria: ela usa a padrão da revisão', () => {
        const analysis = analyzeImport([row(1, { type: 'transference', destination: 'Corretora', category: null, subCategory: null })], OPTIONS, TODAY);
        expect(analysis.issues).toEqual([]);
        expect(analysis.categories).toEqual([]);
        expect(analysis.accounts.map((use) => use.name)).toEqual(['Banco', 'Corretora']);
    });
});

describe('analyzeImport — pagamento, tags e cartão', () => {
    it('paga no vencimento as linhas vencidas só com "pagas até hoje" (import-design §5.3)', () => {
        const rows = [row(1, { dueDate: LocalDate.parse('2026-10-15') }), row(2, { dueDate: LocalDate.parse('2026-10-16') })];
        const off = analyzeImport(rows, OPTIONS, TODAY);
        expect(off.standalone.map((item) => item.paymentDate)).toEqual([null, null]);
        const on = analyzeImport(rows, { ...OPTIONS, pastDueAsPaid: true }, TODAY);
        expect(on.standalone.map((item) => item.paymentDate?.toString() ?? null)).toEqual(['2026-10-15', null]);
        expect([on.paid, on.pending]).toEqual([1, 1]);
    });

    it('junta as tags da coluna e as #palavras da observação, sem repetir (import-design §5.2)', () => {
        const input = row(1, { tags: ['Viagem'], description: '#viagem #TiaDarci  #Madrinha' });
        expect(analyzeImport([input], OPTIONS, TODAY).standalone[0]?.tags).toEqual(['Viagem', 'TiaDarci', 'Madrinha']);
        const off = analyzeImport([input], { ...OPTIONS, hashtagsAsTags: false }, TODAY);
        expect(off.standalone[0]?.tags).toEqual(['Viagem']);
        expect(off.hashtags).toEqual({ rows: 1, names: ['viagem', 'TiaDarci', 'Madrinha'] });
    });

    it('ignora o cartão fora da despesa e usa a data da compra no cartão', () => {
        const analysis = analyzeImport([
            row(1, { creditCard: 'Inter', purchaseDate: LocalDate.parse('2026-02-20') }),
            row(2, { type: 'income', creditCard: 'Inter', purchaseDate: LocalDate.parse('2026-02-20') }),
        ], OPTIONS, TODAY);
        expect(analysis.standalone.map((item) => [item.creditCard, item.date.toString()])).toEqual([
            ['Inter', '2026-02-20'],
            [null, '2026-03-10'],
        ]);
    });

    it('sugere vencimento, pagadora e fechamento do cartão pelas linhas (import-design §5.1)', () => {
        const purchases = [1, 3, 5, 7, 8, 12, 20, 28].map((day, index) => row(index + 1, {
            creditCard: 'Inter',
            account: index === 0 ? 'Outra' : 'Banco',
            purchaseDate: LocalDate.of(2026, 3, day),
            // Até o dia 7 cai na fatura que vence em 15/03; do 8 em diante, na de 15/04.
            dueDate: LocalDate.of(2026, day < 8 ? 3 : 4, 15),
        }));
        const [card] = analyzeImport(purchases, OPTIONS, TODAY).creditCards;
        expect(card).toEqual({ name: 'Inter', rows: 8, payingAccount: 'Banco', dueDay: 15, closingDay: 8 });
    });

    it('não sugere fechamento com menos de três compras com data', () => {
        const [card] = analyzeImport([row(1, { creditCard: 'Inter', purchaseDate: LocalDate.parse('2026-03-01') })], OPTIONS, TODAY).creditCards;
        expect(card?.closingDay).toBeNull();
    });
});

describe('analyzeImport — séries (import-design §5.5)', () => {
    it('numera a fixa pelo mês: o mês que falta é um número pulado', () => {
        const analysis = analyzeImport([fixed(1, '2026-03-11'), fixed(2, '2026-01-11'), fixed(3, '2026-04-11')], OPTIONS, TODAY);
        expect(analysis.series).toHaveLength(1);
        expect(analysis.series[0]?.occurrences.map((item) => [item.occurrence, item.row.line])).toEqual([[1, 2], [3, 1], [4, 3]]);
    });

    it('termina a fixa na última linha quando ela vence antes do horizonte', () => {
        const [series] = analyzeImport([fixed(1, '2026-01-11'), fixed(2, '2026-02-11')], OPTIONS, TODAY).series;
        expect(series?.endAt?.toString()).toBe('2026-02-11');
    });

    it('continua sem fim a fixa que passa do horizonte, e descarta as futuras se pedido', () => {
        const rows = ['2026-09-11', '2027-10-11', '2027-11-11', '2030-12-11'].map((date, index) => fixed(index + 1, date));
        const kept = analyzeImport(rows, OPTIONS, TODAY);
        expect(kept.series[0]?.endAt).toBeNull();
        expect(kept.series[0]?.occurrences).toHaveLength(4);
        const dropped = analyzeImport(rows, { ...OPTIONS, keepFutureOccurrences: false }, TODAY);
        expect(dropped.series[0]?.occurrences.map((item) => item.row.dueDate.toString())).toEqual(['2026-09-11', '2027-10-11']);
        expect(dropped.droppedFuture).toBe(2);
    });

    it('separa séries por nome, conta e cartão', () => {
        const analysis = analyzeImport([
            fixed(1, '2026-01-11'),
            fixed(2, '2026-01-11', { name: 'aluguel ' }),
            fixed(3, '2026-01-11', { account: 'Outra' }),
            fixed(4, '2026-01-11', { creditCard: 'Inter' }),
        ], OPTIONS, TODAY);
        expect(analysis.series.map((series) => series.occurrences.length)).toEqual([1, 1, 1]);
        // "aluguel " é a mesma série de "Aluguel", no mesmo número: vira avulsa.
        expect(analysis.standalone.map((item) => item.row.line)).toEqual([2]);
    });

    it('agrupa o parcelamento pela parcela, tira o sufixo e data cada compra no seu mês', () => {
        const analysis = analyzeImport([installment(1, 3), installment(2, 1), installment(3, 2)], OPTIONS, TODAY);
        const [series] = analysis.series;
        expect(series?.kind).toBe('installments');
        expect(series?.installments).toBe(3);
        expect(series?.occurrences.map((item) => [item.occurrence, item.name, item.date.toString()])).toEqual([
            [1, 'Mouse', '2026-01-20'],
            [2, 'Mouse', '2026-02-20'],
            [3, 'Mouse', '2026-03-20'],
        ]);
    });

    it('separa compras iguais em datas diferentes e põe a parcela inválida ou repetida como avulsa', () => {
        const analysis = analyzeImport([
            installment(1, 1),
            installment(2, 1, { purchaseDate: LocalDate.parse('2026-05-02') }),
            installment(3, 1),
            installment(4, 4),
            installment(5, 1, { repetition: { kind: 'installments', frequency: 'monthly', installment: 1, installments: 1 } }),
        ], OPTIONS, TODAY);
        expect(analysis.series).toHaveLength(2);
        // As avulsas mantêm o nome do arquivo, com o sufixo.
        expect(analysis.standalone.map((item) => [item.row.line, item.name])).toEqual([[3, 'Mouse  1/3'], [4, 'Mouse  4/3'], [5, 'Mouse  1/3']]);
    });

    it('sem agrupar, toda linha é avulsa', () => {
        const analysis = analyzeImport([fixed(1, '2026-01-11'), installment(2, 1)], { ...OPTIONS, groupSeries: false }, TODAY);
        expect(analysis.series).toEqual([]);
        expect(analysis.standalone.map((item) => item.occurrence)).toEqual([null, null]);
    });

    it('grava a fixa avulsa no cartão no vencimento, e não na data em que a série foi criada', () => {
        const rows = [1, 2].map((line) => fixed(line, `2026-0${String(line)}-10`, { creditCard: 'Nubank', purchaseDate: LocalDate.parse('2019-05-03') }));
        const analysis = analyzeImport(rows, { ...OPTIONS, groupSeries: false }, TODAY);
        expect(analysis.standalone.map((item) => item.date.toString())).toEqual(['2026-01-10', '2026-02-10']);
    });

    it('desloca a parcela avulsa pelo número dela, como no parcelamento agrupado', () => {
        const rows = [installment(1, 1), installment(2, 2), installment(3, 3)];
        const grouped = analyzeImport(rows, OPTIONS, TODAY).series.flatMap((series) => series.occurrences);
        const standalone = analyzeImport(rows, { ...OPTIONS, groupSeries: false }, TODAY).standalone;
        expect(standalone.map((item) => item.date.toString())).toEqual(['2026-01-20', '2026-02-20', '2026-03-20']);
        expect(standalone.map((item) => item.date.toString())).toEqual(grouped.map((item) => item.date.toString()));
    });
});
