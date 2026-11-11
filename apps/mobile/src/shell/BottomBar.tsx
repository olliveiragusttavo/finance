import type { BottomTabBarProps } from 'expo-router/tabs';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../ui/AppText.tsx';
import { Icon, type IconName } from '../ui/Icon.tsx';

/** Nome de cada aba no roteador (pasta em `app/(tabs)`). */
export type TabName = 'home' | 'transactions' | 'accounts' | 'cards' | 'more';

/**
 * As abas da barra inferior, na ordem da decisão de interface 12 dos mockups: Início ·
 * Transações · Contas · Cartões · Mais.
 */
export const TABS: readonly { readonly name: TabName; readonly label: string; readonly icon: IconName }[] = [
    { name: 'home', label: 'Início', icon: 'home' },
    { name: 'transactions', label: 'Transações', icon: 'transactions' },
    { name: 'accounts', label: 'Contas', icon: 'accounts' },
    { name: 'cards', label: 'Cartões', icon: 'cards' },
    { name: 'more', label: 'Mais', icon: 'more' },
];

/**
 * Barra inferior (`.tab` dos mockups), própria em vez da padrão do roteador para ter o desenho
 * do mockup com os tokens. O toque emite o `tabPress` como a barra padrão: assim, tocar na aba já
 * aberta faz a pilha dela voltar ao topo, o comportamento que o Android e o iOS ensinam. A aba
 * aberta é anunciada como selecionada, porque a cor sozinha não basta.
 *
 * @param props Estado e navegação das abas, dados pelo roteador.
 * @return A barra.
 */
export function BottomBar({ state, emitter, navigateToTab }: BottomTabBarProps): ReactNode {
    const insets = useSafeAreaInsets();
    return (
        <View accessibilityRole="tabbar" style={{ paddingBottom: insets.bottom }} className="flex-row border-t border-line bg-surface">
            {state.routes.map((route, index) => {
                const tab = TABS.find((candidate) => candidate.name === route.name);
                if (tab === undefined) {
                    return null;
                }
                const focused = state.index === index;
                return (
                    <Pressable
                        key={route.key}
                        accessibilityRole="tab"
                        accessibilityLabel={tab.label}
                        accessibilityState={{ selected: focused }}
                        onPress={() => {
                            const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                            if (!focused && !event.defaultPrevented) {
                                navigateToTab(route.key);
                            }
                        }}
                        className="h-18 flex-1 items-center justify-center gap-1 active:bg-line2"
                    >
                        <Icon name={tab.icon} size={22} tone={focused ? 'accent' : 'muted'} />
                        <AppText className={`text-11 ${focused ? 'font-semibold text-accent' : 'text-muted'}`}>{tab.label}</AppText>
                    </Pressable>
                );
            })}
        </View>
    );
}
