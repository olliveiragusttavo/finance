import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText } from './AppText.tsx';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';

/** Uma escolha de uma lista. */
export interface SelectOption<T extends string> {
    readonly value: T;
    readonly label: string;
    /** Linha de apoio (tipo e moeda de um perfil, conta de um cartão). */
    readonly description?: string;
}

/**
 * Lista de escolhas dentro de uma folha, com a marca na escolhida. Cada linha é um botão de
 * opção para o leitor de tela, com o estado "selecionado", porque a marca sozinha é só visual.
 *
 * @param props.options Escolhas, na ordem em que aparecem.
 * @param props.value Escolha atual; `null` quando nenhuma.
 * @param props.onSelect Ao tocar numa escolha.
 * @return A lista.
 */
export function OptionList<T extends string>({ options, value, onSelect }: { readonly options: readonly SelectOption<T>[]; readonly value: T | null; readonly onSelect: (value: T) => void }): ReactNode {
    return (
        <View accessibilityRole="radiogroup" className="overflow-hidden rounded-12 border border-line">
            {options.map((option, index) => {
                const selected = option.value === value;
                return (
                    <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={option.description === undefined ? option.label : `${option.label}, ${option.description}`}
                        onPress={() => {
                            onSelect(option.value);
                        }}
                        className={`min-h-13 flex-row items-center justify-between gap-3 px-3.5 py-2.5 active:bg-line2 ${selected ? 'bg-soft' : 'bg-surface'} ${index === 0 ? '' : 'border-t border-line2'}`}
                    >
                        <View className="min-w-0 flex-1">
                            <AppText className={selected ? 'font-medium text-soft-ink' : ''} numberOfLines={1}>{option.label}</AppText>
                            {option.description !== undefined && <AppText className="text-12 text-muted">{option.description}</AppText>}
                        </View>
                        {selected && <Icon name="check" tone="soft-ink" />}
                    </Pressable>
                );
            })}
        </View>
    );
}

/**
 * Campo de escolha (decisão de interface 12 dos mockups: "escolhas em folhas inferiores"): mostra
 * a escolha atual e, ao toque, abre uma folha com as opções, que fecha ao escolher.
 *
 * @param props.label Rótulo do campo e título da folha.
 * @param props.options Escolhas.
 * @param props.value Escolha atual; `null` mostra `placeholder`.
 * @param props.onChange Ao escolher.
 * @param props.placeholder Texto sem escolha.
 * @param props.error Erro do campo, ou `null`/ausente.
 * @return O campo e a folha.
 */
export function SelectField<T extends string>(props: {
    readonly label: string;
    readonly options: readonly SelectOption<T>[];
    readonly value: T | null;
    readonly onChange: (value: T) => void;
    readonly placeholder?: string;
    readonly error?: string | null;
}): ReactNode {
    const { label, options, value, onChange, placeholder = 'Escolher', error = null } = props;
    const [open, setOpen] = useState(false);
    const chosen = options.find((option) => option.value === value) ?? null;
    return (
        <View className="gap-1">
            <AppText className="text-13 text-muted">{label}</AppText>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${chosen?.label ?? placeholder}${error === null ? '' : `. ${error}`}`}
                onPress={() => {
                    setOpen(true);
                }}
                className={`min-h-11 flex-row items-center justify-between gap-2 rounded-10 border bg-bg px-3 py-2 active:bg-line2 ${error === null ? 'border-line' : 'border-danger'}`}
            >
                <AppText className={chosen === null ? 'text-muted' : ''} numberOfLines={1}>{chosen?.label ?? placeholder}</AppText>
                <AppText className="text-muted">▾</AppText>
            </Pressable>
            {error !== null && <AppText className="text-12 text-danger">{error}</AppText>}
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
        </View>
    );
}
