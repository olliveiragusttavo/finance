import { describeError, useProfiles } from '@finance/client';
import type { ReactNode } from 'react';

/**
 * Tela provisória da raiz, até o shell (Fase 4) e o primeiro uso (Fase 5) existirem: prova
 * o caminho inteiro — React, TanStack Query, `CoreClient` pelo `MessagePort` até o SQLite do
 * `utilityProcess` — e é o que o teste de fumaça lê.
 *
 * @return A lista de perfis, ou o estado de carregamento e de erro.
 */
export function HomeScreen(): ReactNode {
    const profiles = useProfiles({});
    return (
        <main className="flex flex-col gap-4 p-8">
            <h1 className="text-24 font-semibold">Finanças</h1>
            {profiles.isPending && <p className="text-muted">Carregando…</p>}
            {profiles.error !== null && <p className="text-danger">{describeError(profiles.error.error).message}</p>}
            {profiles.data !== undefined && (
                <ul data-testid="profiles" className="flex flex-col gap-1">
                    {profiles.data.length === 0 && <li className="text-muted">Nenhum perfil cadastrado.</li>}
                    {profiles.data.map((profile) => (
                        <li key={profile.id}>
                            {profile.name} <span className="text-muted">· {profile.currency}</span>
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}
