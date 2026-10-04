import { describe, expect, it } from 'vitest';
import {
    EMPTY_ONBOARDING_FORM,
    ONBOARDING_FIELDS,
    readOnboardingForm,
    type OnboardingFormResult,
    type OnboardingFormValues,
} from '../src/renderer/src/firstUse/onboardingForm.ts';

/**
 * @param changes Campos que o teste preenche; o resto fica como no formulário em branco.
 * @return O formulário preenchido com um perfil e uma conta válidos, mais as mudanças.
 */
function filled(changes: Partial<OnboardingFormValues> = {}): OnboardingFormValues {
    return { ...EMPTY_ONBOARDING_FORM, profileName: 'Pessoal', accountName: 'Nubank', ...changes };
}

/**
 * @param result Resultado da leitura.
 * @return Os erros por campo; vazio quando o formulário é válido, para o teste comparar direto.
 */
function errorsOf(result: OnboardingFormResult): Readonly<Record<string, string>> {
    return result.ok ? {} : result.errors;
}

describe('formulário do primeiro uso (desktop-mvp-plan Fase 5)', () => {
    it('monta a entrada do onboarding.start com o perfil e a primeira conta', () => {
        const result = readOnboardingForm(filled({ profileType: 'business', currency: 'USD', accountType: 'investment', openingBalance: '1.234,56' }));
        expect(result).toEqual({
            ok: true,
            input: {
                profile: { name: 'Pessoal', type: 'business', currency: 'USD' },
                account: { name: 'Nubank', type: 'investment', openingBalance: 1234.56 },
            },
        });
    });

    it('saldo inicial em branco é zero, o padrão do cadastro (database-design §4.4)', () => {
        const result = readOnboardingForm(filled({ openingBalance: '  ' }));
        expect(result.ok && result.input.account.openingBalance).toBe(0);
    });

    it('aceita saldo inicial negativo, de conta que já começa no cheque especial', () => {
        const result = readOnboardingForm(filled({ openingBalance: '-50,00' }));
        expect(result.ok && result.input.account.openingBalance).toBe(-50);
    });

    it('recusa saldo que não é um valor em pt-BR, apontando o campo', () => {
        expect(errorsOf(readOnboardingForm(filled({ openingBalance: '12.5' })))).toEqual({ openingBalance: 'Digite um valor como 1.234,56.' });
        expect(errorsOf(readOnboardingForm(filled({ openingBalance: 'abc' })))).toEqual({ openingBalance: 'Digite um valor como 1.234,56.' });
    });

    it('recusa saldo além de 1 trilhão com o teto na mensagem, em vez de lançar erro', () => {
        expect(readOnboardingForm(filled({ openingBalance: '1.000.000.000.000,00' })).ok).toBe(true);
        expect(errorsOf(readOnboardingForm(filled({ openingBalance: '1.000.000.000.000,01' })))).toEqual({
            openingBalance: 'Use um valor de até 1.000.000.000.000,00, positivo ou negativo.',
        });
        expect(errorsOf(readOnboardingForm(filled({ openingBalance: '9'.repeat(400) })))).toEqual({
            openingBalance: 'Use um valor de até 1.000.000.000.000,00, positivo ou negativo.',
        });
    });

    it('saldo inválido não esconde os erros dos outros campos', () => {
        const result = readOnboardingForm(filled({ profileName: '', accountName: '', openingBalance: '12.5' }));
        expect(errorsOf(result)).toEqual({
            profileName: 'Informe o nome do perfil.',
            accountName: 'Informe o nome da conta.',
            openingBalance: 'Digite um valor como 1.234,56.',
        });
    });

    it('nomes em branco (ou só espaços) apontam cada campo, com a mensagem em pt-BR', () => {
        const result = readOnboardingForm(filled({ profileName: '   ', accountName: '' }));
        expect(errorsOf(result)).toEqual({ profileName: 'Informe o nome do perfil.', accountName: 'Informe o nome da conta.' });
    });

    it('o limite do nome é o do núcleo: 45 passa, 46 é recusado com o número na mensagem', () => {
        expect(readOnboardingForm(filled({ profileName: 'a'.repeat(45) })).ok).toBe(true);
        expect(errorsOf(readOnboardingForm(filled({ accountName: 'a'.repeat(46) })))).toEqual({ accountName: 'Use no máximo 45 caracteres.' });
    });

    it('a lista de campos cobre todo o formulário, para nenhum erro ficar sem lugar na tela', () => {
        expect([...ONBOARDING_FIELDS].sort()).toEqual(Object.keys(EMPTY_ONBOARDING_FORM).sort());
    });
});
