import type { DatabaseImportResult } from '@finance/client';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import type { DatabaseCopies } from '../src/startup/databaseCopy.ts';
import { renderApp } from './support/renderApp.tsx';
import { testCore } from './support/renderWithCore.tsx';
import { ok, SCENARIO_PERIOD, SCENARIO_TODAY } from './support/scenario.ts';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/** Folha de compartilhamento trocada: registra o arquivo e as opções. */
const mockShareAsync = jest.fn<Promise<void>, [string, unknown]>(() => Promise.resolve());
/** Seletor de documentos trocado: escolhe sempre a mesma cópia, já no cache. */
const mockGetDocumentAsync = jest.fn<Promise<{ readonly canceled: false; readonly assets: readonly { readonly uri: string; readonly name: string }[] }>, [unknown]>(() =>
    Promise.resolve({ canceled: false, assets: [{ uri: 'file:///cache/financas.sqlite', name: 'financas.sqlite' }] }),
);

jest.mock('expo-sharing', () => ({
    isAvailableAsync: () => Promise.resolve(true),
    shareAsync: (uri: string, options: unknown) => mockShareAsync(uri, options),
}));
jest.mock('expo-document-picker', () => ({
    getDocumentAsync: (options: unknown) => mockGetDocumentAsync(options),
}));

/**
 * Dublê da cópia do banco: registra o que a tela pediu e responde o que o teste escolher.
 *
 * @param options.exportOk Se a exportação grava a cópia.
 * @param options.importResult Resultado da importação, e se ela fechou o banco.
 * @param options.logUri Log do app, ou `null` sem log.
 * @return O dublê e as chamadas registradas.
 */
function fakeCopies(options: { readonly exportOk?: boolean; readonly importResult?: { readonly result: DatabaseImportResult; readonly closed: boolean }; readonly logUri?: string | null } = {}): {
    readonly copies: DatabaseCopies;
    readonly discarded: string[];
    readonly imported: string[];
} {
    const discarded: string[] = [];
    const imported: string[] = [];
    const copies: DatabaseCopies = {
        exportCopy: () => ((options.exportOk ?? true) ? { ok: true, uri: 'file:///cache/financas-20261015.sqlite', fileName: 'financas-20261015.sqlite' } : { ok: false, reason: 'write-failed' }),
        discard: (uri) => {
            discarded.push(uri);
        },
        importCopy: (uri) => {
            imported.push(uri);
            return options.importResult ?? { result: { ok: true, file: 'financas.sqlite', previousCopy: 'antes-da-importacao-20261015-120000.sqlite' }, closed: true };
        },
        logUri: () => (options.logUri === undefined ? 'file:///docs/logs/core.log' : options.logUri),
    };
    return { copies, discarded, imported };
}

/**
 * Abre o app num perfil e entra em Ajustes pelo menu Mais.
 *
 * @param copies Dublê da cópia do banco.
 * @return O app aberto em Ajustes.
 */
async function openSettings(copies: DatabaseCopies): Promise<Awaited<ReturnType<typeof renderApp>>> {
    const { core } = testCore(SCENARIO_TODAY);
    const { profile } = await ok(core, 'onboarding.start', { profile: { name: 'Pessoal', type: 'personal', currency: 'BRL' }, account: { name: 'Nubank', type: 'checking', openingBalance: 0 }, suggestedCategories: false });
    const app = await renderApp(core, { preferences: { lastPeriod: SCENARIO_PERIOD, lastProfileId: profile.id }, initialUrl: '/more', copies });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ajustes' }));
    await screen.findByText('Versão do banco de dados');
    return app;
}

/**
 * @return A última folha aberta.
 * @throws {Error} Quando nenhuma folha está aberta.
 */
function lastSheet(): ReturnType<typeof screen.getByTestId> {
    const sheet = screen.getAllByTestId('bottom-sheet').at(-1);
    if (sheet === undefined) {
        throw new Error('nenhuma folha aberta');
    }
    return sheet;
}

