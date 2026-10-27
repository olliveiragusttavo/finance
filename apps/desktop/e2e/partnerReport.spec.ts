import { expect, test, type Locator, type Page } from '@playwright/test';
import { currentPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Distribuição por sócio (reports-design §8; desktop-mvp-plan Fases 13.6 e 13.8), fixada no topo
 * dos Relatórios do perfil empresarial, no app empacotado: o exemplo dos
 * aportes — Matheus (60%) e Gustavo (40%) aportam R$ 1.000,00 cada, e Matheus deveria ter aportado
 * R$ 1.200,00 —, a lista de entradas sem sócio com a receita de serviço e o Pix vindo do perfil
 * pessoal, e o campo "Sócio que aportou" do lançamento, que só aparece na receita. Os cliques usam
 * `dispatchEvent`, pelo motivo explicado em `firstUse.ts`.
 */

/** Ids do cenário semeado. */
interface Seeded {
    readonly profileId: string;
    readonly accountId: string;
    readonly subCategoryId: string;
    /** "Categoria Sub" da subcategoria, para a busca do campo Categoria. */
    readonly categorySearch: string;
    readonly personalId: string;
    readonly personalAccountId: string;
    readonly personalSubCategoryId: string;
}

/**
 * Cria o perfil empresarial pelo primeiro uso e o pessoal, com uma conta, pela ponte.
 *
 * @param page Janela do app, na tela de primeiro uso.
 * @return Os perfis, as contas e uma subcategoria de cada um.
 */
async function seedProfiles(page: Page): Promise<Seeded> {
    await expect(page.getByRole('heading', { name: 'Vamos começar' })).toBeVisible();
    return page.evaluate(async () => {
        const { core } = window.finance;
        const started = await core.call('onboarding.start', {
            profile: { name: 'Estúdio GO', type: 'business', currency: 'BRL' },
            account: { name: 'Conta PJ', type: 'checking', openingBalance: 10000 },
        });
        const personal = await core.call('onboarding.start', {
            profile: { name: 'Pessoal', type: 'personal', currency: 'BRL' },
            account: { name: 'Nubank', type: 'checking', openingBalance: 5000 },
        });
        if (!started.ok || !personal.ok) {
            throw new Error('não foi possível criar os perfis do teste');
        }
        const tree = await core.call('categories.tree', { profileId: started.data.profile.id });
        const category = tree.ok ? tree.data[0] : undefined;
        const sub = category?.subCategories[0];
        const personalTree = await core.call('categories.tree', { profileId: personal.data.profile.id });
        const personalSub = personalTree.ok ? personalTree.data[0]?.subCategories[0] : undefined;
        if (category === undefined || sub === undefined || personalSub === undefined) {
            throw new Error('os perfis não têm subcategoria');
        }
        await window.finance.preferences.update({ lastProfileId: started.data.profile.id });
        return {
            profileId: started.data.profile.id,
            accountId: started.data.account.id,
            subCategoryId: sub.id,
            categorySearch: `${category.name} ${sub.name}`,
            personalId: personal.data.profile.id,
            personalAccountId: personal.data.account.id,
            personalSubCategoryId: personalSub.id,
        };
    });
}

/**
 * Cadastra os sócios pela rota do cadastro (`partners.save`), como a tela de Sócios grava.
 *
 * @param page Janela do app.
 * @param profileId Perfil empresarial.
 * @return Os ids de Matheus e Gustavo.
 */
async function seedPartners(page: Page, profileId: string): Promise<{ readonly matheus: string; readonly gustavo: string }> {
    return page.evaluate(async (profileId) => {
        const saved = await window.finance.core.call('partners.save', {
            profileId,
            partners: [
                { id: null, name: 'Matheus', percentage: 60 },
                { id: null, name: 'Gustavo', percentage: 40 },
            ],
        });
        const matheus = saved.ok ? saved.data.find((partner) => partner.name === 'Matheus')?.id : undefined;
        const gustavo = saved.ok ? saved.data.find((partner) => partner.name === 'Gustavo')?.id : undefined;
        if (matheus === undefined || gustavo === undefined) {
            throw new Error('não foi possível cadastrar os sócios do teste');
        }
        return { matheus, gustavo };
    }, profileId);
}

/**
 * Escolhe uma opção num seletor, como em `goals.spec.ts`: no `Combobox` o foco fica na busca e a
 * opção se escolhe pelo clique; no `Select` do Radix, pelo Enter.
 *
 * @param page Janela do app.
 * @param field Gatilho do campo.
 * @param option Nome da opção.
 */
async function chooseOption(page: Page, field: Locator, option: string): Promise<void> {
    await field.press('Enter');
    const item = page.getByRole('option', { name: option, exact: true });
    if ((await page.getByRole('combobox', { name: /^Buscar/ }).count()) > 0) {
        await item.dispatchEvent('click');
    } else {
        await item.focus();
        await item.press('Enter');
    }
    await expect(page.getByRole('listbox')).toHaveCount(0);
}

test('por sócio: aportes de todos os períodos, acerto, entradas sem sócio e o sócio no lançamento', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        const seeded = await seedProfiles(page);
        const partners = await seedPartners(page, seeded.profileId);
        const period = currentPeriod(new Date());
        await page.evaluate(
            async ({ seeded, partners, period }) => {
                const { core } = window.finance;
                const paid = { dueDate: `${period}-02`, paymentDate: `${period}-02` };
                const business = { profileId: seeded.profileId, subCategoryId: seeded.subCategoryId, type: 'income', source: { kind: 'account', accountId: seeded.accountId } } as const;
                await core.call('transactions.create', { ...business, ...paid, name: 'Aporte inicial', value: 1000, partnerId: partners.matheus });
                await core.call('transactions.create', { ...business, ...paid, name: 'Projeto do cliente', value: 4000 });
                await core.call('transactions.create', {
                    ...paid,
                    profileId: seeded.personalId,
                    subCategoryId: seeded.personalSubCategoryId,
                    type: 'transference',
                    source: { kind: 'account', accountId: seeded.personalAccountId },
                    destinationAccountId: seeded.accountId,
                    name: 'Pix do Gustavo',
                    value: 1000,
                });
            },
            { seeded, partners, period },
        );
        await page.reload();

        // O relatório fica fixado no topo dos Relatórios do perfil empresarial.
        await page.getByRole('link', { name: 'Relatórios', exact: true }).dispatchEvent('click');
        await page.getByRole('list', { name: 'Relatórios fixos' }).getByRole('link', { name: 'Distribuição por sócio', exact: true }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Distribuição por sócio', level: 2 })).toBeVisible();

        await expect(page.getByRole('group', { name: 'Total de aportes' })).toContainText('R$ 1.000,00');
        await expect(page.getByRole('group', { name: /^Entradas sem sócio/ })).toContainText('R$ 5.000,00');
        const entries = page.getByRole('table', { name: 'Entradas sem sócio' });
        await expect(entries.getByRole('row', { name: /Projeto do cliente/ })).toContainText('+R$ 4.000,00');
        await expect(entries.getByRole('row', { name: /Pix do Gustavo/ })).toContainText('Nubank (Pessoal) → Conta PJ');

        // O Pix que veio do perfil pessoal é o aporte do Gustavo.
        await chooseOption(page, page.getByRole('combobox', { name: 'Quem aportou: Pix do Gustavo' }), 'Gustavo');
        await expect(page.getByRole('group', { name: 'Total de aportes' })).toContainText('R$ 2.000,00');
        const table = page.getByRole('table', { name: 'Sócios' });
        await expect(table.getByRole('row', { name: /Matheus/ })).toContainText('R$ 1.200,00');
        await expect(table.getByRole('row', { name: /Matheus/ })).toContainText('▼ −R$ 200,00 · aportou a menos');
        await expect(table.getByRole('row', { name: /Gustavo/ })).toContainText('▲ +R$ 200,00 · aportou a mais');
        await expect(page.getByRole('list', { name: 'Acerto dos aportes' })).toHaveText('Matheus transfere R$ 200,00 para Gustavo.');
        await expect(entries.getByRole('row', { name: /Pix do Gustavo/ })).toHaveCount(0);

        // O campo de sócio só existe na receita; o aporte de R$ 500,00 do Matheus equilibra o acerto.
        await page.getByRole('button', { name: '+ Lançamento' }).dispatchEvent('click');
        const form = page.getByRole('dialog', { name: 'Novo lançamento' });
        await expect(form.getByLabel('Sócio que aportou')).toHaveCount(0);
        await form.getByRole('radio', { name: 'Receita' }).dispatchEvent('click');
        await form.getByLabel('Valor (BRL)').fill('500,00');
        await form.getByLabel('Nome').fill('Aporte do Matheus');
        await form.getByLabel('Categoria', { exact: true }).dispatchEvent('click');
        const search = page.getByRole('combobox', { name: 'Buscar categoria' });
        await search.fill(seeded.categorySearch);
        await search.press('Enter');
        await chooseOption(page, form.getByLabel('Conta ou cartão'), 'Conta PJ');
        await form.getByLabel('Pago').dispatchEvent('click');
        await chooseOption(page, form.getByLabel('Sócio que aportou'), 'Matheus');
        await form.getByRole('button', { name: 'Salvar' }).dispatchEvent('click');
        await expect(form).toHaveCount(0);

        await expect(page.getByRole('group', { name: 'Total de aportes' })).toContainText('R$ 2.500,00');
        await expect(table.getByRole('row', { name: /Matheus/ })).toContainText('em dia');
        await expect(page.getByText('Os aportes estão equilibrados: cada sócio aportou a sua parte.')).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
