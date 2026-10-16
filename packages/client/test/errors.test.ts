import type { CoreError, ErrorCode } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { callOrThrow, CoreCallError, describeError } from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

/**
 * @param code Código do erro.
 * @param details Detalhes do erro.
 * @return Um erro como atravessa a fronteira.
 */
function coreError(code: ErrorCode, details: CoreError['details'] = {}): CoreError {
    return { code, message: 'mensagem técnica que não chega ao usuário', details };
}

describe('describeError (desktop-mvp-plan Fase 3.2)', () => {
    it('tem mensagem pt-BR para todo código, sem repetir o texto técnico do núcleo', () => {
        const codes: readonly ErrorCode[] = ['VALIDATION_FAILED', 'NOT_FOUND', 'BUSINESS_RULE_VIOLATION', 'CONFLICT', 'SCHEMA_NEWER_THAN_APP', 'INTERNAL'];
        for (const code of codes) {
            const { message } = describeError(coreError(code));
            expect(message).not.toBe('');
            expect(message).not.toContain('técnica');
        }
    });

    it('aponta o campo da validação e do conflito para o formulário destacar', () => {
        expect(describeError(coreError('VALIDATION_FAILED', { field: 'dueDate', reason: 'x', issues: 1 })).field).toBe('dueDate');
        expect(describeError(coreError('INTERNAL', { field: 'x' })).field).toBeNull();
    });

    it('escolhe a mensagem pela regra violada, e a genérica para regra desconhecida', () => {
        expect(describeError(coreError('BUSINESS_RULE_VIOLATION', { rule: 'invoice-already-paid' })).message).toMatch(/já está paga/);
        expect(describeError(coreError('BUSINESS_RULE_VIOLATION', { rule: 'regra-de-outra-versao' })).message).toMatch(/não é permitida/);
    });

    it('nomeia a entidade que não existe mais', () => {
        expect(describeError(coreError('NOT_FOUND', { entity: 'CreditCard', id: 'x' })).message).toMatch(/^O cartão não existe mais/);
    });

    it('descreve erros reais do núcleo: nome repetido vira CONFLICT no campo do nome', async () => {
        const world = new ClientWorld();
        const { profileId } = await world.seed();
        const error = await callOrThrow(world.client, 'categories.create', { profileId, name: 'alimentação' }).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(CoreCallError);
        if (!(error instanceof CoreCallError)) {
            return;
        }
        expect(error.code).toBe('CONFLICT');
        expect(describeError(error.error)).toEqual({ message: 'Já existe uma categoria com o nome "alimentação". Escolha outro nome.', field: 'name' });
    });

    it('descreve a recusa da Request: data inexistente aponta o campo da data', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const result = await world.client.call('transactions.create', {
            profileId: s.profileId, subCategoryId: s.subCategoryId, type: 'expense', source: { kind: 'account', accountId: s.checkingId }, name: 'X', value: 1, dueDate: '2026-02-30',
        });
        expect(result.ok ? null : describeError(result.error).field).toBe('dueDate');
    });
});
