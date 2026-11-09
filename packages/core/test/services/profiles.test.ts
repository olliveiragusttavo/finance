import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

describe('cadastro de perfis (desktop-mvp-plan Fase 1.1)', () => {
    it('cria, lista por nome e renomeia', async () => {
        const world = new TestWorld();
        const business = await world.ok('profiles.create', { name: 'Empresa', type: 'business', currency: 'brl' });
        await world.ok('profiles.create', { name: 'Pessoal', type: 'personal', currency: 'BRL' });
        expect(business).toMatchObject({ name: 'Empresa', type: 'business', currency: 'BRL' });

        const renamed = await world.ok('profiles.update', { id: business.id, name: '  Consultoria ', currency: 'BRL' });
        expect(renamed.name).toBe('Consultoria');
        expect((await world.ok('profiles.list', {})).map((profile) => profile.name)).toEqual(['Consultoria', 'Pessoal']);
    });

    it('recusa nome acima de 45 caracteres', async () => {
        const world = new TestWorld();
        const error = await world.failure('profiles.create', { name: 'x'.repeat(46), type: 'personal', currency: 'BRL' });
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(error.details['field']).toBe('name');
    });

    it('troca a moeda enquanto não há lançamentos; com lançamentos, recusa (a moeda é a unidade de tudo)', async () => {
        const world = new TestWorld();
        const profileId = world.profile();
        expect((await world.ok('profiles.update', { id: profileId, name: 'Perfil', currency: 'USD' })).currency).toBe('USD');
        await world.ok('profiles.update', { id: profileId, name: 'Perfil', currency: 'BRL' });

        const accountId = world.account(profileId);
        await world.create({ profileId, subCategoryId: world.subCategory(profileId) }, { source: { kind: 'account', accountId } });
        const error = await world.failure('profiles.update', { id: profileId, name: 'Perfil', currency: 'USD' });
        expect(error.details['rule']).toBe('profile-currency-locked');
        // Renomear continua permitido: só a moeda fica travada.
        expect((await world.ok('profiles.update', { id: profileId, name: 'Outro nome', currency: 'BRL' })).name).toBe('Outro nome');
    });

    it('perfil inexistente é NOT_FOUND', async () => {
        const world = new TestWorld();
        const error = await world.failure('profiles.update', { id: world.ids.random(), name: 'X', currency: 'BRL' });
        expect(error.code).toBe('NOT_FOUND');
    });
});

describe('primeiro uso (desktop-mvp-plan Fase 1.1)', () => {
    it('cria perfil, primeira conta e as categorias sugeridas de uma vez', async () => {
        const world = new TestWorld();
        const { profile, account } = await world.ok('onboarding.start', {
            profile: { name: 'Gustavo', type: 'personal', currency: 'BRL' },
            account: { name: 'Nubank', type: 'checking', openingBalance: 1234.56 },
        });
        expect(account).toMatchObject({ profileId: profile.id, name: 'Nubank', currency: 'BRL', considerBalance: true, disabled: false });
        expect(account.openingBalance).toEqualMoney('1234.56');
        expect(world.accountRow(account.id).balance).toEqualMoney('1234.56');

        const tree = await world.ok('categories.tree', { profileId: profile.id });
        expect(tree).toHaveLength(8);
        expect(tree.flatMap((category) => category.subCategories)).toHaveLength(17);
    });

    it('pode dispensar as categorias sugeridas', async () => {
        const world = new TestWorld();
        const { profile } = await world.ok('onboarding.start', {
            profile: { name: 'Gustavo', type: 'personal', currency: 'BRL' },
            account: { name: 'Nubank', type: 'checking' },
            suggestedCategories: false,
        });
        expect(await world.ok('categories.tree', { profileId: profile.id })).toEqual([]);
    });

    it('não deixa perfil sem conta: se a conta falha, o perfil também não fica', () => {
        const world = new TestWorld();
        // Chama o Service direto para passar da camada Request e falhar no domínio, depois de
        // o perfil já ter sido gravado na unidade de trabalho.
        expect(() => world.core.services.onboarding.start({
            profile: { name: 'Gustavo', type: 'personal', currency: 'BRL' },
            account: { name: '   ', type: 'checking', currencyLabel: null, considerBalance: true, openingBalance: 0 },
            suggestedCategories: true,
        })).toThrow();
        expect(world.core.services.profiles.list()).toEqual([]);
        expect(world.database.get('SELECT count(*) AS n FROM transaction_categories')).toEqual({ n: 0 });
    });
});