beforeEach(() => {
    mockShareAsync.mockClear();
    mockGetDocumentAsync.mockClear();
});

describe('Ajustes (mobile-mvp-plan, Fase 18)', () => {
    it('troca o tema e mostra a versão do banco', async () => {
        const app = await openSettings(fakeCopies().copies);

        expect(screen.getByText('v1')).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('radio', { name: 'Escuro' }));

        await waitFor(() => {
            expect(app.storedPreferences().theme).toBe('dark');
        });
    });

    it('exporta a cópia pela folha de compartilhamento, apaga o temporário e guarda a data', async () => {
        const fake = fakeCopies();
        const app = await openSettings(fake.copies);

        await fireEvent.press(screen.getByRole('button', { name: /^Exportar cópia do banco, / }));

        await waitFor(() => {
            expect(fake.discarded).toEqual(['file:///cache/financas-20261015.sqlite']);
        });
        expect(mockShareAsync).toHaveBeenCalledWith('file:///cache/financas-20261015.sqlite', expect.objectContaining({ mimeType: 'application/x-sqlite3' }));
        expect(app.storedPreferences().lastExportAt).not.toBeNull();
        expect(await screen.findByText(/^Não há backup em nuvem\. Última cópia: /)).toBeOnTheScreen();
    });

    it('a cópia que não grava diz o que fazer e não abre a folha', async () => {
        await openSettings(fakeCopies({ exportOk: false }).copies);

        await fireEvent.press(screen.getByRole('button', { name: /^Exportar cópia do banco, / }));

        expect(await screen.findByText('Não foi possível gravar a cópia. Confira se há espaço no aparelho e tente de novo.')).toBeOnTheScreen();
        expect(mockShareAsync).not.toHaveBeenCalled();
    });

    it('Regra de negócio (Cópia do banco): avisa que substitui tudo antes de abrir o seletor, e reabre com o resultado', async () => {
        const fake = fakeCopies();
        await openSettings(fake.copies);

        await fireEvent.press(screen.getByRole('button', { name: /^Importar cópia do banco, / }));
        expect(within(lastSheet()).getByText(/^A cópia substitui todos os dados deste celular/)).toBeOnTheScreen();
        expect(mockGetDocumentAsync).not.toHaveBeenCalled();
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Escolher a cópia' }));

        expect(await screen.findByText('Cópia financas.sqlite importada. O banco anterior foi guardado em antes-da-importacao-20261015-120000.sqlite.')).toBeOnTheScreen();
        expect(fake.imported).toEqual(['file:///cache/financas.sqlite']);
    });

    it('a cópia recusada não fecha o banco e diz por quê', async () => {
        await openSettings(fakeCopies({ importResult: { result: { ok: false, reason: 'newer-than-app' }, closed: false } }).copies);

        await fireEvent.press(screen.getByRole('button', { name: /^Importar cópia do banco, / }));
        await fireEvent.press(within(lastSheet()).getByRole('button', { name: 'Escolher a cópia' }));

        expect(await screen.findByText('A cópia é de uma versão mais nova do app. Nada foi alterado; atualize o app para importá-la.')).toBeOnTheScreen();
    });

    it('relatar problema compartilha o log, e sem log diz que não há o que enviar', async () => {
        await openSettings(fakeCopies().copies);
        await fireEvent.press(screen.getByRole('button', { name: /^Relatar problema, / }));
        await waitFor(() => {
            expect(mockShareAsync).toHaveBeenCalledWith('file:///docs/logs/core.log', expect.objectContaining({ mimeType: 'text/plain' }));
        });
    });

    it('sem log, relatar problema diz que não há o que enviar', async () => {
        await openSettings(fakeCopies({ logUri: null }).copies);
        await fireEvent.press(screen.getByRole('button', { name: /^Relatar problema, / }));
        expect(await screen.findByText('Ainda não há registro do app para enviar.')).toBeOnTheScreen();
        expect(mockShareAsync).not.toHaveBeenCalled();
    });
});
