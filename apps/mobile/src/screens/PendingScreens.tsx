import type { ReactNode } from 'react';
import { ModalHeader, PendingScreen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';

/*
 * Telas ainda em branco (mobile-mvp-plan, Fase 6): cada uma já tem o cabeçalho, a faixa do mês e
 * o "+" que terá, para que a navegação inteira seja usável e testada desde já. A fase de cada
 * tela troca o export daqui pelo arquivo próprio.
 */

/** @return Contas (Fase 12). */
export function AccountsScreen(): ReactNode {
    return <PendingScreen header={<ScreenHeader title="Contas" />} withMonth />;
}

/** @return Cartões (Fase 13). */
export function CardsScreen(): ReactNode {
    return <PendingScreen header={<ScreenHeader title="Cartões" />} withMonth />;
}

/** @return Metas (Fase 14). */
export function GoalsScreen(): ReactNode {
    return <PendingScreen header={<ScreenHeader title="Metas" back />} withMonth />;
}

/** @return Cadastros (Fase 15). */
export function RegistriesScreen(): ReactNode {
    return <PendingScreen header={<ScreenHeader title="Cadastros" back />} />;
}

/** @return Anotações (Fase 16). */
export function NotesScreen(): ReactNode {
    return <PendingScreen header={<ScreenHeader title="Anotações" back />} />;
}

/** @return Ajustes (Fase 18). */
export function SettingsScreen(): ReactNode {
    return <PendingScreen header={<ScreenHeader title="Ajustes" back />} />;
}

/** @return Lançamento (Fase 10), por cima das abas e sem a faixa do mês. */
export function NewTransactionScreen(): ReactNode {
    return <PendingScreen header={<ModalHeader title="Novo lançamento" />} />;
}
