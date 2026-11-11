import { invalidateAllCoreQueries, pickActiveProfile, useProfiles } from '@finance/client';
import type { ProfileResponse } from '@finance/core';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import { useDevicePreferences } from '../preferences/devicePreferences.tsx';
import { ErrorState, LoadingState } from '../ui/states.tsx';

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
 * Carrega os perfis e decide o perfil ativo para tudo o que está abaixo, como o shell do
 * desktop (desktop-mvp-plan Fase 4). Sem perfil o shell não abre — toda rota do núcleo pede um
 * `profileId` —, então `whenEmpty` ocupa a tela (o primeiro uso), e sai sozinho ao criar o
 * perfil, porque a criação invalida a lista. A tela de erro só substitui o app quando ainda não
 * há perfis carregados: uma falha ao recarregar mantém o shell com os perfis em cache.
 *
 * @param props.whenEmpty Tela do banco sem perfil.
 * @param props.children O app, montado só com um perfil ativo.
 * @return O provedor do perfil ativo, ou o estado de carregamento, de erro ou de banco vazio.
 */
export function ActiveProfileProvider({ whenEmpty, children }: { readonly whenEmpty: ReactNode; readonly children: ReactNode }): ReactNode {
    const query = useProfiles({});
    const { preferences, update } = useDevicePreferences();
    const queryClient = useQueryClient();
    const profiles = query.data;
    const profile = profiles === undefined ? null : pickActiveProfile(profiles, preferences.lastProfileId);

    // Regra de interface (desktop-mvp-plan Fase 4): trocar o perfil invalida todo o cache, para
    // nada do perfil anterior ficar na tela. O celular não tem a guarda de alteração não salva
    // do desktop: o seletor só existe em telas sem formulário (Início e Mais), e o lançamento
    // abre por cima delas.
    const switchTo = useCallback((profileId: string): void => {
        update({ lastProfileId: profileId });
        void invalidateAllCoreQueries(queryClient);
    }, [update, queryClient]);

    const value = useMemo(
        () => (profile === null || profiles === undefined ? null : { profile, profiles, switchTo }),
        [profile, profiles, switchTo],
    );

    if (query.isPending) {
        return <LoadingState label="Abrindo os perfis…" />;
    }
    if (query.isError && profiles === undefined) {
        return (
            <View className="flex-1 justify-center bg-bg p-4">
                <ErrorState
                    error={query.error}
                    onRetry={() => {
                        void query.refetch();
                    }}
                />
            </View>
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
