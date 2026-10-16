import { matchesAllTerms } from '@finance/client';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';

/*
 * Seletor com campo de busca dos formulários (desktop-mvp-plan Fase 13.2): toda escolha de um
 * cadastro — perfil, conta, cartão, categoria, tag, meta — cresce com o uso e, num perfil real,
 * passa do que se acha rolando um menu. Nasceu da escolha da subcategoria do lançamento (Fase 9),
 * que já tinha busca. Listas curtas e fixas (tipo, moeda, frequência) continuam no `Select`.
 */

/** Uma opção do seletor. */
export interface ComboboxOption {
    /** Valor gravado no campo. */
    readonly value: string;
    /** Texto da opção e do botão. */
    readonly label: string;
    /** Título do grupo da opção ("Contas", "Cartões"); ausente numa lista sem grupos. */
    readonly group?: string | undefined;
    /** Texto apagado antes do rótulo na lista ("Alimentação › "), que também entra na busca. */
    readonly prefix?: string | undefined;
    /** Opção visível mas não escolhível. */
    readonly disabled?: boolean | undefined;
}

/** Propriedades de acessibilidade do campo, ligadas ao rótulo e à mensagem do `Field`. */
export interface ComboboxAria {
    readonly 'aria-invalid'?: boolean | undefined;
    readonly 'aria-describedby'?: string | undefined;
}

/** Escolha de uma opção só. */
interface SingleChoice {
    readonly multiple?: false;
    /** Valor escolhido; vazio enquanto nada foi escolhido. */
    readonly value: string;
    readonly onChange: (value: string) => void;
}

/** Escolha de várias opções, como as tags. */
interface MultipleChoice {
    readonly multiple: true;
    readonly value: readonly string[];
    readonly onChange: (value: readonly string[]) => void;
}

/** O que o seletor recebe. */
export type ComboboxProps = (SingleChoice | MultipleChoice) & {
    /** Id do botão, ligado ao rótulo do campo. */
    readonly id: string;
    readonly options: readonly ComboboxOption[];
    /** Texto do botão sem escolha ("Escolha a conta ou o cartão"). */
    readonly placeholder: string;
    /** Nome acessível e dica do campo de busca ("Buscar conta"). */
    readonly searchLabel: string;
    /** Frase da lista sem resultado ("Nenhuma conta encontrada."). */
    readonly emptyText: string;
    readonly disabled?: boolean | undefined;
    readonly aria?: ComboboxAria | undefined;
};

/**
 * Seletor com busca: o botão mostra a escolha, e a lista aberta é filtrada pelo que se digita —
 * cada palavra em qualquer ponto do rótulo ou do prefixo, sem diferenciar acentos
 * (`matchesAllTerms`, o mesmo critério das outras buscas do app). Pelo teclado, o padrão do
 * combobox: o foco fica na busca, `↑↓` andam pelas opções, `Enter` escolhe e `Esc` fecha. Na
 * escolha múltipla a lista continua aberta entre uma marcação e outra.
 *
 * @param props As opções, a escolha e os textos do campo.
 * @return O campo.
 */
export function Combobox(props: ComboboxProps): ReactNode {
    const { id, options, placeholder, searchLabel, emptyText, disabled = false, aria } = props;
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const chosen = props.multiple === true ? props.value : props.value === '' ? [] : [props.value];
    const visible = orderedByGroup(options.filter((option) => matchesAllTerms(query, `${option.prefix ?? ''} ${option.label}`)));
    const choosable = visible.filter((option) => option.disabled !== true);
    const activeOption = choosable[Math.min(active, choosable.length - 1)];
    const listId = `${id}-options`;

    /**
     * @param option Opção escolhida na lista; na escolha múltipla, marca ou desmarca.
     */
    const choose = (option: ComboboxOption): void => {
        if (props.multiple === true) {
            props.onChange(props.value.includes(option.value) ? props.value.filter((value) => value !== option.value) : [...props.value, option.value]);
            return;
        }
        props.onChange(option.value);
        setOpen(false);
    };

    /**
     * Navegação da lista pelo campo de busca, que mantém o foco: digita-se e escolhe-se sem tirar
     * a mão do teclado.
     *
     * @param event Tecla no campo de busca.
     */
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((current) => (choosable.length === 0 ? 0 : (Math.min(current, choosable.length - 1) + step + choosable.length) % choosable.length));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (activeOption !== undefined) {
                choose(activeOption);
            }
        }
    };

    const chosenOptions = options.filter((option) => chosen.includes(option.value));
    let previousGroup: string | undefined;
    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                setQuery('');
                // Abre com a escolhida em destaque, para `Enter` sem digitar manter a escolha.
                const enabled = orderedByGroup(options).filter((option) => option.disabled !== true);
                setActive(Math.max(0, enabled.findIndex((option) => chosen.includes(option.value))));
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    id={id}
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    className={cn('w-full justify-between border-line px-2.5 font-normal', props.multiple === true && 'h-auto min-h-9 py-1.5')}
                    {...aria}
                >
                    <ChosenText multiple={props.multiple === true} chosen={chosenOptions} placeholder={placeholder} />
                    <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex w-(--radix-popover-trigger-width) min-w-75 flex-col gap-2 p-2">
                <Input
                    autoFocus
                    role="combobox"
                    aria-label={searchLabel}
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-activedescendant={activeOption === undefined ? undefined : optionId(listId, activeOption)}
                    placeholder={`${searchLabel}…`}
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setActive(0);
                    }}
                    onKeyDown={onKeyDown}
                />
                <ul id={listId} role="listbox" aria-label={searchLabel} aria-multiselectable={props.multiple === true ? true : undefined} className="flex max-h-64 flex-col overflow-y-auto text-13">
                    {visible.length === 0 && <li className="px-2 py-1.5 text-muted">{emptyText}</li>}
                    {visible.map((option) => {
                        const heading = option.group !== undefined && option.group !== previousGroup ? option.group : null;
                        previousGroup = option.group;
                        const selected = chosen.includes(option.value);
                        return (
                            <OptionRow
                                key={option.value}
                                id={optionId(listId, option)}
                                option={option}
                                heading={heading}
                                selected={selected}
                                active={option === activeOption}
                                multiple={props.multiple === true}
                                onChoose={() => {
                                    choose(option);
                                }}
                            />
                        );
                    })}
                </ul>
            </PopoverContent>
        </Popover>
    );
}

