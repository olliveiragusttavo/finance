import { describe, expect, it } from 'vitest';
import { LocalDate, YearMonth } from '../../src/index.ts';
import { BillingCycle } from '../../src/domain/creditCard/BillingCycle.ts';
import { APP_UUID_NAMESPACE, transactionTagIdFor, uuidV5 } from '../../src/domain/shared/DeterministicIds.ts';
import { TagId, TransactionId } from '../../src/domain/shared/ids.ts';

describe('LocalDate e YearMonth', () => {
    it('rejeita datas inexistentes, como o CHECK de formato do schema', () => {
        expect(() => LocalDate.parse('2026-02-29')).toThrow();
        expect(() => LocalDate.parse('2026-04-31')).toThrow();
        expect(LocalDate.parse('2028-02-29').toString()).toBe('2028-02-29');
    });

    it('vira o ano nos dois sentidos', () => {
        expect(YearMonth.parse('2026-12').next().toString()).toBe('2027-01');
        expect(YearMonth.parse('2026-01').previous().toString()).toBe('2025-12');
    });

    it('conhece fevereiro bissexto, inclusive as regras de século', () => {
        expect(YearMonth.of(2024, 2).lengthInDays()).toBe(29);
        expect(YearMonth.of(2100, 2).lengthInDays()).toBe(28);
        expect(YearMonth.of(2000, 2).lengthInDays()).toBe(29);
    });
});

describe('BillingCycle — regras do cartão (database-design §4.5 e §4.7)', () => {
    const cycle = BillingCycle.of(10, 17);

    it.each([
        ['2026-03-09', '2026-03'],
        // A compra feita no dia do fechamento entra na fatura seguinte.
        ['2026-03-10', '2026-04'],
        ['2026-03-11', '2026-04'],
        ['2026-12-10', '2027-01'],
    ])('sugere para a compra de %s a fatura %s', (purchase, invoice) => {
        expect(cycle.suggestedInvoicePeriod(LocalDate.parse(purchase)).toString()).toBe(invoice);
    });

    it.each([
        ['2026-04', '2026-04-30'],
        ['2026-02', '2026-02-28'],
        ['2028-02', '2028-02-29'],
        ['2026-05', '2026-05-31'],
    ])('fecha no dia 31 ajustado para o último dia do mês: %s fecha em %s', (period, closing) => {
        expect(BillingCycle.of(31, 10).closingDateOf(YearMonth.parse(period)).toString()).toBe(closing);
    });

    it('com fechamento no dia 31, a compra de 28/02 (não bissexto) cai na fatura de março', () => {
        expect(BillingCycle.of(31, 10).suggestedInvoicePeriod(LocalDate.parse('2026-02-28')).toString()).toBe('2026-03');
        expect(BillingCycle.of(31, 10).suggestedInvoicePeriod(LocalDate.parse('2028-02-28')).toString()).toBe('2028-02');
    });

    it('vence no primeiro dia de vencimento depois do fechamento', () => {
        // Fecha dia 10 e vence dia 17: mesmo mês.
        expect(cycle.dueDateOf(YearMonth.parse('2026-03')).toString()).toBe('2026-03-17');
        // Fecha dia 25 e vence dia 5: mês seguinte, virando o ano em dezembro.
        expect(BillingCycle.of(25, 5).dueDateOf(YearMonth.parse('2026-12')).toString()).toBe('2027-01-05');
        // Vencimento no dia 31 ajustado em fevereiro.
        expect(BillingCycle.of(20, 31).dueDateOf(YearMonth.parse('2026-02')).toString()).toBe('2026-02-28');
    });
});

describe('UUID v5', () => {
    it('confere com o vetor de teste do RFC 9562 (namespace DNS, "www.example.com")', () => {
        expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    });

    it('o vínculo transação–tag deriva do par, com a chave permanente "transactions_tags:<transação>:<tag>"', () => {
        const transactionId = TransactionId('00000000-0000-4000-8000-000000000001');
        const tagId = TagId('00000000-0000-4000-8000-000000000002');
        expect(transactionTagIdFor(transactionId, tagId)).toBe(uuidV5(APP_UUID_NAMESPACE, `transactions_tags:${transactionId}:${tagId}`));
        expect(transactionTagIdFor(transactionId, tagId)).not.toBe(transactionTagIdFor(transactionId, TagId('00000000-0000-4000-8000-000000000003')));
    });
});
