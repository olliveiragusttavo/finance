import { formatMonthLong } from '@finance/client';
import { expect, test, type Page } from '@playwright/test';
import { currentPeriod, shiftPeriod } from '../src/renderer/src/shell/referenceMonth.ts';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Shell e navegação (desktop-mvp-plan Fase 4) no app empacotado: menu, mês de referência,
 * tema, seletor de perfil e atalhos. Os cliques usam `dispatchEvent`, e os menus do Radix são
 * abertos pelo teclado, pelo mesmo motivo do teste de fumaça: no container a janela fica fora
 * da tela, e a espera do Playwright por elemento "estável" nunca termina.
 */

/**
 * Cria um perfil pessoal e um empresarial pela ponte, como o primeiro uso e Cadastros fazem —
 * o primeiro uso pela tela tem o próprio teste —, deixa o pessoal como o aberto e recarrega
 * para o shell abrir com eles.
 *
 * @param page Janela do app, ainda sem perfil.
 */
async function seedProfiles(page: Page): Promise<void> {
    await expect(page.getByRole('heading', { name: 'Vamos começar' })).toBeVisible();
    await page.evaluate(async () => {
        const { core } = window.finance;
        const personal = await core.call('onboarding.start', {
            profile: { name: 'Gustavo', type: 'personal', currency: 'BRL' },
            account: { name: 'Nubank', type: 'checking', openingBalance: 0 },
        });
        const business = await core.call('profiles.create', { name: 'Estúdio GO', type: 'business', currency: 'BRL' });
        if (!personal.ok || !business.ok) {
            throw new Error('não foi possível criar os perfis do teste');
        }
        // O núcleo lista por nome; o perfil aberto é o que o primeiro uso deixa gravado.
        await window.finance.preferences.update({ lastProfileId: personal.data.profile.id });
    });
    await page.reload();
    await expect(page.getByTestId('profile-switcher')).toContainText('Gustavo');
}

/**
 * @param page Janela do app.
 * @param name Texto do item do menu lateral.
 */
async function openMenuItem(page: Page, name: string): Promise<void> {
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name, exact: true }).dispatchEvent('click');
}

test('o menu leva a todas as telas e o mês de referência acompanha a navegação', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await seedProfiles(page);
        const today = currentPeriod(new Date());
        const month = page.getByTestId('reference-month');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Visão geral');
        await expect(month).toHaveText(formatMonthLong(today));
        await expect(page.getByRole('button', { name: 'Voltar ao mês atual' })).toHaveCount(0);

        await page.getByRole('button', { name: 'Próximo mês' }).dispatchEvent('click');
        await expect(month).toHaveText(formatMonthLong(shiftPeriod(today, 1)));
        await expect(page.getByRole('button', { name: 'Voltar ao mês atual' })).toBeVisible();

        await openMenuItem(page, 'Transações');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transações');
        await expect(month).toHaveText(formatMonthLong(shiftPeriod(today, 1)));

        // Atalhos `[` e `]` trocam o mês; com o foco no corpo da página, não num campo.
        await page.locator('body').press('[');
        await page.locator('body').press('[');
        await expect(month).toHaveText(formatMonthLong(shiftPeriod(today, -1)));
        await page.getByRole('button', { name: 'Voltar ao mês atual' }).dispatchEvent('click');
        await expect(month).toHaveText(formatMonthLong(today));

        // Telas de configuração não mostram o mês (decisão da Fase 4), mas a barra continua.
        await openMenuItem(page, 'Cadastros');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cadastros');
        await expect(month).toHaveCount(0);
        await expect(page.getByRole('button', { name: '+ Lançamento' })).toBeVisible();

        // Relatórios abrem os subitens; "Por sócio" só no perfil empresarial.
        await openMenuItem(page, 'Relatórios');
        const menu = page.getByRole('navigation', { name: 'Navegação principal' });
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Relatório por categoria');
        await expect(menu.getByRole('link', { name: 'Por categoria' })).toHaveAttribute('aria-current', 'page');
        await expect(menu.getByRole('link', { name: 'Fluxo por conta' })).toBeVisible();
        await expect(menu.getByRole('link', { name: 'Por sócio' })).toHaveCount(0);
        await openMenuItem(page, 'Por tag');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Relatório por tag');
        await expect(month).toHaveText(formatMonthLong(today));
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('trocar de perfil mostra "Por sócio" no empresarial e é lembrado ao reabrir; tema e mês também', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await seedProfiles(page);
        await openMenuItem(page, 'Relatórios');

        await page.getByTestId('profile-switcher').press('Enter');
        await page.getByRole('menuitemradio', { name: /Estúdio GO/ }).dispatchEvent('click');
        await expect(page.getByTestId('profile-switcher')).toContainText('Empresarial · BRL');
        await expect(page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Por sócio' })).toBeVisible();

        await page.getByRole('button', { name: 'Seguir o sistema' }).press('Enter');
        await page.getByRole('menuitemradio', { name: 'Tema escuro' }).dispatchEvent('click');
        await expect(page.locator('html')).toHaveClass(/\bdark\b/);

        await page.getByRole('button', { name: 'Mês anterior' }).dispatchEvent('click');
        const previous = shiftPeriod(currentPeriod(new Date()), -1);
        await expect(page.getByTestId('reference-month')).toHaveText(formatMonthLong(previous));

        // As preferências são do aparelho e sobrevivem a recarregar a janela sem o mês na URL.
        await page.evaluate(() => {
            window.location.hash = '#/';
        });
        await page.reload();
        await expect(page.getByTestId('profile-switcher')).toContainText('Estúdio GO');
        await expect(page.locator('html')).toHaveClass(/\bdark\b/);
        await expect(page.getByTestId('reference-month')).toHaveText(formatMonthLong(previous));
    } finally {
        await app.close();
        removeUserData(userData);
    }
});

test('N e "+ Lançamento" abrem o diálogo de lançamento em qualquer tela', async () => {
    const { app, window: page, userData } = await launchApp();
    try {
        await seedProfiles(page);
        await openMenuItem(page, 'Ajustes');
        await page.locator('body').press('n');
        const panel = page.getByRole('dialog', { name: 'Novo lançamento' });
        await expect(panel).toBeVisible();
        await panel.press('Escape');
        await expect(panel).toHaveCount(0);

        await page.getByRole('button', { name: '+ Lançamento' }).dispatchEvent('click');
        await expect(panel).toBeVisible();
    } finally {
        await app.close();
        removeUserData(userData);
    }
});
