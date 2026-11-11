import type { ReactNode } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { useThemeColor } from '../theme/ThemeRoot.tsx';
import { AppText } from './AppText.tsx';

/**
 * Campo de texto do app, com rótulo, dica e erro. O erro aparece embaixo do campo, com a borda no token `danger`, e é lido junto com o rótulo pelo
 * leitor de tela, para quem não vê a cor saber o que corrigir.
 *
 * @param props.label Rótulo visível; também o nome acessível do campo.
 * @param props.error Mensagem do erro do campo, ou `null`/ausente quando está válido.
 * @param props.hint Texto de apoio sob o campo, quando não há erro.
 * @param props.inputProps Demais propriedades do `TextInput` (valor, teclado, ao mudar).
 * @return O campo.
 */
export function TextField({ label, error = null, hint, ...inputProps }: TextInputProps & { readonly label: string; readonly error?: string | null; readonly hint?: string }): ReactNode {
    const placeholder = useThemeColor('muted');
    const selection = useThemeColor('accent');
    const message = error ?? hint;
    return (
        <View className="gap-1">
            <AppText className="text-13 text-muted">{label}</AppText>
            <TextInput
                accessibilityLabel={error === null ? label : `${label}. ${error}`}
                placeholderTextColor={placeholder}
                selectionColor={selection}
                className={`min-h-11 rounded-10 border bg-bg px-3 py-2 font-sans text-15 text-ink ${error === null ? 'border-line' : 'border-danger'}`}
                {...inputProps}
            />
            {message !== undefined && <AppText className={`text-12 ${error === null ? 'text-muted' : 'text-danger'}`}>{message}</AppText>}
        </View>
    );
}
