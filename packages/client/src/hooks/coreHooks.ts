import type { CoreInput, CoreOutput, CoreResult, CoreRoute } from '@finance/core';
import {
    QueryClient,
    skipToken,
    useMutation,
    useQueries,
    useQuery,
    useQueryClient,
    type UseMutationResult,
    type UseQueryOptions,
    type UseQueryResult,
} from '@tanstack/react-query';
import type { CoreClient } from '../core/CoreClient.ts';
import { CoreCallError } from '../errors/CoreCallError.ts';
import { invalidatedBy } from '../queries/invalidation.ts';
import { CORE_QUERY_ROOT, coreQueryKey, coreRouteKey, type ReadRoute, type WriteRoute } from '../queries/routes.ts';
import { useCoreClient } from './CoreClientContext.tsx';

/**
 * Cria o `QueryClient` com as regras do app. Erro do núcleo é determinístico — a mesma
 * entrada inválida falha igual na segunda tentativa —, então não há retentativa: repetir só
 * atrasaria a mensagem. Só falha inesperada de transporte (não `CoreCallError`) tenta de novo.
 *
 * @return O cliente de cache a entregar ao `QueryClientProvider`.
 */
export function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: (failures, error) => !(error instanceof CoreCallError) && failures < 2,
                // O dado só muda por escrita deste mesmo app, que invalida pelo mapa; refazer
                // a consulta ao focar a janela não traria nada novo.
                refetchOnWindowFocus: false,
            },
        },
    });
}

/**
 * Chama a rota e converte falha em exceção, que é como o TanStack Query reconhece erro.
 *
 * @param client Implementação do núcleo.
 * @param route Rota chamada.
 * @param input Entrada da rota.
 * @return Os dados da rota quando ela deu certo.
 * @throws {CoreCallError} Quando o núcleo devolveu `{ ok: false }`.
 */
export async function callOrThrow<R extends CoreRoute>(client: CoreClient, route: R, input: CoreInput<R>): Promise<CoreOutput<R>> {
    const result: CoreResult<CoreOutput<R>> = await client.call(route, input);
    if (!result.ok) {
        throw new CoreCallError(route, result.error);
    }
    return result.data;
}

/**
 * Consulta tipada de uma rota de leitura, com cache pela chave `['core', rota, entrada]`.
 *
 * @param route Rota de leitura.
 * @param input Entrada da rota, ou `null` enquanto ela ainda não pode ser montada (perfil
 * ainda não escolhido); `null` deixa a consulta parada em vez de chamar o núcleo com lixo.
 * @return O estado da consulta, com o erro já tipado como `CoreCallError`.
 */
export function useCoreQuery<R extends ReadRoute>(route: R, input: CoreInput<R> | null): UseQueryResult<CoreOutput<R>, CoreCallError> {
    const client = useCoreClient();
    return useQuery<CoreOutput<R>, CoreCallError>({
        queryKey: input === null ? [CORE_QUERY_ROOT, route, null] : coreQueryKey(route, input),
        queryFn: input === null ? skipToken : () => callOrThrow(client, route, input),
    });
}

/**
 * Várias consultas da mesma rota de leitura, uma por entrada, cada uma com a sua chave — a mesma
 * de `useCoreQuery`, então a invalidação por rota alcança todas. Existe para as telas que
 * precisam da mesma leitura para uma lista que só se conhece em tempo de execução (as faturas
 * de cada cartão com lançamentos no mês), onde um hook por item quebraria as regras dos hooks.
 *
 * @param route Rota de leitura.
 * @param inputs Uma entrada por consulta.
 * @param combine Junta os resultados num valor só. Precisa ser estável (definida fora do
 * componente): o TanStack Query só a reexecuta quando ela ou algum resultado muda, e então o
 * valor devolvido mantém a identidade entre renders — o que uma tabela derivada dele precisa.
 * @return O valor combinado.
 */
export function useCoreQueries<R extends ReadRoute, T>(route: R, inputs: readonly CoreInput<R>[], combine: (results: readonly UseQueryResult<CoreOutput<R>, CoreCallError>[]) => T): T {
    const client = useCoreClient();
    const queries = inputs.map(
        (input): UseQueryOptions<CoreOutput<R>, CoreCallError, CoreOutput<R>, ReturnType<typeof coreQueryKey<R>>> => ({
            queryKey: coreQueryKey(route, input),
            queryFn: () => callOrThrow(client, route, input),
        }),
    );
    return useQueries({ queries, combine });
}

/**
 * Mutação tipada de uma rota de escrita. Ao dar certo, invalida as leituras do mapa de
 * invalidação e só então resolve — quem espera o `mutateAsync` já encontra as consultas
 * marcadas como velhas, e os saldos da tela se refazem sem recarregar (desktop-mvp-plan Fase 9).
 *
 * @param route Rota de escrita.
 * @return O estado da mutação, com o erro já tipado como `CoreCallError`.
 */
export function useCoreMutation<W extends WriteRoute>(route: W): UseMutationResult<CoreOutput<W>, CoreCallError, CoreInput<W>> {
    const client = useCoreClient();
    const queryClient = useQueryClient();
    return useMutation<CoreOutput<W>, CoreCallError, CoreInput<W>>({
        mutationFn: (input) => callOrThrow(client, route, input),
        onSuccess: () => invalidateAfter(queryClient, route),
    });
}

/**
 * @param queryClient Cache do app.
 * @param route Escrita concluída.
 * @return Promessa resolvida quando as consultas ativas afetadas foram refeitas.
 */
export async function invalidateAfter(queryClient: QueryClient, route: WriteRoute): Promise<void> {
    await Promise.all(invalidatedBy(route).map((read) => queryClient.invalidateQueries({ queryKey: coreRouteKey(read) })));
}

/**
 * Invalida todo o cache do núcleo. Existe para a troca de perfil (desktop-mvp-plan Fase 4):
 * toda consulta é de um perfil, e o mapa de invalidação não se aplica a quem não escreveu nada.
 *
 * @param queryClient Cache do app.
 * @return Promessa resolvida quando as consultas ativas foram refeitas.
 */
export function invalidateAllCoreQueries(queryClient: QueryClient): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: [CORE_QUERY_ROOT] });
}
