import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { AppText } from './AppText.tsx';

/** Peso visual do botão, pelo papel que ele tem na tela. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

/** Classes de cada variante: fundo e borda do botão, cor do rótulo. */
const VARIANTS: Readonly<Record<ButtonVariant, { readonly box: string; readonly label: string }>> = {
    primary: { box: 'bg-accent active:opacity-80', label: 'text-on-accent' },
    secondary: { box: 'border border-line bg-surface active:bg-line2', label: 'text-ink' },
    danger: { box: 'border border-danger bg-surface active:bg-line2', label: 'text-danger' },
    ghost: { box: 'active:bg-line2', label: 'text-accent' },
};

/**
 * Botão do app, com o alvo de toque mínimo de 44 px (decisão de interface 12 dos mockups). Em
 * andamento, mostra o indicador e não aceita outro toque: no celular o núcleo roda na mesma
 * thread, e um toque duplo em "Salvar" gravaria duas vezes antes de a tela mudar.
 *
 * @param props.label Rótulo; também o nome acessível.
 * @param props.onPress Ação do toque.
 * @param props.variant Peso visual; `primary` por padrão.
 * @param props.disabled Quando a ação ainda não pode ser feita (formulário incompleto).
 * @param props.busy Ação em andamento.
 * @param props.className Classes de posição do chamador (largura, margem).
 * @return O botão.
 */
export function Button(props: {
    readonly label: string;
    readonly onPress: () => void;
    readonly variant?: ButtonVariant;
    readonly disabled?: boolean;
    readonly busy?: boolean;
    readonly className?: string;
}): ReactNode {
    const { label, onPress, variant = 'primary', disabled = false, busy = false, className = '' } = props;
    const style = VARIANTS[variant];
    const inactive = disabled || busy;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: inactive, busy }}
            disabled={inactive}
            onPress={onPress}
            className={`min-h-11 flex-row items-center justify-center gap-2 rounded-10 px-4 ${style.box} ${disabled ? 'opacity-50' : ''} ${className}`}
        >
            {busy && (
                <View>
                    <ActivityIndicator size="small" className={style.label} />
                </View>
            )}
            <AppText className={`font-semibold ${style.label}`}>{label}</AppText>
        </Pressable>
    );
}
