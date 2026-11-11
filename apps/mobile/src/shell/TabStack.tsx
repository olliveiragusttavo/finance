import { Stack } from 'expo-router';
import type { ReactNode } from 'react';

/**
 * Pilha de uma aba (mobile-mvp-plan §2, "Navegação"): cada aba guarda as próprias telas
 * abertas, e o "voltar" do Android desempilha a aba aberta antes de trocar de aba. Sem o
 * cabeçalho do roteador, porque cada tela desenha o `ScreenHeader` dos mockups.
 *
 * @return O navegador da pilha.
 */
export function TabStack(): ReactNode {
    return <Stack screenOptions={{ headerShown: false }} />;
}
