import { formatDate, formatMoney, useCoreMutation, type CoreCallError } from '@finance/client';
import type { TagUsageResponse } from '@finance/core';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { XIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Field, fieldAria } from '@/components/form';
import { EmptyState, QueryState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { reportRejection } from './coreErrorField.ts';
import { readNameForm } from './nameForm.ts';
import { SectionHeader } from './registryUi.tsx';

/** Rótulo do campo do nome, com artigo, para a frase do campo vazio. */
const TAG_NAME_LABEL = 'o nome da tag';

/**
 * Tags em Cadastros (mockup `DesktopTags`): a lista com o uso de cada tag em todo o período e,
 * ao lado, o painel da tag escolhida para renomear ou excluir. A criação fica no topo, num
 * campo só, porque a tag é só um nome.
 *
 * @param props.query Tags do perfil, com o uso; a mesma consulta que conta o item na lista
 * lateral.
 * @return A seção de tags.
 */
export function TagsSection({ query }: { readonly query: UseQueryResult<readonly TagUsageResponse[], CoreCallError> }): ReactNode {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selected = query.data?.find((tag) => tag.id === selectedId) ?? null;

    return (
        <>
            <SectionHeader title="Tags" description="Etiquetas livres; um lançamento pode ter várias" actions={<NewTagForm />} />
            <QueryState query={query}>
                {(tags) =>
                    tags.length === 0 ? (
                        <EmptyState title="Nenhuma tag" description="Crie a primeira tag no campo acima. Depois, marque os lançamentos com ela em Transações." />
                    ) : (
                        <div className="grid grid-cols-5 items-start gap-4">
                            <TagTable tags={tags} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
                            {selected === null ? (
                                <p className="col-span-2 rounded-10 border border-dashed border-line bg-surface2 p-5 text-13 text-muted">Clique numa tag para renomear ou excluir.</p>
                            ) : (
                                <TagPanel
                                    key={selected.id}
                                    tag={selected}
                                    onClose={() => {
                                        setSelectedId(null);
                                    }}
                                />
                            )}
                        </div>
                    )
                }
            </QueryState>
        </>
    );
}

/**
 * "Nova tag" e "Adicionar", no cabeçalho como no mockup. O nome repetido volta do núcleo como
 * `CONFLICT` e aparece abaixo do campo.
 *
 * @return O formulário de tag nova.
 */
function NewTagForm(): ReactNode {
    const { profile } = useActiveProfile();
    const create = useCoreMutation('tags.create');
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const fieldError = error === null ? undefined : { type: 'validate', message: error };

    /**
     * Valida o nome com o campo das rotas e cria a tag; o campo se esvazia para a próxima.
     *
     * @return Promessa resolvida quando a tag foi criada ou o erro apareceu.
     */
    const submit = async (): Promise<void> => {
        const read = readNameForm(name, TAG_NAME_LABEL);
        if (!read.ok) {
            setError(read.error);
            return;
        }
        setError(null);
        try {
            await create.mutateAsync({ profileId: profile.id, name: read.name });
            toast.success(`Tag ${read.name} criada.`);
            setName('');
        } catch (rejection) {
            reportRejection(rejection, { name: 'name' }, (_field, message) => {
                setError(message);
            }, setError);
        }
    };

    return (
        <form
            noValidate
            className="flex items-start gap-2"
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <Field id="new-tag" label="Nova tag" error={fieldError} className="w-60">
                <Input
                    id="new-tag"
                    placeholder="Ex.: viagem-floripa"
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                    }}
                    {...fieldAria('new-tag', fieldError)}
                />
            </Field>
            <Button type="submit" disabled={create.isPending} className="mt-5.5">
                Adicionar
            </Button>
        </form>
    );
}

/**
 * Tabela das tags: nome, lançamentos, total e último uso, com os números à direita e
 * tabulares (decisões de interface 8). Clicar na linha abre o painel; o nome é um botão, para
 * que o teclado chegue à mesma ação.
 *
 * @param props.tags Tags do perfil, por nome.
 * @param props.selectedId Tag aberta no painel.
 * @param props.onSelect Abre uma tag no painel.
 * @return A tabela com a nota de rodapé.
 */
