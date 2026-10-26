import { expect, test, type Page } from '@playwright/test';
import { currentPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Cadastro de sócios (desktop-mvp-plan Fase 13.7) no app empacotado: o exemplo do mockup
 * `DesktopSocios` — Gustavo (60%) e Ana (40%) no Estúdio GO —, a soma ao vivo que só libera o
 * salvar em 100%, "Aportou" e "Deveria ter aportado", e a remoção de um sócio com aporte, que
 * passa a aparecer como entrada sem sócio no relatório. Os cliques usam `dispatchEvent`, pelo motivo explicado
 * em `firstUse.ts`.
 */

/** Ids do cenário semeado. */
interface Seeded {
    readonly profileId: string;
    readonly accountId: string;
    readonly subCategoryId: string;
}

/**
 * Cria o perfil empresarial pela ponte, como o primeiro uso faria.
 *
 * @param page Janela do app, na tela de primeiro uso.
 * @return O perfil, a conta e uma subcategoria sugerida.
 */
async function seedBusiness(page: Page): Promise<Seeded> {
    await expect(page.getByRole('heading', { name: 'Vamos começar' })).toBeVisible();
    return page.evaluate(async () => {
        const { core } = window.finance;
        const started = await core.call('onboarding.start', {
            profile: { name: 'Estúdio GO', type: 'business', currency: 'BRL' },
            account: { name: 'Conta PJ', type: 'checking', openingBalance: 10000 },
        });
        if (!started.ok) {
            throw new Error('não foi possível criar o perfil do teste');
        }
        const tree = await core.call('categories.tree', { profileId: started.data.profile.id });
        const subCategoryId = tree.ok ? tree.data[0]?.subCategories[0]?.id : undefined;
        if (subCategoryId === undefined) {
            throw new Error('o perfil não tem subcategoria');
        }
        await window.finance.preferences.update({ lastProfileId: started.data.profile.id });
        return { profileId: started.data.profile.id, accountId: started.data.account.id, subCategoryId };
    });
}

/**
 * Abre a tela Sócios pelo menu, onde o item só existe no perfil empresarial.
 *
 * @param page Janela do app, com o shell aberto num perfil empresarial.
 */
async function openPartners(page: Page): Promise<void> {
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Sócios', exact: true }).dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Sócios', level: 1 })).toBeVisible();
}

/**
 * Adiciona um sócio pela última linha da tabela.
 *
 * @param page Janela do app, na tela Sócios.
 * @param name Nome do sócio novo.
 */
async function addPartner(page: Page, name: string): Promise<void> {
    await page.getByLabel('Nome do novo sócio').fill(name);
    await page.getByRole('button', { name: '+ Adicionar' }).dispatchEvent('click');
    await expect(page.getByLabel(`Participação de ${name}`)).toHaveValue('0');
}

test('sócios: soma ao vivo até 100%, aportou × deveria e remoção que deixa o aporte sem sócio', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        const seeded = await seedBusiness(page);
        await page.reload();
        await openPartners(page);
        await expect(page.getByRole('status').filter({ hasText: 'Sem sócios' })).toBeVisible();

        await addPartner(page, 'Gustavo');
        await addPartner(page, 'Ana');
        await page.getByLabel('Participação de Gustavo').fill('60');
        await page.getByLabel('Participação de Ana').fill('30');
        await expect(page.getByText('Faltam 10% para fechar 100%.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toBeDisabled();

        await page.getByLabel('Participação de Ana').fill('40');
        await expect(page.getByText('A soma dá 100%. Pode salvar.')).toBeVisible();
        await expect(page.getByRole('img', { name: 'Gustavo 60%, Ana 40%' })).toBeVisible();
        await page.getByRole('button', { name: 'Salvar', exact: true }).dispatchEvent('click');
        await expect(page.getByText('Sócios salvos.')).toBeVisible();
        // A tabela recomeça do gravado, com os dois sócios.
        await expect(page.getByLabel('Participação de Ana')).toHaveValue('40');

        // Um aporte do Gustavo: "Aportou" e "Deveria ter aportado" acompanham.
        const period = currentPeriod(new Date());
        await page.evaluate(
            async ({ seeded, period }) => {
                const { core } = window.finance;
                const list = await core.call('partners.list', { profileId: seeded.profileId });
                const gustavo = list.ok ? list.data.find((partner) => partner.name === 'Gustavo')?.id : undefined;
                await core.call('transactions.create', {
                    profileId: seeded.profileId,
                    subCategoryId: seeded.subCategoryId,
                    type: 'income',
                    source: { kind: 'account', accountId: seeded.accountId },
                    name: 'Aporte inicial',
                    value: 3200,
                    dueDate: `${period}-02`,
                    paymentDate: `${period}-02`,
                    partnerId: gustavo ?? null,
                });
            },
            { seeded, period },
        );
        await page.reload();
        await openPartners(page);
        const list = page.getByRole('region', { name: 'Lista de sócios' });
        await expect(list).toContainText('R$ 3.200,00');
        await expect(list).toContainText('R$ 1.920,00');
        await expect(list).toContainText('R$ 1.280,00');

        // Remover Gustavo avisa do aporte, que fica sem sócio ao salvar.
        await page.getByRole('button', { name: 'Remover Gustavo' }).dispatchEvent('click');
        await expect(page.getByText('Ao salvar, o lançamento vinculado a Gustavo fica “sem sócio atribuído” e sai da divisão.')).toBeVisible();
        await page.getByLabel('Participação de Ana').fill('100');
        await page.getByRole('button', { name: 'Salvar', exact: true }).dispatchEvent('click');
        await expect(page.getByText('Sócios salvos.')).toBeVisible();

        await page.getByRole('link', { name: 'Ver relatório por sócio →' }).dispatchEvent('click');
        await expect(page.getByRole('heading', { name: 'Por sócio', level: 1 })).toBeVisible();
        await expect(page.getByRole('group', { name: /^Entradas sem sócio/ })).toContainText('1 lançamento · fora da divisão');
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
