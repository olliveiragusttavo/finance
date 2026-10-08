import { subCategoryOptions, type SubCategoryOption } from '@finance/client';
import type { CategoryBranchResponse, TagResponse } from '@finance/core';
import { ChevronDownIcon } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';

/*
 * Escolhas do painel de lançamento que não cabem num `Select`: a subcategoria, que precisa de
 * busca (desktop-mvp-plan Fase 9) porque a árvore inteira passa de cem itens num perfil real, e
 * as tags, que são várias de uma vez.
 */

/** Propriedades de acessibilidade do campo, ligadas ao rótulo e à mensagem do `Field`. */
interface FieldAria {
    readonly 'aria-invalid': boolean;
    readonly 'aria-describedby': string | undefined;
}

/**
 * Subcategoria com busca: o botão mostra "Categoria › Sub" como a tabela, e abre uma lista
 * filtrada pelo que se digita. A busca olha a categoria e a subcategoria juntas
 * (`subCategoryOptions`). Pelo teclado: `↑↓` escolhem, `Enter` confirma, `Esc` fecha.
 *
 * @param props.id Id do botão, ligado ao rótulo do campo.
 * @param props.tree Árvore de categorias do perfil.
 * @param props.value Subcategoria escolhida; vazio enquanto nada foi escolhido.
 * @param props.onChange Recebe a subcategoria escolhida.
 * @param props.aria Atributos do erro do campo.
 * @return O campo.
 */
export function SubCategoryPicker({
    id,
    tree,
    value,
    onChange,
    aria,
}: {
    readonly id: string;
    readonly tree: readonly CategoryBranchResponse[];
    readonly value: string;
    readonly onChange: (subCategoryId: string) => void;
    readonly aria: FieldAria;
}): ReactNode {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const options = subCategoryOptions(tree, query);
    const selected = subCategoryOptions(tree, '').find((option) => option.id === value);
    const listId = `${id}-options`;
    const activeOption = options[Math.min(active, options.length - 1)];

    /**
     * @param option Subcategoria escolhida na lista.
     */
    const choose = (option: SubCategoryOption): void => {
        onChange(option.id);
        setOpen(false);
    };

    /**
     * Navegação da lista pelo campo de busca, que mantém o foco: o padrão do combobox, em que se
     * digita e se escolhe sem tirar a mão do teclado.
     *
     * @param event Tecla no campo de busca.
     */
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((current) => (options.length === 0 ? 0 : (Math.min(current, options.length - 1) + step + options.length) % options.length));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (activeOption !== undefined) {
                choose(activeOption);
            }
        }
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                setQuery('');
                setActive(Math.max(0, subCategoryOptions(tree, '').findIndex((option) => option.id === value)));
            }}
        >
            <PopoverTrigger asChild>
                <Button id={id} type="button" variant="outline" className="w-full justify-between border-line px-2.5 font-normal" {...aria}>
                    <span className={cn('truncate', selected === undefined && 'text-muted')}>{selected?.label ?? 'Escolha a categoria'}</span>
                    <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex w-75 flex-col gap-2 p-2">
                <Input
                    autoFocus
                    role="combobox"
                    aria-label="Buscar categoria"
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-activedescendant={activeOption === undefined ? undefined : `${listId}-${activeOption.id}`}
                    placeholder="Buscar categoria…"
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setActive(0);
                    }}
                    onKeyDown={onKeyDown}
                />
                <ul id={listId} role="listbox" aria-label="Categorias" className="flex max-h-64 flex-col overflow-y-auto text-13">
                    {options.length === 0 && <li className="px-2 py-1.5 text-muted">Nenhuma categoria encontrada.</li>}
                    {options.map((option) => (
                        <li
                            key={option.id}
                            id={`${listId}-${option.id}`}
                            role="option"
                            aria-selected={option.id === value}
                            className={cn('cursor-pointer rounded-4 px-2 py-1.5', option === activeOption && 'bg-soft text-soft-ink', option.id === value && 'font-semibold')}
                            onMouseDown={(event) => {
                                // Mantém o foco no campo de busca até a escolha fechar a lista.
                                event.preventDefault();
                            }}
                            onClick={() => {
                                choose(option);
                            }}
                        >
                            <span className="text-muted">{option.categoryName} › </span>
                            {option.name}
                        </li>
                    ))}
                </ul>
            </PopoverContent>
        </Popover>
    );
}

/**
 * Tags do lançamento: o botão lista as escolhidas e abre um menu de marcar e desmarcar, que fica
 * aberto entre uma marcação e outra para escolher várias de uma vez.
 *
 * @param props.id Id do botão, ligado ao rótulo do campo.
 * @param props.tags Tags do perfil.
 * @param props.value Tags marcadas.
 * @param props.onChange Recebe as tags marcadas.
 * @return O campo.
 */
export function TagPicker({
    id,
    tags,
    value,
    onChange,
}: {
    readonly id: string;
    readonly tags: readonly TagResponse[];
    readonly value: readonly string[];
    readonly onChange: (tagIds: readonly string[]) => void;
}): ReactNode {
    const chosen = tags.filter((tag) => value.includes(tag.id));
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button id={id} type="button" variant="outline" className="h-auto min-h-9 w-full justify-between border-line px-2.5 py-1.5 font-normal" disabled={tags.length === 0}>
                    <span className="flex flex-wrap gap-1">
                        {chosen.length === 0 ? (
                            <span className="text-muted">{tags.length === 0 ? 'Nenhuma tag cadastrada' : 'adicionar tag'}</span>
                        ) : (
                            chosen.map((tag) => (
                                <span key={tag.id} className="rounded-12 border border-accent bg-soft px-2 text-12 text-soft-ink">
                                    {tag.name}
                                </span>
                            ))
                        )}
                    </span>
                    <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 opacity-50" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 w-(--radix-dropdown-menu-trigger-width) overflow-y-auto">
                {tags.map((tag) => (
                    <DropdownMenuCheckboxItem
                        key={tag.id}
                        checked={value.includes(tag.id)}
                        onSelect={(event) => {
                            event.preventDefault();
                        }}
                        onCheckedChange={(checked) => {
                            onChange(checked ? [...value, tag.id] : value.filter((tagId) => tagId !== tag.id));
                        }}
                    >
                        {tag.name}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
