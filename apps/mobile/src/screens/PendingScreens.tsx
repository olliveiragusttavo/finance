import type { ReactNode } from 'react';
import { PendingScreen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';

/*
 * Telas ainda em branco (mobile-mvp-plan, Fase 6): cada uma já tem o cabeçalho, a faixa do mês e
 * o "+" que terá, para que a navegação inteira seja usável e testada desde já. A fase de cada
 * tela troca o export daqui pelo arquivo próprio.
 */

/** @return Ajustes (Fase 18). */
export function SettingsScreen(): ReactNode {
    return <PendingScreen header={<ScreenHeader title="Ajustes" back />} />;
}
