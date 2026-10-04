import type { ReactNode } from 'react';

/**
 * Tela provisória do banco sem perfil, até o primeiro uso existir (Fase 5): sem perfil o shell
 * não abre, porque toda rota do núcleo pede um. Fica fora do shell, como o primeiro uso vai
 * ficar, e é o que o teste de fumaça lê antes de criar o perfil.
 *
 * @return O aviso de que não há perfil.
 */
export function NoProfileScreen(): ReactNode {
    return (
        <main className="flex flex-col gap-4 p-8">
            <h1 className="text-24 font-semibold">Finanças</h1>
            <p data-testid="no-profile" className="text-muted">
                Nenhum perfil cadastrado.
            </p>
        </main>
    );
}
