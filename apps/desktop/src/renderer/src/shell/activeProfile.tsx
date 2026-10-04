import { invalidateAllCoreQueries, useProfiles } from '@finance/client';
import type { ProfileResponse } from '@finance/core';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { ErrorState, LoadingState } from '@/components/states';
import { useDevicePreferences } from '@/lib/devicePreferences';
import { pickActiveProfile } from './pickActiveProfile.ts';

/** O perfil em uso e os demais, para o seletor. */
interface ActiveProfileValue {
    readonly profile: ProfileResponse;
    readonly profiles: readonly ProfileResponse[];
    /**
     * @param profileId Perfil a abrir; precisa estar em `profiles`.
     */
    readonly switchTo: (profileId: string) => void;
}

const ActiveProfileContext = createContext<ActiveProfileValue | null>(null);

/**
 * Carrega os perfis e decide o perfil ativo para tudo o que está abaixo. Sem perfil, o shell
 * não tem o que mostrar — toda rota do núcleo pede um `profileId` —, então a árvore só é
 * montada quando há um; até lá, `whenEmpty` ocupa a janela (o primeiro uso, na Fase 5).
 * A tela de erro só substitui a árvore quando ainda não há perfis carregados: uma falha ao
 * recarregar mantém o shell montado com os perfis em cache.
 *
 * @param props.whenEmpty Tela do banco sem perfil.
 * @param props.children O app, que só é montado com um perfil ativo.
 * @return O provedor do perfil ativo, ou o estado de carregamento, de erro ou de banco vazio.
 */
export function ActiveProfileProvider({ whenEmpty, children }: { readonly whenEmpty: ReactNode; readonly children: ReactNode }): ReactNode {
    const query = useProfiles({});
    const { preferences, update } = useDevicePreferences();
    const queryClient = useQueryClient();
    const profiles = query.data;
    const profile = profiles === undefined ? null : pickActiveProfile(profiles, preferences.lastProfileId);

    // Regra de interface (Fase 4): trocar o perfil invalida todo o cache. As consultas já são
    // chaveadas pelo perfil, mas as de perfis e saldos globais não; recarregar tudo garante
    // que nada do perfil anterior fique na tela.
    const switchTo = useCallback((profileId: string): void => {
        update({ lastProfileId: profileId });
        void invalidateAllCoreQueries(queryClient);
    }, [update, queryClient]);

    const value = useMemo(
        () => (profile === null || profiles === undefined ? null : { profile, profiles, switchTo }),
        [profile, profiles, switchTo],
    );

    if (query.isPending) {
        return (
            <div className="p-8">
                <LoadingState label="Abrindo os perfis…" />
            </div>
        );
    }
    // Só sem dados: no TanStack Query v5, `isError` segue verdadeiro quando uma busca em
    // segundo plano falha com perfis já em cache (troca de perfil, foco da janela), e trocar
    // a árvore pela tela de erro aí desmontaria o shell e perderia o estado das telas.
    if (query.isError && profiles === undefined) {
        return (
            <div className="p-8">
                <ErrorState
                    error={query.error}
                    onRetry={() => {
                        void query.refetch();
                    }}
                />
            </div>
        );
    }
    if (value === null) {
        return whenEmpty;
    }
    return <ActiveProfileContext value={value}>{children}</ActiveProfileContext>;
}

/**
 * @return O perfil ativo, os perfis e a troca de perfil.
 * @throws {Error} Fora do `ActiveProfileProvider`, um erro de montagem do app.
 */
export function useActiveProfile(): ActiveProfileValue {
    const value = useContext(ActiveProfileContext);
    if (value === null) {
        throw new Error('useActiveProfile precisa de um ActiveProfileProvider acima na árvore');
    }
    return value;
}
