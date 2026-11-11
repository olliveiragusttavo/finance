import { CoreClientProvider, createQueryClient, DirectCoreClient } from '@finance/client';
import { createCore, LocalDate, openDatabase, parseTimestamp, parseUuid, type Clock, type Core } from '@finance/core';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import type { DatabaseCopies } from '../../src/startup/databaseCopy.ts';
import type { MobileStartup } from '../../src/startup/openMobileCore.ts';
import { ThemeRoot } from '../../src/theme/ThemeRoot.tsx';

/** O núcleo de um teste de tela, sobre SQLite em memória. */
export interface TestCore {
    readonly core: Core;
    readonly database: BetterSqliteDatabase;
}

/**
 * Monta o núcleo real sobre `better-sqlite3` em memória, com relógio fixo e ids sequenciais.
 * Testar a tela contra o núcleo de verdade, e não um mock, pega o que um mock esconderia: a
 * rota que devolve outro formato, a validação que recusa o que o formulário manda.
 *
 * @param today "Hoje" do teste.
 * @return O núcleo e a conexão.
 */
export function testCore(today = '2026-03-15'): TestCore {
    const clock: Clock = { now: () => parseTimestamp(`${today} 12:00:00`), today: () => LocalDate.parse(today) };
    let next = 0;
    const database = BetterSqliteDatabase.open(':memory:');
    openDatabase(database, { backups: null, clock });
    const core = createCore({
        database,
        clock,
        ids: { random: () => parseUuid(`00000000-0000-4000-8000-${(++next).toString(16).padStart(12, '0')}`) },
        onUnexpectedError: (error) => {
            throw error;
        },
    });
    return { core, database };
}

/**
 * @param core Núcleo do teste.
 * @param copies Dublê da cópia do banco, para os testes de Ajustes; `null` nos outros.
 * @return Uma abertura pronta sobre esse núcleo, para o `StartupGate` nos testes. O agendador é o
 * imediato: no Jest não há frame a esperar.
 */
export function readyStartup(core: Core, copies: DatabaseCopies | null = null): MobileStartup {
    return {
        status: { kind: 'ready', schemaVersion: 1 },
        client: new DirectCoreClient(core),
        close: () => undefined,
        restore: () => ({ ok: false, reason: 'not-blocked' }),
        copies,
    };
}

/**
 * @return O cache de consultas do app, sem coleta agendada: o timer de 5 minutos da coleta
 * seguraria o Jest depois do último teste.
 */
export function testQueryClient(): QueryClient {
    const queryClient = createQueryClient();
    queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity } });
    return queryClient;
}

/**
 * Renderiza uma tela com o que a raiz do app daria a ela — tema, núcleo e cache de consultas —
 * sem passar pela abertura do banco.
 *
 * @param ui Tela a renderizar.
 * @param core Núcleo do teste; um novo, vazio, quando omitido.
 * @return O núcleo, para o teste conferir o que a tela gravou; as consultas vêm do `screen`.
 */
export async function renderWithCore(ui: ReactElement, core: Core = testCore().core): Promise<Core> {
    const client = new DirectCoreClient(core);
    const queryClient = testQueryClient();
    await render(
        <ThemeRoot preference="light">
            <CoreClientProvider client={client}>
                <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
            </CoreClientProvider>
        </ThemeRoot>,
    );
    return core;
}
