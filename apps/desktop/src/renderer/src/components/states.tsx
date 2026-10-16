import { describeError, type CoreCallError } from '@finance/client';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/*
 * Estados genéricos das telas (desktop-mvp-plan Fase 4): carregando, erro e vazio. Ficam num
 * lugar só para que toda tela fale do mesmo jeito quando não tem o que mostrar, e para que o
 * erro sempre traga o código — é o que o usuário copia num relato de problema.
 */

/**
 * Bloco cinza que ocupa o lugar do conteúdo enquanto ele carrega. Esqueleto, e não um
 * "Carregando…" solto, para que a tela não pule de altura quando os dados chegam.
 *
 * @param props.className Tamanho e forma do bloco, que imitam o conteúdo que virá.
 * @return O bloco animado, escondido dos leitores de tela (quem anuncia é o `LoadingState`).
 */
export function Skeleton({ className }: { readonly className?: string }): ReactNode {
    return <div aria-hidden="true" className={cn('animate-pulse rounded-6 bg-track', className)} />;
}

/**
 * Esqueleto genérico de uma tela: título, uma linha de indicadores e um bloco de conteúdo,
 * a forma comum das telas dos mockups. As telas com forma própria montam o seu com `Skeleton`.
 *
 * @param props.label O que está carregando, para o leitor de tela.
 * @return O esqueleto marcado como ocupado.
 */
export function LoadingState({ label = 'Carregando…' }: { readonly label?: string }): ReactNode {
    return (
        <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-5">
            <Skeleton className="h-7 w-56" />
            <div className="grid grid-cols-4 gap-4">
                <Skeleton className="h-22" />
                <Skeleton className="h-22" />
                <Skeleton className="h-22" />
                <Skeleton className="h-22" />
            </div>
            <Skeleton className="h-64" />
        </div>
    );
}

/**
 * Erro de uma chamada ao núcleo, com a mensagem em pt-BR do `describeError` e o código. O
 * erro `INTERNAL` nunca chega aqui: o `FailFastCoreClient` já trocou o app pela tela de erro.
 *
 * @param props.error Erro da consulta.
 * @param props.onRetry Tenta de novo; omitido quando a tela não tem o que repetir.
 * @return O aviso de erro, anunciado ao leitor de tela.
 */
export function ErrorState({ error, onRetry }: { readonly error: CoreCallError; readonly onRetry?: () => void }): ReactNode {
    return (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-10 border border-line bg-surface p-5">
            <p className="font-medium text-danger">Não foi possível carregar.</p>
            <p className="text-ink2">{describeError(error.error).message}</p>
            <p className="text-12 text-muted">
                Código: <code>{error.code}</code>
            </p>
            {onRetry !== undefined && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                    Tentar de novo
                </Button>
            )}
        </div>
    );
}

/**
 * Aviso de que não há nada a mostrar, com a explicação e, quando houver, o próximo passo. É o
 * que diferencia "não há lançamentos neste mês" de uma tela quebrada.
 *
 * @param props.title O que está vazio.
 * @param props.description Por que está vazio ou o que fazer.
 * @param props.action Botão ou link do próximo passo.
 * @return O aviso centralizado na área de conteúdo.
 */
export function EmptyState({ title, description, action }: { readonly title: string; readonly description?: string; readonly action?: ReactNode }): ReactNode {
    return (
        <div className="flex flex-col items-center gap-2 rounded-10 border border-dashed border-line bg-surface2 px-6 py-12 text-center">
            <p className="font-medium text-ink">{title}</p>
            {description !== undefined && <p className="max-w-120 text-13 text-muted">{description}</p>}
            {action !== undefined && <div className="mt-2">{action}</div>}
        </div>
    );
}

/**
 * Escolhe entre carregando, erro e conteúdo para uma consulta do núcleo, para que cada tela
 * não repita a mesma escada de `if` e nenhuma esqueça um dos estados.
 *
 * @param props.query Consulta de um hook do `client`.
 * @param props.loading Esqueleto próprio da tela; o genérico quando omitido.
 * @param props.children Desenha os dados quando eles chegam.
 * @return O estado da consulta.
 */
export function QueryState<T>({ query, loading, children }: {
    readonly query: UseQueryResult<T, CoreCallError>;
    readonly loading?: ReactNode;
    readonly children: (data: T) => ReactNode;
}): ReactNode {
    if (query.isPending) {
        return loading ?? <LoadingState />;
    }
    if (query.isError) {
        return (
            <ErrorState
                error={query.error}
                onRetry={() => {
                    void query.refetch();
                }}
            />
        );
    }
    return children(query.data);
}
