import type { CoreError } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { placeCoreError } from '../src/index.ts';

/**
 * @param code Código do erro.
 * @param details Detalhes do erro.
 * @return Um erro como atravessa a fronteira do núcleo.
 */
function coreError(code: CoreError['code'], details: CoreError['details']): CoreError {
    return { code, message: 'técnico', details };
}

describe('recusa do núcleo no formulário', () => {
    it('conflito de nome vai para baixo do campo do nome', () => {
        const placed = placeCoreError(coreError('CONFLICT', { entity: 'category', field: 'name', name: 'Moradia' }), { name: 'name' });
        expect(placed).toEqual({ field: 'name', message: 'Já existe uma categoria com o nome "Moradia". Escolha outro nome.' });
    });

    it('Regra de negócio (Perfis, §5): moeda travada vai para baixo do campo da moeda', () => {
        const placed = placeCoreError(coreError('BUSINESS_RULE_VIOLATION', { rule: 'profile-currency-locked', field: 'currency' }), { currency: 'currency' });
        expect(placed).toEqual({ field: 'currency', message: 'A moeda do perfil não pode mudar depois que há lançamentos.' });
    });

    it('campo que o formulário não tem, ou erro sem campo, vai para o aviso geral', () => {
        expect(placeCoreError(coreError('NOT_FOUND', { entity: 'Account' }), { name: 'name' }).field).toBeNull();
        expect(placeCoreError(coreError('BUSINESS_RULE_VIOLATION', { rule: 'account-disabled', field: 'accountId' }), { name: 'name' }).field).toBeNull();
    });
});
