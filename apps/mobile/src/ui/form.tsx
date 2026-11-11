import { useState, type ReactNode } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import type { FieldErrors, FieldValues, Path } from 'react-hook-form';
import { useThemeColor } from '../theme/ThemeRoot.tsx';
import { AppText } from './AppText.tsx';
import { OptionList, type SelectOption } from './Select.tsx';
import { Sheet } from './Sheet.tsx';

/*
 * Formulários no padrão dos mockups do celular (`MobilePrimeiroUso`, `MobileLancamento`): grupos
 * com borda (`.list`) e linhas com o rótulo à esquerda e o valor à direita (`.it`), o erro logo
 * abaixo da linha. Um padrão só para todo formulário do app, para que um campo novo não invente
 * outro desenho.
 */

/**
 * Converte as mensagens por campo, como os leitores de formulário do `client` as devolvem, no
 * formato do react-hook-form, que as associa aos campos — o mesmo do desktop.
 *
 * @param fields Todos os campos do formulário; percorrê-los mantém o tipo do campo, que
 * `Object.keys` perderia.
 * @param errors Mensagem de cada campo com problema.
 * @return Os erros no formato do react-hook-form.
 */
export function toFieldErrors<V extends FieldValues>(fields: readonly Path<V>[], errors: Partial<Record<Path<V>, string>>): FieldErrors<V> {
    return fields.reduce<FieldErrors<V>>((fieldErrors, field) => {
        const message = errors[field];
        return message === undefined ? fieldErrors : { ...fieldErrors, [field]: { type: 'validate', message } };
    }, {});
}

/**
 * Título de um grupo de campos (`.sec` dos mockups).
 *
 * @param props.children Texto do título.
 * @return O título, anunciado como cabeçalho.
 */
export function FormSection({ children }: { readonly children: string }): ReactNode {
    return (
        <AppText accessibilityRole="header" className="mt-1.5 text-13 font-semibold text-muted">
            {children}
        </AppText>
    );
}

/**
 * Grupo de linhas com a borda e o raio dos mockups (`.list`).
 *
 * @param props.children As linhas.
 * @return O grupo.
 */
export function FormGroup({ children }: { readonly children: ReactNode }): ReactNode {
    return <View className="overflow-hidden rounded-12 border border-line bg-surface">{children}</View>;
}

/**
 * Linha de formulário (`.it`): rótulo à esquerda, valor à direita, 50 px de altura mínima, e o
 * erro do campo embaixo, na cor `danger`, com o texto — a cor sozinha não diz o que corrigir.
 *
 * @param props.label Rótulo da linha.
 * @param props.error Erro do campo, ou ausente.
 * @param props.first Se é a primeira do grupo, que não tem divisória em cima.
 * @param props.children O valor (campo, seleção, chave).
 * @return A linha.
 */
export function FormRow(props: { readonly label: string; readonly error?: string | undefined; readonly first?: boolean; readonly children: ReactNode }): ReactNode {
    const { label, error, first = false, children } = props;
    return (
        <View className={first ? '' : 'border-t border-line2'}>
            <View className="min-h-12.5 flex-row items-center justify-between gap-2.5 px-3.5 py-1.5">
                <AppText className="text-muted">{label}</AppText>
                <View className="min-w-0 flex-1 items-end">{children}</View>
            </View>
            {error !== undefined && <AppText className="px-3.5 pb-2 text-12 text-danger">{error}</AppText>}
        </View>
    );
}

/**
 * Campo de texto de uma linha, alinhado à direita como no mockup, sem borda própria (a borda é a
 * do grupo). O nome acessível junta o rótulo e o erro.
 *
 * @param props.label Rótulo da linha, que vira o nome acessível.
 * @param props.error Erro do campo, ou ausente.
 * @param props.inputProps Propriedades do `TextInput`.
 * @return O campo.
 */
export function RowInput({ label, error, ...inputProps }: TextInputProps & { readonly label: string; readonly error?: string | undefined }): ReactNode {
    const placeholder = useThemeColor('muted');
    const selection = useThemeColor('accent');
    return (
        <TextInput
            accessibilityLabel={error === undefined ? label : `${label}. ${error}`}
            placeholderTextColor={placeholder}
            selectionColor={selection}
            className="min-h-11 w-full py-2 text-right font-sans text-15 text-ink"
            {...inputProps}
        />
    );
}

/**
 * Controle segmentado (`.seg` dos mockups) para duas ou três escolhas que cabem na linha. Cada
 * segmento é um botão de opção com o estado "selecionado", porque o destaque é só visual.
 *
 * @param props.label Nome do grupo, para o leitor de tela.
 * @param props.options Escolhas, na ordem do mockup.
 * @param props.value Escolha atual.
 * @param props.onChange Ao escolher.
 * @return O controle.
 */
export function Segmented<T extends string>(props: { readonly label: string; readonly options: readonly SelectOption<T>[]; readonly value: T; readonly onChange: (value: T) => void }): ReactNode {
    const { label, options, value, onChange } = props;
    return (
        <View accessibilityRole="radiogroup" accessibilityLabel={label} className="flex-row rounded-10 bg-line2 p-0.75">
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={option.label}
                        onPress={() => {
                            onChange(option.value);
                        }}
                        className={`min-h-11 flex-1 items-center justify-center rounded-8 px-3 ${selected ? 'bg-surface' : ''}`}
                    >
                        <AppText className={`text-13 ${selected ? 'font-semibold text-ink' : 'text-ink2'}`}>{option.label}</AppText>
                    </Pressable>
                );
            })}
        </View>
    );
}

/**
 * Valor de uma linha que abre uma folha de escolhas (`BRL ›` no mockup), com a escolha atual.
 *
 * @param props.label Rótulo da linha e título da folha.
 * @param props.options Escolhas.
 * @param props.value Escolha atual; `null` mostra `placeholder`.
 * @param props.onChange Ao escolher; a folha fecha.
 * @param props.placeholder Texto sem escolha.
 * @param props.display Texto curto do valor na linha, quando o rótulo da opção é longo demais.
 * @return O valor e a folha.
 */
export function RowSelect<T extends string>(props: {
    readonly label: string;
    readonly options: readonly SelectOption<T>[];
    readonly value: T | null;
    readonly onChange: (value: T) => void;
    readonly placeholder?: string;
    readonly display?: (option: SelectOption<T>) => string;
}): ReactNode {
    const { label, options, value, onChange, placeholder = 'Escolher', display = (option) => option.label } = props;
    const [open, setOpen] = useState(false);
    const chosen = options.find((option) => option.value === value) ?? null;
    const text = chosen === null ? placeholder : display(chosen);
    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${chosen?.label ?? placeholder}`}
                onPress={() => {
                    setOpen(true);
                }}
                className="min-h-11 flex-row items-center gap-1.5 rounded-8 px-1 active:bg-line2"
            >
                <AppText className={chosen === null ? 'text-muted' : ''} numberOfLines={1}>{text}</AppText>
                <AppText className="text-muted">›</AppText>
            </Pressable>
            <Sheet
                open={open}
                title={label}
                onClose={() => {
                    setOpen(false);
                }}
            >
                <OptionList
                    options={options}
                    value={value}
                    onSelect={(next) => {
                        onChange(next);
                        setOpen(false);
                    }}
                />
            </Sheet>
        </>
    );
}
