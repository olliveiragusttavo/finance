import { Stack } from 'expo-router';
import type { ReactNode } from 'react';

/**
 * A pilha raiz do app: as abas e, por cima delas, o lançamento, que abre sem a barra inferior e
 * sem a faixa do mês (decisão de interface 2 dos mockups). Fora do `app/_layout.tsx` para os
 * testes montarem a mesma navegação sobre o núcleo em memória.
 *
 * @return O navegador raiz.
 */
export function AppNavigation(): ReactNode {
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="new-transaction" options={{ presentation: 'modal' }} />
        </Stack>
    );
}
