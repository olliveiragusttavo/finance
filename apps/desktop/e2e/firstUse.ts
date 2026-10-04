import { expect, type Page } from '@playwright/test';

/** O que o teste digita no primeiro uso. */
export interface FirstUseAnswers {
    readonly profileName: string;
    readonly accountName: string;
    /** Saldo inicial como o usuário digita (`1.500,00`); em branco quando omitido. */
    readonly openingBalance?: string;
    /** Marca o perfil como empresarial; o padrão do formulário é pessoal. */
    readonly business?: boolean;
}

/**
 * Cria o perfil e a primeira conta pela tela de primeiro uso, como o usuário faz, e espera o
 * shell abrir. Os campos usam `fill`, que não espera o elemento ficar "estável", e os cliques
 * usam `dispatchEvent`: no container a janela fica fora da tela e o Chromium não desenha
 * quadros, então a espera do `click` nunca termina (mesmo motivo do teste de fumaça).
 *
 * @param page Janela do app, aberta num banco sem perfil.
 * @param answers Respostas do formulário.
 */
export async function completeFirstUse(page: Page, answers: FirstUseAnswers): Promise<void> {
    await expect(page.getByRole('heading', { name: 'Vamos começar' })).toBeVisible();
    await page.getByLabel('Nome do perfil').fill(answers.profileName);
    if (answers.business === true) {
        await page.getByRole('radio', { name: 'Empresarial' }).dispatchEvent('click');
    }
    await page.getByLabel('Nome', { exact: true }).fill(answers.accountName);
    await page.getByLabel('Saldo inicial').fill(answers.openingBalance ?? '');
    await page.getByRole('button', { name: 'Criar e começar' }).dispatchEvent('click');
    await expect(page.getByTestId('profile-switcher')).toContainText(answers.profileName);
}
