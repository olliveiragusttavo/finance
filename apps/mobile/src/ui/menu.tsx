import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText } from './AppText.tsx';

/**
 * Linha de menu (`.it` dos mockups): 52 px de altura, rótulo e linha de apoio à esquerda,
 * contagem e "›" à direita. Compartilhada pelo menu Mais e pelo índice de Cadastros, que têm o
 * mesmo desenho nos mockups.
 *
 * @param props.label Rótulo.
 * @param props.detail Linha de apoio sob o rótulo.
 * @param props.trailing Texto à direita, antes do "›" (contagem, "Trocar perfil").
 * @param props.onPress Ação.
 * @param props.first Se é a primeira linha do grupo, que não tem divisória em cima.
 * @return A linha.
 */
export function MenuRow(props: { readonly label: string; readonly detail?: string; readonly trailing?: string; readonly onPress: () => void; readonly first?: boolean }): ReactNode {
    const { label, detail, trailing, onPress, first = false } = props;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={[label, detail, trailing].filter((part) => part !== undefined).join(', ')}
            onPress={onPress}
            className={`min-h-13 flex-row items-center justify-between gap-2.5 bg-surface px-3.5 py-3 active:bg-line2 ${first ? '' : 'border-t border-line2'}`}
        >
            <View className="min-w-0 flex-1">
                <AppText numberOfLines={1}>{label}</AppText>
                {detail !== undefined && <AppText className="text-12 text-muted">{detail}</AppText>}
            </View>
            <View className="flex-row items-center gap-1.5">
                {trailing !== undefined && <AppText className="text-12 text-muted">{trailing}</AppText>}
                <AppText className="text-muted">›</AppText>
            </View>
        </Pressable>
    );
}

/**
 * Grupo de linhas de menu com a borda e o raio dos mockups (`.list`).
 *
 * @param props.children As linhas.
 * @return O grupo.
 */
export function MenuGroup({ children }: { readonly children: ReactNode }): ReactNode {
    return <View className="overflow-hidden rounded-12 border border-line">{children}</View>;
}
