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
