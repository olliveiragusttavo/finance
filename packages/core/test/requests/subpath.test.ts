import { describe, expect, it } from 'vitest';
import { MONEY_MAX_AMOUNT } from '@finance/core';
import { createTransactionRequest, moneyField, registryNameField, updateAccountRequest } from '@finance/core/requests';

describe('subcaminho @finance/core/requests (desktop-mvp-plan Fase 1.5)', () => {
    it('expõe os schemas da camada Request pelo nome do pacote, para os formulários da UI', () => {
        expect(registryNameField.safeParse('x'.repeat(46)).success).toBe(false);
        const parsed = createTransactionRequest.safeParse({
            profileId: '00000000-0000-4000-8000-000000000001',
            subCategoryId: '00000000-0000-4000-8000-000000000002',
            source: { kind: 'account', accountId: '00000000-0000-4000-8000-000000000003' },
            type: 'expense',
            name: 'Mercado',
            value: 10,
            dueDate: '2026-02-30',
        });
        expect(parsed.success ? null : parsed.error.issues[0]?.path).toEqual(['dueDate']);
        // A edição não tem defaults: omitir o saldo inicial é erro, não zero silencioso.
        expect(updateAccountRequest.safeParse({ id: '00000000-0000-4000-8000-000000000003', name: 'C', type: 'checking', currencyLabel: null, considerBalance: true }).success).toBe(false);
    });

    it('valor monetário fica entre −1 trilhão e 1 trilhão, inclusive (Regra de negócio: Dinheiro)', () => {
        expect(MONEY_MAX_AMOUNT).toBe(1_000_000_000_000);
        expect(moneyField.safeParse(MONEY_MAX_AMOUNT).success).toBe(true);
        expect(moneyField.safeParse(-MONEY_MAX_AMOUNT).success).toBe(true);
        expect(moneyField.safeParse(MONEY_MAX_AMOUNT + 0.01).success).toBe(false);
        expect(moneyField.safeParse(-MONEY_MAX_AMOUNT - 0.01).success).toBe(false);
        expect(moneyField.safeParse(Infinity).success).toBe(false);
    });
});
