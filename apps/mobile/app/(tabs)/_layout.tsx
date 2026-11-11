import { Tabs } from 'expo-router/tabs';
import type { ReactNode } from 'react';
import { BottomBar, TABS } from '../../src/shell/BottomBar.tsx';

/**
 * Abas da barra inferior (decisão de interface 12 dos mockups), cada uma com a própria pilha.
 * O "voltar" do Android na raiz de uma aba leva ao Início (`firstRoute`), e no Início sai do
 * app, como nos apps do sistema.
 *
 * @return O navegador das abas.
 */
export default function TabsLayout(): ReactNode {
    return (
        <Tabs tabBar={(props) => <BottomBar {...props} />} backBehavior="firstRoute" screenOptions={{ headerShown: false }}>
            {TABS.map((tab) => (
                <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
            ))}
        </Tabs>
    );
}
