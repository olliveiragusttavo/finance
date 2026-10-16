import { describe, expect, it } from 'vitest';
import { Account } from '../../src/domain/account/Account.ts';
import { Category } from '../../src/domain/category/Category.ts';
import { BillingCycle } from '../../src/domain/creditCard/BillingCycle.ts';
import { CreditCard } from '../../src/domain/creditCard/CreditCard.ts';
import { Profile } from '../../src/domain/profile/Profile.ts';
import { InvalidValueError } from '../../src/domain/shared/errors.ts';
import { AccountId, CategoryId, CreditCardId, ProfileId } from '../../src/domain/shared/ids.ts';
import { sameName } from '../../src/domain/shared/names.ts';
import { Currency, Money } from '../../src/index.ts';

const BRL = Currency.of('BRL');
const profileId = ProfileId('00000000-0000-4000-8000-000000000001');
const accountId = AccountId('00000000-0000-4000-8000-000000000002');

/**
 * @param overrides Campos do cadastro que o teste quer fixar.
 * @return Uma conta válida, para que cada teste declare só o que importa.
 */
function account(overrides: Partial<Parameters<typeof Account.create>[2]> = {}): Account {
    return Account.create(accountId, profileId, {
        name: 'Corrente',
        type: 'checking',
        currencyLabel: 'BRL',
        considerBalance: true,
        openingBalance: Money.of(100, BRL),
        ...overrides,
    });
}

describe('nomes de cadastro (database-design §4.1 a §4.9)', () => {
    it('apara o nome e recusa vazio ou acima de 45 caracteres, antes do CHECK do banco', () => {
        const profile = Profile.create({ id: profileId, name: '  Pessoal  ', type: 'personal', currency: BRL });
        expect(profile.name).toBe('Pessoal');
        expect(() => profile.rename('   ')).toThrow(InvalidValueError);
        expect(() => profile.rename('x'.repeat(46))).toThrow(InvalidValueError);
        expect(profile.rename('x'.repeat(45)).name).toHaveLength(45);
    });

    it('compara nomes sem caixa, inclusive com acento — o NOCASE do SQLite só cobre ASCII', () => {
        expect(sameName('Saúde', 'SAÚDE')).toBe(true);
        expect(sameName(' mercado', 'Mercado ')).toBe(true);
        // "é" composto (U+00E9) e decomposto (e + U+0301) são a mesma letra para o usuário.
        expect(sameName('Café', 'Café')).toBe(true);
        expect(sameName('Saúde', 'Saude')).toBe(false);
    });

    it('renomear não muda identidade nem dono', () => {
        const category = Category.create({ id: CategoryId('00000000-0000-4000-8000-000000000003'), profileId, name: 'Moradia' });
        const renamed = category.rename('Casa');
        expect(renamed).toMatchObject({ id: category.id, profileId, name: 'Casa' });
        expect(category.name).toBe('Moradia');
    });
});

describe('conta (database-design §4.4)', () => {
    it('nasce ativa e com o cache igual ao saldo inicial', () => {
        const created = account({ openingBalance: Money.of(250.5, BRL) });
        expect(created.disabled).toBe(false);
        expect(created.balances.consolidated).toEqualMoney('250.50');
        expect(created.balances.projected).toEqualMoney('250.50');
    });

    it('normaliza o rótulo de moeda e recusa código inválido', () => {
        expect(account({ currencyLabel: 'usd' }).currencyLabel).toBe('USD');
        expect(() => account({ currencyLabel: 'US' })).toThrow(InvalidValueError);
    });

    it('editar mantém id, perfil, desativação e cache; um comando com campos a mais não troca a identidade', () => {
        const disabled = account().disable();
        const content = { name: 'Nova', type: 'investment' as const, currencyLabel: 'BRL', considerBalance: false, openingBalance: Money.of(5, BRL) };
        const revised = disabled.revise({ ...content, ...{ id: AccountId('00000000-0000-4000-8000-0000000000ff') } });
        expect(revised).toMatchObject({ id: accountId, profileId, name: 'Nova', type: 'investment', considerBalance: false, disabled: true });
        expect(revised.balances.consolidated).toEqualMoney('100');
        expect(disabled.openingBalanceDiffersFrom(content)).toBe(true);
    });

    it('desativar e reativar devolvem instâncias novas', () => {
        const active = account();
        const disabled = active.disable();
        expect(active.disabled).toBe(false);
        expect(disabled.enable().disabled).toBe(false);
    });
});

describe('cartão de crédito (database-design §4.5)', () => {
    const content = { accountId, name: 'Roxinho', limit: Money.of(8000, BRL), billingCycle: BillingCycle.of(3, 10) };

    it('recusa limite negativo', () => {
        const id = CreditCardId('00000000-0000-4000-8000-000000000004');
        expect(() => CreditCard.create(id, profileId, { ...content, limit: Money.of(-1, BRL) })).toThrow(InvalidValueError);
        expect(CreditCard.create(id, profileId, content).limit).toEqualMoney('8000');
    });

    it('só conta pagadora ou ciclo afetam saldos ao editar; nome e limite não', () => {
        const card = CreditCard.create(CreditCardId('00000000-0000-4000-8000-000000000004'), profileId, content);
        expect(card.affectsBalancesWhenRevisedTo({ ...content, name: 'Outro', limit: Money.of(1, BRL) })).toBe(false);
        expect(card.affectsBalancesWhenRevisedTo({ ...content, billingCycle: BillingCycle.of(3, 11) })).toBe(true);
        expect(card.affectsBalancesWhenRevisedTo({ ...content, accountId: AccountId('00000000-0000-4000-8000-000000000005') })).toBe(true);
    });
});