/**
 * Texto do botão: o rótulo da escolhida, ou as escolhidas como etiquetas na escolha múltipla —
 * como as tags apareciam antes, para que se vejam todas sem abrir a lista.
 *
 * @param props.multiple Se a escolha é múltipla.
 * @param props.chosen Opções escolhidas.
 * @param props.placeholder Texto sem escolha.
 * @return O conteúdo do botão.
 */
function ChosenText({ multiple, chosen, placeholder }: { readonly multiple: boolean; readonly chosen: readonly ComboboxOption[]; readonly placeholder: string }): ReactNode {
    if (chosen.length === 0) {
        return <span className="truncate text-muted">{placeholder}</span>;
    }
    if (!multiple) {
        const [option] = chosen;
        return <span className="truncate">{option === undefined ? placeholder : `${option.prefix ?? ''}${option.label}`}</span>;
    }
    return (
        <span className="flex flex-wrap gap-1">
            {chosen.map((option) => (
                <span key={option.value} className="rounded-12 border border-accent bg-soft px-2 text-12 text-soft-ink">
                    {option.label}
                </span>
            ))}
        </span>
    );
}

/**
 * Uma opção da lista, com o título do grupo antes da primeira de cada grupo.
 *
 * @param props.id Id da opção, que o campo de busca aponta como ativa.
 * @param props.option Opção.
 * @param props.heading Título do grupo a mostrar antes dela; `null` quando continua o grupo.
 * @param props.selected Se está escolhida.
 * @param props.active Se é a destacada pelo teclado.
 * @param props.multiple Se a escolha é múltipla, que mostra a marca de escolhida.
 * @param props.onChoose Escolhe a opção.
 * @return O item da lista.
 */
function OptionRow({
    id,
    option,
    heading,
    selected,
    active,
    multiple,
    onChoose,
}: {
    readonly id: string;
    readonly option: ComboboxOption;
    readonly heading: string | null;
    readonly selected: boolean;
    readonly active: boolean;
    readonly multiple: boolean;
    readonly onChoose: () => void;
}): ReactNode {
    const disabled = option.disabled === true;
    return (
        <>
            {heading !== null && (
                <li role="presentation" className="px-2 pt-2 pb-1 text-12 text-muted">
                    {heading}
                </li>
            )}
            <li
                id={id}
                role="option"
                aria-selected={selected}
                aria-disabled={disabled ? true : undefined}
                className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-4 px-2 py-1.5',
                    active && 'bg-soft text-soft-ink',
                    selected && !multiple && 'font-semibold',
                    disabled && 'cursor-not-allowed opacity-50',
                )}
                onMouseDown={(event) => {
                    // Mantém o foco no campo de busca até a escolha fechar a lista.
                    event.preventDefault();
                }}
                onClick={() => {
                    if (!disabled) {
                        onChoose();
                    }
                }}
            >
                {multiple && <CheckIcon aria-hidden="true" className={cn('size-4 shrink-0', !selected && 'invisible')} />}
                <span className="min-w-0 truncate">
                    {option.prefix !== undefined && <span className="text-muted">{option.prefix}</span>}
                    {option.label}
                </span>
            </li>
        </>
    );
}

/**
 * Agrupa as opções mantendo a ordem de cada grupo e a ordem em que os grupos aparecem, para que o
 * título de cada grupo saia uma vez só e a navegação pelo teclado siga a ordem da tela.
 *
 * @param options Opções na ordem recebida.
 * @return As mesmas opções, com as de cada grupo juntas, os grupos na ordem em que aparecem.
 */
function orderedByGroup(options: readonly ComboboxOption[]): readonly ComboboxOption[] {
    const groups = [...new Set(options.map((option) => option.group))];
    return groups.flatMap((group) => options.filter((option) => option.group === group));
}

/**
 * @param listId Id da lista.
 * @param option Opção.
 * @return Id da opção, estável e único na lista.
 */
function optionId(listId: string, option: ComboboxOption): string {
    return `${listId}-${option.value}`;
}
