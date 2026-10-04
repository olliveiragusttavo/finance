import { describeError, summarizeNote, useCoreMutation, type CoreCallError } from '@finance/client';
import type { NoteResponse } from '@finance/core';
import type { UseQueryResult } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { useCallback, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { QueryState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useActiveProfile, useProfileSwitchGuard } from '@/shell/activeProfile';
import { reportRejection } from './coreErrorField.ts';
import { filterNotes, noteTitle, readNoteForm } from './noteForm.ts';
import { SectionHeader } from './registryUi.tsx';

/** O que o editor mostra: nada, uma anotação nova ainda não gravada, ou uma existente. */
type EditorTarget = { readonly mode: 'none' } | { readonly mode: 'new' } | { readonly mode: 'edit'; readonly noteId: string };

/** Saída da anotação à espera da resposta do usuário no diálogo de alterações não salvas. */
interface PendingLeave {
    /**
     * @param leave `true` quando a anotação pode ser deixada (salva ou descartada), `false` para ficar.
     */
    readonly resolve: (leave: boolean) => void;
}

/**
 * Anotações em Cadastros (mockup `DesktopAnotacoes`): à esquerda a lista com busca, à direita
 * o editor da anotação aberta. Regra de interface (mockups, decisão 9): anotação é texto livre,
 * e a primeira linha é o título na lista.
 *
 * Sair da anotação com alterações não salvas — abrir outra, criar uma nova, trocar de cadastro
 * ou de tela, trocar de perfil — passa antes por um diálogo que pede salvar ou descartar: o
 * texto de uma anotação não está em nenhum outro lugar, e descartá-lo em silêncio o perderia.
 * Por isso o rascunho e a gravação ficam aqui, e não no editor: o diálogo precisa salvar.
 *
 * @param props.query Anotações do perfil, da mais recente para a mais antiga.
 * @return A seção de anotações.
 */
export function NotesSection({ query }: { readonly query: UseQueryResult<readonly NoteResponse[], CoreCallError> }): ReactNode {
    const { profile } = useActiveProfile();
    const create = useCoreMutation('notes.create');
    const rewrite = useCoreMutation('notes.update');
    const [target, setTarget] = useState<EditorTarget>({ mode: 'none' });
    // Texto como gravado no núcleo, guardado aqui e não lido da lista: enquanto a lista recarrega
    // (depois de salvar, ao trocar de perfil) a anotação some dela por um instante, e comparar com
    // a lista faria o rascunho parecer alterado.
    const [baseline, setBaseline] = useState('');
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [orphaned, setOrphaned] = useState(false);
    const [pending, setPending] = useState<PendingLeave | null>(null);
    const notes = query.data ?? [];
    const open = target.mode === 'edit' ? (notes.find((note) => note.id === target.noteId) ?? null) : null;
    const dirty = target.mode !== 'none' && draft !== baseline;
    const saving = create.isPending || rewrite.isPending;

    // A anotação aberta sumiu da lista já recarregada: foi excluída em outro aparelho. Sem
    // alteração, o editor fecha; com alteração, o texto vira uma anotação nova, para que salvar
    // o guarde em vez de bater numa anotação que não existe mais.
    if (target.mode === 'edit' && open === null && query.data !== undefined && !query.isFetching) {
        if (dirty) {
            setTarget({ mode: 'new' });
            setBaseline('');
            setOrphaned(true);
        } else {
            setTarget({ mode: 'none' });
        }
    }

    const confirmLeave = useCallback(
        (): Promise<boolean> =>
            new Promise((resolve) => {
                setPending({ resolve });
            }),
        [],
    );

    useBlocker({
        shouldBlockFn: async ({ current, next }) => {
            // Comparado pela URL inteira: o `search` aqui não é tipado (é a união de todas as rotas),
            // e qualquer mudança dele nesta tela troca o cadastro aberto.
            const staysInNotes = next.pathname === current.pathname && JSON.stringify(next.search) === JSON.stringify(current.search);
            return !staysInNotes && !(await confirmLeave());
        },
        disabled: !dirty,
        // Fechar a janela não passa pelo roteador, e no Electron o `beforeunload` só cancelaria
        // o fechamento sem mostrar nada ao usuário.
        enableBeforeUnload: false,
    });
    useProfileSwitchGuard(dirty ? confirmLeave : null);

    /**
     * Põe no editor o que abrir, com o texto gravado como rascunho e sem aviso pendente.
     *
     * @param next O que abrir.
     */
    const show = (next: EditorTarget): void => {
        const text = next.mode === 'edit' ? (notes.find((note) => note.id === next.noteId)?.text ?? '') : '';
        setTarget(next);
        setBaseline(text);
        setDraft(text);
        setError(null);
        setOrphaned(false);
    };

    /**
     * Abre outra anotação (ou uma nova) no editor, perguntando antes o que fazer com a
     * alteração não salva da anotação aberta.
     *
     * @param next O que abrir.
     * @return Promessa resolvida quando o editor mudou ou o usuário decidiu ficar.
     */
    const openTarget = async (next: EditorTarget): Promise<void> => {
        if (next.mode === 'edit' && target.mode === 'edit' && next.noteId === target.noteId) {
            return;
        }
        if (dirty && !(await confirmLeave())) {
            return;
        }
        show(next);
    };

    /**
     * Valida e grava; numa anotação nova, cria e passa a editá-la. O rascunho passa a ser o
     * texto devolvido pelo núcleo, e não o digitado: o núcleo grava o texto aparado, e manter
     * os espaços das pontas deixaria o editor parecendo alterado logo depois de salvar.
     *
     * @return `true` quando o texto foi gravado; `false` quando o erro apareceu abaixo do editor.
     * @throws {unknown} A falha que não é recusa do núcleo, relançada pelo `reportRejection`.
     */
    const save = async (): Promise<boolean> => {
        const read = readNoteForm(draft);
        if (!read.ok) {
            setError(read.error);
            return false;
        }
        setError(null);
        try {
            const result = target.mode === 'edit' ? await rewrite.mutateAsync({ id: target.noteId, text: read.text }) : await create.mutateAsync({ profileId: profile.id, text: read.text });
            setTarget({ mode: 'edit', noteId: result.id });
            setBaseline(result.text);
            setDraft(result.text);
            setOrphaned(false);
            toast.success(target.mode === 'edit' ? 'Anotação salva.' : 'Anotação criada.');
            return true;
        } catch (rejection) {
            reportRejection(rejection, { text: 'text' }, (_field, message) => {
                setError(message);
            }, setError);
            return false;
        }
    };

    /**
     * Descarta a alteração: volta ao texto gravado, ou fecha o editor de uma anotação nova,
     * que não tem texto gravado para onde voltar.
     */
    const discard = (): void => {
        if (target.mode === 'new') {
            show({ mode: 'none' });
            return;
        }
        setDraft(baseline);
        setError(null);
    };

    /**
     * Responde à saída pendente e fecha o diálogo.
     *
     * @param leave Se a anotação pode ser deixada.
     */
    const answer = (leave: boolean): void => {
        pending?.resolve(leave);
        setPending(null);
    };

    return (
        <>
            <SectionHeader
                title="Anotações"
                description="Observações e lembretes deste perfil"
                actions={
                    <Button
                        onClick={() => {
                            void openTarget({ mode: 'new' });
                        }}
                    >
                        + Nova anotação
                    </Button>
                }
            />
            <QueryState query={query}>
                {(list) => (
                    <div className="grid grid-cols-[340px_minmax(0,1fr)] items-start gap-4">
                        <NoteList notes={list} openId={open?.id ?? null} onOpen={(id) => {
                            void openTarget({ mode: 'edit', noteId: id });
                        }} />
                        {target.mode === 'none' || (target.mode === 'edit' && open === null) ? (
                            <p className="rounded-10 border border-dashed border-line bg-surface2 p-5 text-13 text-muted">
                                {list.length === 0 ? 'Nenhuma anotação ainda. Use "+ Nova anotação" para escrever a primeira.' : 'Escolha uma anotação na lista para ler ou editar.'}
                            </p>
                        ) : (
                            <NoteEditor
                                key={target.mode === 'edit' ? target.noteId : 'new'}
                                note={open}
                                draft={draft}
                                dirty={dirty}
                                error={error}
                                saving={saving}
                                orphaned={orphaned}
                                onChange={setDraft}
                                onSave={() => {
                                    void save();
                                }}
                                onDiscard={discard}
                                onDeleted={() => {
                                    show({ mode: 'none' });
                                }}
                            />
                        )}
                    </div>
                )}
            </QueryState>
            {pending !== null && (
                <UnsavedNoteDialog
                    saving={saving}
                    onStay={() => {
                        answer(false);
                    }}
                    onDiscard={() => {
                        discard();
                        answer(true);
                    }}
                    onSave={() => {
                        void save().then(answer);
                    }}
                />
            )}
        </>
    );
}

/**
 * Lista com a busca no topo: título em negrito e duas linhas de prévia, como no mockup.
 *
 * @param props.notes Anotações do perfil.
 * @param props.openId Anotação aberta no editor.
 * @param props.onOpen Abre uma anotação.
 * @return A lista.
 */
function NoteList({ notes, openId, onOpen }: { readonly notes: readonly NoteResponse[]; readonly openId: string | null; readonly onOpen: (id: string) => void }): ReactNode {
    const [search, setSearch] = useState('');
    const visible = filterNotes(notes, search);
    return (
        <section aria-label="Lista de anotações" className="overflow-hidden rounded-10 border border-line bg-surface">
            <div className="border-b border-line px-4 py-3">
                <label className="flex flex-col gap-1 text-12">
                    <span className="text-muted">Buscar</span>
                    <Input
                        type="search"
                        placeholder="texto da anotação…"
                        value={search}
                        onChange={(event) => {
                            setSearch(event.target.value);
                        }}
                    />
                </label>
            </div>
            {notes.length > 0 && visible.length === 0 && <p className="px-4 py-3.5 text-13 text-muted">Nenhuma anotação com esse texto.</p>}
            <ul>
                {visible.map((note) => {
                    const { title, preview } = summarizeNote(note.text);
                    const current = note.id === openId;
                    return (
                        <li key={note.id} className="border-b border-line2 last:border-b-0">
                            <button
                                type="button"
                                aria-current={current ? 'true' : undefined}
                                onClick={() => {
                                    onOpen(note.id);
                                }}
                                className={cn('flex w-full flex-col gap-1 px-4 py-3.5 text-left text-ink hover:bg-surface2', current && 'bg-soft shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-soft')}
                            >
                                <span className="font-semibold">{title}</span>
                                {preview !== '' && <span className="line-clamp-2 text-13 text-muted">{preview}</span>}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

/**
 * Editor da anotação: o texto inteiro num campo só, salvar, descartar e excluir. Numa
 * anotação nova, "Descartar" fecha o editor e não há o que excluir. O rascunho é da seção,
 * que precisa dele para salvar a partir do diálogo de alterações não salvas.
 *
 * @param props.note Anotação aberta, ou `null` para escrever uma nova.
 * @param props.draft Texto no editor.
 * @param props.dirty Se o texto difere do gravado; habilita salvar e descartar numa existente.
 * @param props.error Mensagem abaixo do editor, quando a gravação foi recusada.
 * @param props.saving Se a gravação está em andamento.
 * @param props.orphaned Se a anotação editada foi excluída em outro aparelho e o texto virou
 * uma anotação nova.
 * @param props.onChange Atualiza o rascunho.
 * @param props.onSave Grava o rascunho.
 * @param props.onDiscard Volta ao texto gravado, ou fecha uma anotação nova.
 * @param props.onDeleted Fecha o editor depois de excluir.
 * @return O editor.
 */
function NoteEditor({
    note,
    draft,
    dirty,
    error,
    saving,
    orphaned,
    onChange,
    onSave,
    onDiscard,
    onDeleted,
}: {
    readonly note: NoteResponse | null;
    readonly draft: string;
    readonly dirty: boolean;
    readonly error: string | null;
    readonly saving: boolean;
    readonly orphaned: boolean;
    readonly onChange: (text: string) => void;
    readonly onSave: () => void;
    readonly onDiscard: () => void;
    readonly onDeleted: () => void;
}): ReactNode {
    const [confirmDelete, setConfirmDelete] = useState(false);

    return (
        <section aria-label="Editar anotação" className="flex flex-col gap-3 rounded-10 border border-line bg-surface p-5">
            {orphaned && (
                <p role="status" className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">
                    Esta anotação foi excluída em outro aparelho. Salve para guardar o texto como uma nova anotação, ou descarte.
                </p>
            )}
            <form
                noValidate
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    onSave();
                }}
            >
                <div className="flex flex-col gap-1.5">
                    <label htmlFor="note-text" className="text-12 text-muted">
                        Anotação
                    </label>
                    <textarea
                        id="note-text"
                        autoFocus={note === null}
                        value={draft}
                        aria-invalid={error !== null}
                        aria-describedby={error === null ? 'note-text-hint' : 'note-text-error'}
                        onChange={(event) => {
                            onChange(event.target.value);
                        }}
                        className="min-h-105 w-full resize-y rounded-8 border border-line bg-bg p-4 text-15 leading-[1.6] outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50 aria-invalid:border-danger"
                    />
                    {error === null ? (
                        <p id="note-text-hint" className="text-12 text-muted">
                            Texto livre. A primeira linha aparece como título na lista.
                        </p>
                    ) : (
                        <p id="note-text-error" className="text-12 text-danger">
                            {error}
                        </p>
                    )}
                </div>
                <div className="flex items-center justify-between gap-2.5">
                    {note === null ? (
                        <span />
                    ) : (
                        <Button
                            type="button"
                            variant="outline"
                            className="text-13 text-danger"
                            onClick={() => {
                                setConfirmDelete(true);
                            }}
                        >
                            Excluir anotação
                        </Button>
                    )}
                    <div className="flex items-center gap-2.5">
                        <Button type="button" variant="outline" disabled={note !== null && !dirty} onClick={onDiscard}>
                            Descartar alterações
                        </Button>
                        <Button type="submit" disabled={saving || (note !== null && !dirty)}>
                            {saving ? 'Salvando…' : 'Salvar'}
                        </Button>
                    </div>
                </div>
            </form>
            {confirmDelete && note !== null && (
                <NoteDeletionDialog
                    note={note}
                    onClose={() => {
                        setConfirmDelete(false);
                    }}
                    onDeleted={onDeleted}
                />
            )}
        </section>
    );
}

/**
 * Pergunta o que fazer com a alteração não salva antes de deixar a anotação. Fechar o diálogo
 * (Esc, clique fora) é ficar: sair sem resposta perderia o texto, que é o que o diálogo evita.
 *
 * @param props.saving Se a gravação pedida pelo diálogo está em andamento.
 * @param props.onStay Volta ao editor sem sair.
 * @param props.onDiscard Descarta a alteração e sai.
 * @param props.onSave Salva e sai; se a gravação for recusada, fica com o erro no editor.
 * @return O diálogo.
 */
function UnsavedNoteDialog({ saving, onStay, onDiscard, onSave }: { readonly saving: boolean; readonly onStay: () => void; readonly onDiscard: () => void; readonly onSave: () => void }): ReactNode {
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next && !saving) {
                    onStay();
                }
            }}
        >
            <DialogContent showCloseButton={false} role="alertdialog">
                <DialogHeader>
                    <DialogTitle>Salvar as alterações da anotação?</DialogTitle>
                    <DialogDescription>A anotação aberta tem alterações que ainda não foram salvas. Salve ou descarte antes de sair.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button type="button" variant="outline" disabled={saving} onClick={onStay}>
                        Continuar editando
                    </Button>
                    <Button type="button" variant="outline" className="text-danger" disabled={saving} onClick={onDiscard}>
                        Descartar
                    </Button>
                    <Button type="button" disabled={saving} onClick={onSave}>
                        {saving ? 'Salvando…' : 'Salvar'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Confirmação da exclusão. Diferente da tag, a anotação não existe em outro lugar: excluí-la
 * apaga o texto, então a exclusão pede um segundo clique, com o título na pergunta. A recusa
 * do núcleo (anotação já excluída em outro aparelho) aparece no diálogo, como nos alertas de
 * exclusão de conta e cartão, em vez de deixar o botão sem resposta.
 *
 * @param props.note Anotação a excluir.
 * @param props.onClose Fecha sem excluir.
 * @param props.onDeleted Fecha o editor depois de excluir.
 * @return O diálogo.
 */
function NoteDeletionDialog({ note, onClose, onDeleted }: { readonly note: NoteResponse; readonly onClose: () => void; readonly onDeleted: () => void }): ReactNode {
    const remove = useCoreMutation('notes.delete');
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <DialogContent showCloseButton={false} role="alertdialog">
                <DialogHeader>
                    <DialogTitle>Excluir a anotação {noteTitle(note)}?</DialogTitle>
                    <DialogDescription>O texto da anotação é apagado e não pode ser recuperado.</DialogDescription>
                </DialogHeader>
                {remove.error !== null && (
                    <p role="alert" className="text-13 text-danger">
                        {describeError(remove.error.error).message}
                    </p>
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={remove.isPending}
                        onClick={() => {
                            remove.mutate(
                                { id: note.id },
                                {
                                    onSuccess: () => {
                                        toast.success('Anotação excluída.');
                                        onDeleted();
                                    },
                                },
                            );
                        }}
                    >
                        Excluir anotação
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
