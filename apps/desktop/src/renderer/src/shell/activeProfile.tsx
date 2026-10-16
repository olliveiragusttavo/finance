import { invalidateAllCoreQueries, useProfiles } from '@finance/client';
import type { ProfileResponse } from '@finance/core';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ErrorState, LoadingState } from '@/components/states';
import { useDevicePreferences } from '@/lib/devicePreferences';
import { pickActiveProfile } from './pickActiveProfile.ts';

/**
 * Pergunta à tela aberta, antes de trocar o perfil, se ela pode ser deixada. A troca de perfil
 * não é navegação — o roteador não a vê —, mas tira da tela tudo o que é do perfil anterior,
 * inclusive o que o usuário editava sem salvar.
 *
 * @return Promessa resolvida com `true` para seguir com a troca, ou `false` para ficar.
 */
export type ProfileSwitchGuard = () => Promise<boolean>;

/** O perfil em uso e os demais, para o seletor. */
interface ActiveProfileValue {
    readonly profile: ProfileResponse;
    readonly profiles: readonly ProfileResponse[];
    /**
     * @param profileId Perfil a abrir; precisa estar em `profiles`.
     */
    readonly switchTo: (profileId: string) => void;
    /**
     * @param guard Pergunta feita antes de cada troca de perfil, ou `null` para trocar direto.
     */
    readonly guardSwitch: (guard: ProfileSwitchGuard | null) => void;
}

const ActiveProfileContext = createContext<ActiveProfileValue | null>(null);

/**
 * Carrega os perfis e decide o perfil ativo para tudo o que está abaixo. Sem perfil, o shell
 * não tem o que mostrar — toda rota do núcleo pede um `profileId` —, então a árvore só é
 * montada quando há um; até lá, `whenEmpty` ocupa a janela (o primeiro uso).
 * A tela de erro só substitui a árvore quando ainda não há perfis carregados: uma falha ao
 * recarregar mantém o shell montado com os perfis em cache.
 *
 * @param props.whenEmpty Tela do banco sem perfil; o primeiro uso, que sai daqui sozinho ao
 * criar o perfil, porque a criação invalida a lista de perfis.
 * @param props.children O app, que só é montado com um perfil ativo.
 * @return O provedor do perfil ativo, ou o estado de carregamento, de erro ou de banco vazio.
 */
export function ActiveProfileProvider({ whenEmpty, children }: { readonly whenEmpty: ReactNode; readonly children: ReactNode }): ReactNode {
    const query = useProfiles({});
    const { preferences, update } = useDevicePreferences();
    const queryClient = useQueryClient();
    const profiles = query.data;
    const profile = profiles === undefined ? null : pickActiveProfile(profiles, preferences.lastProfileId);
    // Em ref, e não em estado: registrar a guarda não muda nada na tela, e um estado faria todo
    // consumidor do perfil renderizar de novo a cada alteração não salva.
    const guardRef = useRef<ProfileSwitchGuard | null>(null);

    // Regra de interface (Fase 4): trocar o perfil invalida todo o cache. As consultas já são
    // chaveadas pelo perfil, mas as de perfis e saldos globais não; recarregar tudo garante
    // que nada do perfil anterior fique na tela. Antes, a tela aberta pode recusar a troca.
    const switchTo = useCallback((profileId: string): void => {
        const guard = guardRef.current;
        /**
         * Troca só depois da resposta da guarda, para que a tela aberta salve ou descarte o que
         * está editando enquanto o perfil dela ainda é o ativo.
         *
         * @return Promessa resolvida quando o perfil foi trocado ou a troca, recusada.
         */
        const run = async (): Promise<void> => {
            if (guard !== null && !(await guard())) {
                return;
            }
            update({ lastProfileId: profileId });
            await invalidateAllCoreQueries(queryClient);
        };
        void run();
    }, [update, queryClient]);

    const guardSwitch = useCallback((guard: ProfileSwitchGuard | null): void => {
        guardRef.current = guard;
    }, []);

    const value = useMemo(
        () => (profile === null || profiles === undefined ? null : { profile, profiles, switchTo, guardSwitch }),
        [profile, profiles, switchTo, guardSwitch],
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

/**
 * Faz a troca de perfil passar pela tela enquanto ela estiver montada, para que a tela possa
 * perguntar o que fazer com uma alteração não salva antes de o perfil mudar.
 *
 * @param guard Pergunta feita antes da troca, ou `null` quando a tela pode ser deixada sem
 * perguntar; ao desmontar, a guarda é retirada.
 */
export function useProfileSwitchGuard(guard: ProfileSwitchGuard | null): void {
    const { guardSwitch } = useActiveProfile();
    useEffect(() => {
        guardSwitch(guard);
        return () => {
            guardSwitch(null);
        };
    }, [guardSwitch, guard]);
}
