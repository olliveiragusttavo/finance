import { currentPeriod, shiftPeriod } from '@finance/client';
import { useCallback } from 'react';
import { useDevicePreferences } from '../preferences/devicePreferences.tsx';

/** O mês de referência e as ações da faixa do mês. */
export interface ReferenceMonth {
    /** Mês aberto, `YYYY-MM`: a entrada `period` de toda rota por período. */
    readonly period: string;
    /** Se o mês aberto é o corrente; decide se "Voltar ao mês atual" aparece. */
    readonly isCurrent: boolean;
    /**
     * @param period Mês `YYYY-MM` a abrir, vindo de outra tela (a fatura de outro mês).
     */
    readonly goTo: (period: string) => void;
    /** Mês anterior: botão `‹`. */
    readonly previous: () => void;
    /** Mês seguinte: botão `›`. */
    readonly next: () => void;
    /** "Voltar ao mês atual". */
    readonly goToCurrent: () => void;
}

/**
 * Mês de referência global (decisão de interface 2 dos mockups). No celular é estado do shell,
 * guardado nas preferências do aparelho (`lastPeriod`), e não parâmetro de rota como no desktop
 * (mobile-mvp-plan §2): não há URL a preservar, e as pilhas por aba perderiam o parâmetro ao
 * trocar de aba. Assim, o mês escolhido numa aba vale em todas, e o app reabre nele.
 *
 * @param now Relógio do aparelho; trocado nos testes.
 * @return O mês aberto e as ações de trocá-lo.
 */
export function useReferenceMonth(now: () => Date = () => new Date()): ReferenceMonth {
    const { preferences, update } = useDevicePreferences();
    const today = currentPeriod(now());
    const period = preferences.lastPeriod ?? today;

    const goTo = useCallback((target: string): void => {
        update({ lastPeriod: target });
    }, [update]);

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
