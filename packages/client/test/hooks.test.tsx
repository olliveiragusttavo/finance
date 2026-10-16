// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { CoreCallError, CoreClientProvider, createQueryClient, useCoreMutation, useInvoicesByCards, useStatement, useTransactions, type CoreClient } from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

/**
 * Envolve o hook com os provedores que a raiz do app monta.
 *
 * @param client Implementação do núcleo injetada.
 * @return O componente-invólucro do `renderHook`.
 */
function providers(client: CoreClient): (props: { readonly children: ReactNode }) => ReactNode {
    const queryClient = createQueryClient();
    return function Providers({ children }: { readonly children: ReactNode }): ReactNode {
        return (
            <QueryClientProvider client={queryClient}>
                <CoreClientProvider client={client}>{children}</CoreClientProvider>
            </QueryClientProvider>
        );
    };
}

describe('hooks de dados (desktop-mvp-plan Fase 3.2)', () => {
    it('a escrita invalida pelo mapa e o extrato aberto se refaz sem recarregar', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const { result } = renderHook(() => ({
            statement: useStatement({ accountId: s.checkingId, period: '2026-10' }),
            setPaid: useCoreMutation('transactions.setPaid'),
        }), { wrapper: providers(world.client) });

        await waitFor(() => {
            expect(result.current.statement.data).toBeDefined();
        });
        const before = result.current.statement.data?.closing.consolidated.amount ?? 0;

        await act(() => result.current.setPaid.mutateAsync({ id: s.expenseId, paid: true }));

        await waitFor(() => {
            expect(result.current.statement.data?.closing.consolidated.amount).toBeCloseTo(before - 2300);
        });
    });

    it('falha do núcleo vira CoreCallError no estado da consulta, sem retentativa', async () => {
        const world = new ClientWorld();
        let calls = 0;
        const counting: CoreClient = {
            call: (route, input) => {
                calls++;
                return world.client.call(route, input);
            },
        };
        const { result } = renderHook(() => useTransactions({ profileId: 'não é um uuid', period: '2026-10' }), { wrapper: providers(counting) });

        await waitFor(() => {
            expect(result.current.error).toBeInstanceOf(CoreCallError);
        });
        expect(result.current.error?.code).toBe('VALIDATION_FAILED');
        expect(calls).toBe(1);
    });

    it('várias consultas da mesma rota também se refazem pelo mapa depois de uma escrita', async () => {
        const world = new ClientWorld();
        const s = await world.seed();
        const { result } = renderHook(() => ({
            invoices: useInvoicesByCards([{ creditCardId: s.creditCardId, from: '2026-09' }]),
            reopen: useCoreMutation('invoices.reopen'),
        }), { wrapper: providers(world.client) });

        await waitFor(() => {
            expect(result.current.invoices.invoices.find((invoice) => invoice.id === s.paidInvoiceId)?.status).toBe('paid');
        });

        await act(() => result.current.reopen.mutateAsync({ invoiceId: s.paidInvoiceId }));

        await waitFor(() => {
            expect(result.current.invoices.invoices.find((invoice) => invoice.id === s.paidInvoiceId)?.status).toBe('open');
        });
    });

    it('entrada nula deixa a consulta parada, sem chamar o núcleo', () => {
        const calls: string[] = [];
        const spy: CoreClient = {
            call: (route) => {
                calls.push(route);
                return Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: '', details: {} } });
            },
        };
        const { result } = renderHook(() => useTransactions(null), { wrapper: providers(spy) });
        expect(result.current.fetchStatus).toBe('idle');
        expect(calls).toEqual([]);
    });
});