describe('conta e cartão padrão do lançamento (database-design §4.1)', () => {
    /**
     * Perfil com duas contas e um cartão, o cenário mínimo para trocar o padrão de um para outro.
     *
     * @param world Núcleo do teste.
     * @return Os ids semeados.
     */
    function seed(world: TestWorld): { readonly profileId: string; readonly checkingId: string; readonly savingsId: string; readonly creditCardId: string } {
        const profileId = world.profile();
        const checkingId = world.account(profileId, { name: 'Nubank' });
        const savingsId = world.account(profileId, { name: 'Itaú' });
        return { profileId, checkingId, savingsId, creditCardId: world.creditCard(profileId, checkingId, 1, 8) };
    }

    it('nasce sem padrão; escolher outra conta substitui a anterior, e `null` tira o padrão', async () => {
        const world = new TestWorld();
        const { profileId, checkingId, savingsId, creditCardId } = seed(world);
        expect(await world.ok('profiles.list', {})).toEqual([expect.objectContaining({ defaultAccountId: null, defaultCreditCardId: null })]);

        await world.ok('profiles.setDefaultAccount', { profileId, accountId: checkingId });
        const replaced = await world.ok('profiles.setDefaultAccount', { profileId, accountId: savingsId });
        expect(replaced.defaultAccountId).toBe(savingsId);
        const withCard = await world.ok('profiles.setDefaultCreditCard', { profileId, creditCardId });
        expect(withCard).toMatchObject({ defaultAccountId: savingsId, defaultCreditCardId: creditCardId });

        expect((await world.ok('profiles.setDefaultAccount', { profileId, accountId: null })).defaultAccountId).toBeNull();
        expect((await world.ok('profiles.setDefaultCreditCard', { profileId, creditCardId: null })).defaultCreditCardId).toBeNull();
    });

    it('renomear o perfil não apaga o padrão', async () => {
        const world = new TestWorld();
        const { profileId, checkingId } = seed(world);
        await world.ok('profiles.setDefaultAccount', { profileId, accountId: checkingId });
        expect((await world.ok('profiles.update', { id: profileId, name: 'Casa', currency: 'BRL' })).defaultAccountId).toBe(checkingId);
    });

    it('desativada, a conta deixa de ser o padrão sem perder a escolha: reativar a devolve, mesmo depois de editar o perfil', async () => {
        const world = new TestWorld();
        const { profileId, checkingId, creditCardId } = seed(world);
        await world.ok('profiles.setDefaultAccount', { profileId, accountId: checkingId });
        await world.ok('profiles.setDefaultCreditCard', { profileId, creditCardId });

        await world.ok('accounts.disable', { id: checkingId });
        await world.ok('creditCards.disable', { id: creditCardId });
        expect(await world.ok('profiles.update', { id: profileId, name: 'Casa', currency: 'BRL' })).toMatchObject({ defaultAccountId: null, defaultCreditCardId: null });

        await world.ok('accounts.enable', { id: checkingId });
        await world.ok('creditCards.enable', { id: creditCardId });
        expect((await world.ok('profiles.list', {}))[0]).toMatchObject({ defaultAccountId: checkingId, defaultCreditCardId: creditCardId });
    });

    it('excluída, a conta deixa de ser o padrão', async () => {
        const world = new TestWorld();
        const { profileId, savingsId } = seed(world);
        await world.ok('profiles.setDefaultAccount', { profileId, accountId: savingsId });
        await world.ok('accounts.delete', { id: savingsId });
        expect((await world.ok('profiles.list', {}))[0]?.defaultAccountId).toBeNull();
    });

    it('recusa conta desativada, conta de outro perfil e cartão desativado', async () => {
        const world = new TestWorld();
        const { profileId, savingsId, creditCardId } = seed(world);
        const other = world.profile();
        const otherAccount = world.account(other);
        await world.ok('accounts.disable', { id: savingsId });
        await world.ok('creditCards.disable', { id: creditCardId });

        expect((await world.failure('profiles.setDefaultAccount', { profileId, accountId: savingsId })).details).toMatchObject({ rule: 'account-disabled', field: 'accountId' });
        expect((await world.failure('profiles.setDefaultAccount', { profileId, accountId: otherAccount })).details).toMatchObject({ rule: 'reference-outside-profile', field: 'accountId' });
        expect((await world.failure('profiles.setDefaultCreditCard', { profileId, creditCardId })).details).toMatchObject({ rule: 'credit-card-disabled', field: 'creditCardId' });
        expect((await world.failure('profiles.setDefaultAccount', { profileId, accountId: world.ids.random() })).code).toBe('NOT_FOUND');
    });
});
