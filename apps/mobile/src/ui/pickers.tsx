import { currentDate, formatDateChoice, formatMonthLong, matchesAllTerms, monthGrid, shiftPeriod, WEEKDAY_INITIALS } from '@finance/client';
import { useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useThemeColor } from '../theme/ThemeRoot.tsx';
import { AppText } from './AppText.tsx';
import { Icon } from './Icon.tsx';
import { OptionList, type SelectOption } from './Select.tsx';
import { Sheet } from './Sheet.tsx';

/**
 * Valor de uma linha de formulário que abre uma folha: o texto e o "›", com o nome acessível do
 * campo e da escolha atual.
 *
 * @param props.label Nome do campo.
 * @param props.text Valor mostrado.
 * @param props.empty Se ainda não há escolha (o texto aparece esmaecido).
 * @param props.onPress Abre a folha.
 * @return O valor tocável.
 */
export function RowValue({ label, text, empty, onPress }: { readonly label: string; readonly text: string; readonly empty: boolean; readonly onPress: () => void }): ReactNode {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${text}`} onPress={onPress} className="min-h-11 max-w-full flex-row items-center gap-1.5 rounded-8 px-1 active:bg-line2">
            <AppText className={`shrink ${empty ? 'text-muted' : ''}`} numberOfLines={1}>{text}</AppText>
            <AppText className="text-muted">›</AppText>
        </Pressable>
    );
}

/**
 * Calendário do mês numa folha: ‹ mês ›, as iniciais dos dias e a grade do `monthGrid` do
 * `client`, com hoje e o dia escolhido marcados. Cada dia é um botão com a data por extenso,
 * porque o número sozinho não diz o mês ao leitor de tela.
 *
 * @param props.open Se a folha está aberta.
 * @param props.title Título da folha (o nome do campo).
 * @param props.value Data escolhida, `YYYY-MM-DD`, ou vazia.
 * @param props.onChange Ao escolher um dia; a folha fecha.
 * @param props.onClose Fecha sem escolher.
 * @return A folha.
 */
export function DateSheet(props: { readonly open: boolean; readonly title: string; readonly value: string; readonly onChange: (date: string) => void; readonly onClose: () => void }): ReactNode {
    const { open, title, value, onChange, onClose } = props;
    const today = currentDate(new Date());
    const [period, setPeriod] = useState((value === '' ? today : value).slice(0, 7));
    return (
        <Sheet open={open} title={title} onClose={onClose}>
            <View className="flex-row items-center justify-between">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Mês anterior"
                    onPress={() => {
                        setPeriod(shiftPeriod(period, -1));
                    }}
                    className="h-11 w-12 items-center justify-center rounded-10 active:bg-line2"
                >
                    <AppText className="text-20">‹</AppText>
                </Pressable>
                <AppText className="font-semibold">{formatMonthLong(period)}</AppText>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Próximo mês"
                    onPress={() => {
                        setPeriod(shiftPeriod(period, 1));
                    }}
                    className="h-11 w-12 items-center justify-center rounded-10 active:bg-line2"
                >
                    <AppText className="text-20">›</AppText>
                </Pressable>
            </View>
            <View className="flex-row">
                {WEEKDAY_INITIALS.map((initial, index) => (
                    <AppText key={`${initial}${String(index)}`} className="flex-1 text-center text-12 text-muted">
                        {initial}
                    </AppText>
                ))}
            </View>
            {monthGrid(period).map((week, index) => (
                <View key={`${period}:${String(index)}`} className="flex-row">
                    {week.map((day, column) => {
                        if (day === null) {
                            return <View key={`blank:${String(column)}`} className="h-11 flex-1" />;
                        }
                        const selected = day === value;
                        return (
                            <Pressable
                                key={day}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                                accessibilityLabel={formatDateChoice(day, today)}
                                onPress={() => {
                                    onChange(day);
                                }}
                                className={`h-11 flex-1 items-center justify-center rounded-full ${selected ? 'bg-accent' : 'active:bg-line2'}`}
                            >
                                <AppText className={selected ? 'font-semibold text-on-accent' : day === today ? 'font-semibold text-accent' : ''}>{String(Number(day.slice(8)))}</AppText>
                            </Pressable>
                        );
                    })}
                </View>
            ))}
            <Pressable
                accessibilityRole="button"
                onPress={() => {
                    onChange(today);
                }}
                className="min-h-11 items-center justify-center rounded-10 active:bg-line2"
            >
                <AppText className="text-accent">Hoje</AppText>
            </Pressable>
        </Sheet>
    );
}

/**
 * Data de uma linha de formulário: "Hoje, 06/10" e o calendário em folha.
 *
 * @param props.label Nome do campo e título da folha.
 * @param props.value Data `YYYY-MM-DD`, ou vazia.
 * @param props.onChange Nova data.
 * @return O valor e a folha.
 */
export function RowDate({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (date: string) => void }): ReactNode {
    const [open, setOpen] = useState(false);
    const today = currentDate(new Date());
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(value);
    return (
        <>
            <RowValue
                label={label}
                text={valid ? formatDateChoice(value, today) : 'Escolher'}
                empty={!valid}
                onPress={() => {
                    setOpen(true);
                }}
            />
            <DateSheet
                open={open}
                title={label}
                value={valid ? value : ''}
                onChange={(date) => {
                    onChange(date);
                    setOpen(false);
                }}
                onClose={() => {
                    setOpen(false);
                }}
            />
        </>
    );
}

/**
 * Escolha com busca numa folha, para listas longas (categorias, contas): o campo de busca filtra
 * pelo `matchesAllTerms` do `client` — sem acento e sem caixa, como o desktop — e a lista
 * mostra a escolha atual marcada.
 *
 * @param props.label Nome do campo e título da folha.
 * @param props.options Escolhas.
 * @param props.value Escolha atual; `null` mostra `placeholder`.
 * @param props.onChange Ao escolher; a folha fecha.
 * @param props.placeholder Texto sem escolha.
 * @param props.emptyText Frase quando a busca não acha nada.
 * @return O valor e a folha.
 */
export function RowSearchSelect<T extends string>(props: {
    readonly label: string;
    readonly options: readonly SelectOption<T>[];
    readonly value: T | null;
    readonly onChange: (value: T) => void;
    readonly placeholder?: string;
    readonly emptyText?: string;
}): ReactNode {
    const { label, options, value, onChange, placeholder = 'Escolher', emptyText = 'Nada encontrado.' } = props;
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const placeholderColor = useThemeColor('muted');
    const chosen = options.find((option) => option.value === value) ?? null;
    const visible = options.filter((option) => matchesAllTerms(query, `${option.label} ${option.description ?? ''}`));
    /** Fecha a folha e limpa a busca, para a próxima abertura mostrar a lista inteira. */
    const close = (): void => {
        setOpen(false);
        setQuery('');
    };
    return (
        <>
            <RowValue
                label={label}
                text={chosen?.label ?? placeholder}
                empty={chosen === null}
                onPress={() => {
                    setOpen(true);
                }}
            />
            <Sheet open={open} title={label} onClose={close}>
                {options.length > 7 && (
                    <View className="flex-row items-center gap-2 rounded-10 border border-line bg-bg px-3">
                        <Icon name="search" tone="muted" />
                        <TextInput
                            accessibilityLabel={`Buscar em ${label}`}
                            placeholder="Buscar"
                            placeholderTextColor={placeholderColor}
                            value={query}
                            onChangeText={setQuery}
                            className="min-h-11 flex-1 font-sans text-15 text-ink"
                        />
                    </View>
                )}
                {visible.length === 0 ? (
                    <AppText className="text-13 text-muted">{emptyText}</AppText>
                ) : (
                    <OptionList
                        options={visible}
                        value={value}
                        onSelect={(next) => {
                            onChange(next);
                            close();
                        }}
                    />
                )}
            </Sheet>
        </>
    );
}

/**
 * Várias escolhas numa folha (as tags do lançamento): cada linha é uma caixa de seleção, e a
 * folha fica aberta até "Pronto", porque quem marca uma tag costuma marcar outra.
 *
 * @param props.label Nome do campo e título da folha.
 * @param props.options Escolhas.
 * @param props.value Escolhas marcadas.
 * @param props.onChange Novas escolhas.
 * @param props.emptyText Frase quando não há o que escolher.
 * @return O valor e a folha.
 */
export function RowMultiSelect(props: {
    readonly label: string;
    readonly options: readonly SelectOption<string>[];
    readonly value: readonly string[];
    readonly onChange: (value: readonly string[]) => void;
    readonly emptyText: string;
}): ReactNode {
    const { label, options, value, onChange, emptyText } = props;
    const [open, setOpen] = useState(false);
    const names = options.filter((option) => value.includes(option.value)).map((option) => option.label);
    return (
        <>
            <RowValue
                label={label}
                text={names.length === 0 ? 'nenhuma' : names.join(', ')}
                empty={names.length === 0}
                onPress={() => {
                    setOpen(true);
                }}
            />
            <Sheet
                open={open}
                title={label}
                onClose={() => {
                    setOpen(false);
                }}
            >
                {options.length === 0 && <AppText className="text-13 text-muted">{emptyText}</AppText>}
                <View className="overflow-hidden rounded-12 border border-line">
                    {options.map((option, index) => {
                        const checked = value.includes(option.value);
                        return (
                            <Pressable
                                key={option.value}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked }}
                                accessibilityLabel={option.label}
                                onPress={() => {
                                    onChange(checked ? value.filter((id) => id !== option.value) : [...value, option.value]);
                                }}
                                className={`min-h-12.5 flex-row items-center justify-between px-3.5 active:bg-line2 ${checked ? 'bg-soft' : 'bg-surface'} ${index === 0 ? '' : 'border-t border-line2'}`}
                            >
                                <AppText className={checked ? 'font-medium text-soft-ink' : ''}>{option.label}</AppText>
                                {checked && <Icon name="check" tone="soft-ink" />}
                            </Pressable>
                        );
                    })}
                </View>
                <AppText
                    accessibilityRole="button"
                    onPress={() => {
                        setOpen(false);
                    }}
                    className="min-h-11 py-3 text-center font-semibold text-accent"
                >
                    Pronto
                </AppText>
            </Sheet>
        </>
    );
}
