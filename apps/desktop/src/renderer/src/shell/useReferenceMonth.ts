import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useDevicePreferences } from '@/lib/devicePreferences';
import { currentPeriod, parseShellSearch, resolveReferenceMonth, shiftPeriod, type ShellSearch } from './referenceMonth.ts';

/** O mês de referência e as ações da barra superior. */
export interface ReferenceMonth {
    /** Mês aberto, `YYYY-MM`: a entrada `period` de toda rota por período. */
    readonly period: string;
    /** Se o mês aberto é o corrente; decide se "Voltar ao mês atual" aparece. */
    readonly isCurrent: boolean;
    /**
     * @param period Mês `YYYY-MM` a abrir, vindo de um link de outra tela.
     */
    readonly goTo: (period: string) => void;
    /** Mês anterior: botão `‹` e atalho `[`. */
    readonly previous: () => void;
    /** Mês seguinte: botão `›` e atalho `]`. */
    readonly next: () => void;
    /** "Voltar ao mês atual". */
    readonly goToCurrent: () => void;
}

/**
 * Mês de referência global (desktop-mvp-plan Fase 4). Trocar o mês troca o *search param* da
 * tela atual, sem sair dela, e grava o mês como o último aberto no aparelho, para que o app
 * reabra onde o usuário parou.
 *
 * @return O mês aberto e as ações de trocá-lo.
 */
export function useReferenceMonth(): ReferenceMonth {
    // Lida pelo `parseShellSearch`, e não pelo tipo da rota: o shell é importado pelo próprio
    // roteador, e a referência circular faria o tipo registrado da busca virar `any`.
    const search = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => parseShellSearch(raw) });
    const navigate = useNavigate();
    const { preferences, update } = useDevicePreferences();
    const today = currentPeriod(new Date());
    const period = resolveReferenceMonth(search, preferences.lastPeriod, today);

    const goTo = useCallback((target: string): void => {
        void navigate({ to: '.', search: (previous: ShellSearch) => ({ ...previous, period: target }) });
        update({ lastPeriod: target });
    }, [navigate, update]);

    return {
        period,
        isCurrent: period === today,
        goTo,
        previous: () => {
            goTo(shiftPeriod(period, -1));
        },
        next: () => {
            goTo(shiftPeriod(period, 1));
        },
        goToCurrent: () => {
            goTo(today);
        },
    };
}
