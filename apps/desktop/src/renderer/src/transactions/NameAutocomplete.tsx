import type { TransactionNameSuggestionResponse } from '@finance/core';
import { useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/cn';

/** O que o campo "Nome" com autocomplete recebe. */
export interface NameAutocompleteProps {
    readonly id: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly onBlur: () => void;
    /** Ref do react-hook-form, para o foco no campo com erro ao salvar. */
    readonly inputRef: Ref<HTMLInputElement>;
    /** Sugestões já filtradas pelo texto e pelo tipo (`matchNameSuggestions`). */
    readonly suggestions: readonly TransactionNameSuggestionResponse[];
    /** Recebe a sugestão escolhida, para o formulário copiar a categoria e a origem dela. */
    readonly onPick: (suggestion: TransactionNameSuggestionResponse) => void;
    /** O que escolher a sugestão copia ("Alimentação › Mercado · Nubank"), mostrado abaixo do nome. */
    readonly describe: (suggestion: TransactionNameSuggestionResponse) => string;
    readonly aria: { readonly 'aria-invalid'?: boolean | undefined; readonly 'aria-describedby'?: string | undefined };
}

/**
 * Campo "Nome" do lançamento novo com as sugestões dos nomes já lançados no perfil. Escolher uma
 * copia a categoria e a conta ou o cartão do último lançamento com esse nome, para que a compra
 * de sempre se lance digitando o começo do nome. O foco fica no próprio campo — a lista é só uma
 * ajuda, e digitar um nome novo continua sendo o caminho comum —, então ela abre ancorada ao
 * campo, sem roubar o foco: `↑↓` destacam uma sugestão, `Enter` a escolhe e `Esc` fecha a lista
 * sem fechar o diálogo. `Enter` sem sugestão destacada segue para o salvar do formulário.
 *
 * @param props O valor do campo, as sugestões e o que fazer ao escolher uma.
 * @return O campo com a lista de sugestões.
 */
export function NameAutocomplete({ id, value, onChange, onBlur, inputRef, suggestions, onPick, describe, aria }: NameAutocompleteProps): ReactNode {
    const [focused, setFocused] = useState(false);
    // Fechada por `Esc`, por um clique fora ou por uma escolha, a lista só volta quando o
    // usuário digita de novo — senão reabriria sozinha a cada renderização.
    const [dismissed, setDismissed] = useState(false);
    const [active, setActive] = useState<number | null>(null);
    const anchor = useRef<HTMLDivElement>(null);
    const open = focused && !dismissed && suggestions.length > 0;
    const listId = `${id}-suggestions`;
    const activeIndex = active === null ? null : Math.min(active, suggestions.length - 1);

    /**
     * @param suggestion Sugestão escolhida pelo clique ou pelo `Enter`.
     */
    const pick = (suggestion: TransactionNameSuggestionResponse): void => {
        onPick(suggestion);
        setDismissed(true);
        setActive(null);
    };

    /**
     * Navegação da lista sem tirar o foco do campo, como no `Combobox`.
     *
     * @param event Tecla no campo do nome.
     */
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (!open) {
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((current) => (current === null ? (step === 1 ? 0 : suggestions.length - 1) : (Math.min(current, suggestions.length - 1) + step + suggestions.length) % suggestions.length));
        } else if (event.key === 'Enter' && activeIndex !== null) {
            const suggestion = suggestions[activeIndex];
            if (suggestion !== undefined) {
                // Escolher não pode também enviar o formulário.
                event.preventDefault();
                pick(suggestion);
            }
        }
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    setDismissed(true);
                    setActive(null);
                }
            }}
        >
            <PopoverAnchor asChild>
                <div ref={anchor}>
                    <Input
                        id={id}
                        ref={inputRef}
                        role="combobox"
                        autoComplete="off"
                        aria-autocomplete="list"
                        aria-expanded={open}
                        aria-controls={open ? listId : undefined}
                        aria-activedescendant={open && activeIndex !== null ? `${listId}-${String(activeIndex)}` : undefined}
                        value={value}
                        onChange={(event) => {
                            onChange(event.target.value);
                            setDismissed(false);
                            setActive(null);
                        }}
                        onFocus={() => {
                            setFocused(true);
                        }}
                        onBlur={() => {
                            setFocused(false);
                            onBlur();
                        }}
                        onKeyDown={onKeyDown}
                        {...aria}
                    />
                </div>
            </PopoverAnchor>
            <PopoverContent
                align="start"
                className="w-(--radix-popover-trigger-width) p-1"
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                }}
                onInteractOutside={(event) => {
                    // O clique no próprio campo é "fora" da lista para o Radix, mas não fecha.
                    if (event.target instanceof Node && anchor.current?.contains(event.target) === true) {
                        event.preventDefault();
                    }
                }}
            >
                <ul id={listId} role="listbox" aria-label="Lançamentos anteriores" className="flex max-h-64 flex-col overflow-y-auto text-13">
                    {suggestions.map((suggestion, index) => (
                        <li
                            key={`${suggestion.type}-${suggestion.name}`}
                            id={`${listId}-${String(index)}`}
                            role="option"
                            aria-selected={index === activeIndex}
                            className={cn('flex cursor-pointer flex-col rounded-4 px-2 py-1.5', index === activeIndex && 'bg-soft text-soft-ink')}
                            onMouseDown={(event) => {
                                // Mantém o foco no campo, para o `blur` não fechar a lista antes do clique.
                                event.preventDefault();
                            }}
                            onClick={() => {
                                pick(suggestion);
                            }}
                        >
                            <span className="truncate">{suggestion.name}</span>
                            <span className={cn('truncate text-12', index === activeIndex ? 'text-soft-ink' : 'text-muted')}>{describe(suggestion)}</span>
                        </li>
                    ))}
                </ul>
            </PopoverContent>
        </Popover>
    );
}