function TagTable({ tags, selectedId, onSelect }: { readonly tags: readonly TagUsageResponse[]; readonly selectedId: string | null; readonly onSelect: (id: string) => void }): ReactNode {
    return (
        <section aria-label="Lista de tags" className="col-span-3 overflow-hidden rounded-10 border border-line bg-surface">
            <table className="w-full text-13">
                <thead className="bg-surface2 text-12 text-muted">
                    <tr className="border-b border-line">
                        <th scope="col" className="px-4 py-3 text-left font-normal">
                            Tag
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-normal">
                            Lançamentos
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-normal">
                            Total
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-normal">
                            Último uso
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {tags.map((tag) => {
                        const current = tag.id === selectedId;
                        return (
                            <tr
                                key={tag.id}
                                aria-current={current ? 'true' : undefined}
                                onClick={() => {
                                    onSelect(tag.id);
                                }}
                                className={cn('cursor-pointer border-b border-line2 last:border-b-0 hover:bg-surface2', current && 'bg-soft shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-soft')}
                            >
                                <td className="px-4 py-3">
                                    <button
                                        type="button"
                                        aria-label={`Editar a tag ${tag.name}`}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onSelect(tag.id);
                                        }}
                                        className={cn('inline-flex items-center rounded-18 bg-track px-2.5 py-0.75 text-13 text-ink', current && 'font-semibold')}
                                    >
                                        {tag.name}
                                    </button>
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">{tag.transactionCount}</td>
                                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(tag.total)}</td>
                                <td className="px-4 py-3 text-right text-muted tabular-nums">{tag.lastUsedOn === null ? '—' : formatDate(tag.lastUsedOn)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <p className="border-t border-line bg-surface2 px-4 py-2.5 text-12 text-muted">Totais de todo o período, somando os valores em módulo. Clique numa tag para editar.</p>
        </section>
    );
}

/**
 * Painel "Editar tag" do mockup: nome, o uso em números, os atalhos para Transações e para o
 * relatório por tag, salvar e excluir. Regra de negócio (Tags): excluir tira a tag dos
 * lançamentos, que continuam existindo — o aviso diz quantos, e por isso a exclusão não pede
 * outra confirmação: nada além da etiqueta se perde.
 *
 * @param props.tag Tag aberta.
 * @param props.onClose Fecha o painel.
 * @return O painel.
 */
function TagPanel({ tag, onClose }: { readonly tag: TagUsageResponse; readonly onClose: () => void }): ReactNode {
    const rename = useCoreMutation('tags.update');
    const remove = useCoreMutation('tags.delete');
    const [name, setName] = useState(tag.name);
    const [error, setError] = useState<string | null>(null);
    const fieldError = error === null ? undefined : { type: 'validate', message: error };

    /**
     * Valida e grava o novo nome.
     *
     * @return Promessa resolvida quando o nome foi gravado ou o erro apareceu.
     */
    const save = async (): Promise<void> => {
        const read = readNameForm(name, TAG_NAME_LABEL);
        if (!read.ok) {
            setError(read.error);
            return;
        }
        setError(null);
        try {
            await rename.mutateAsync({ id: tag.id, name: read.name });
            toast.success(`Tag renomeada para ${read.name}.`);
        } catch (rejection) {
            reportRejection(rejection, { name: 'name' }, (_field, message) => {
                setError(message);
            }, setError);
        }
    };

    /**
     * Exclui a tag e fecha o painel, que não teria mais o que mostrar.
     *
     * @return Promessa resolvida quando a tag foi excluída ou o erro apareceu.
     */
    const destroy = async (): Promise<void> => {
        try {
            await remove.mutateAsync({ id: tag.id });
            toast.success(`Tag ${tag.name} excluída.`);
            onClose();
        } catch (rejection) {
            reportRejection(rejection, {}, () => undefined, setError);
        }
    };

    return (
        <aside aria-label="Editar tag" className="col-span-2 flex flex-col gap-3.5 rounded-10 border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
                <h3 className="text-16 font-semibold">Editar tag</h3>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Fechar painel" onClick={onClose}>
                    <XIcon />
                </Button>
            </div>
            <form
                noValidate
                className="flex flex-col gap-3.5"
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                <Field id="tag-name" label="Nome" error={fieldError} hint="Até 45 caracteres. Não pode repetir outra tag do perfil, nem com maiúsculas diferentes.">
                    <Input
                        id="tag-name"
                        value={name}
                        onChange={(event) => {
                            setName(event.target.value);
                        }}
                        {...fieldAria('tag-name', fieldError, true)}
                    />
                </Field>
                <div className="grid grid-cols-2 gap-2.5">
                    <Kpi label="Lançamentos" value={String(tag.transactionCount)} />
                    <Kpi label="Total" value={formatMoney(tag.total)} />
                </div>
                <div className="flex flex-col gap-1.5 text-13">
                    <Link to="/transactions" search={{ tag: tag.id }} className="text-accent hover:text-soft-ink">
                        Ver lançamentos em Transações →
                    </Link>
                    <Link to="/reports/tag" className="text-accent hover:text-soft-ink">
                        Abrir relatório por tag →
                    </Link>
                </div>
                <div className="flex items-center gap-2.5">
                    <Button type="submit" disabled={rename.isPending}>
                        {rename.isPending ? 'Salvando…' : 'Salvar'}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={remove.isPending}
                        className="text-13 text-danger"
                        onClick={() => {
                            void destroy();
                        }}
                    >
                        Excluir tag
                    </Button>
                </div>
            </form>
            <p className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">
                {tag.transactionCount === 0
                    ? 'Nenhum lançamento usa esta tag; excluir só apaga o nome.'
                    : `Excluir remove a tag ${tag.transactionCount === 1 ? 'do lançamento' : `dos ${String(tag.transactionCount)} lançamentos`}. Os lançamentos continuam existindo.`}
            </p>
        </aside>
    );
}

/**
 * Número do painel com rótulo, o `.kpi` do mockup.
 *
 * @param props.label Rótulo acima do número.
 * @param props.value Número já formatado.
 * @return O indicador.
 */
function Kpi({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
    return (
        <div className="flex flex-col gap-0.5 rounded-8 border border-line2 p-3">
            <span className="text-12 text-muted">{label}</span>
            <span className="text-18 font-semibold tabular-nums">{value}</span>
        </div>
    );
}
