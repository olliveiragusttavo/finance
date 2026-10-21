import {
    buildPartnerRosterView,
    draftFromPartners,
    toSavePartnersInput,
    useCoreMutation,
    usePartnerReport,
    usePartners,
    type PartnerDraftRow,
    type PartnerRosterRow,
    type PartnerRosterView,
} from '@finance/client';
import { PARTNER_NAME_MAX_LENGTH, type PartnerResponse } from '@finance/core';
import { Link } from '@tanstack/react-router';
import { XIcon } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { SectionHeader } from '@/components/entityUi';
import { EmptyState, QueryState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { reportRejection } from '@/lib/coreErrorField';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';

/**
 * Cor de cada sócio na divisão, pela posição na lista. O mockup `DesktopSocios` define `--s1` a
 * `--s4` com os mesmos valores, nos dois temas, de `accent`, `out`, `muted` e `dot`; usar esses
 * tokens evita uma paleta paralela fora do `packages/tokens`.
 */
const PARTNER_COLORS: readonly string[] = ['bg-accent', 'bg-out', 'bg-muted', 'bg-dot'];

/** Colunas da tabela do mockup: cor, nome, participação, pagou, deveria, remover. */
const TABLE_COLUMNS = 'grid grid-cols-[12px_minmax(0,1.6fr)_150px_minmax(0,1fr)_minmax(0,1fr)_32px] items-start gap-3 px-4';

/**
 * Sócios, item próprio do menu (mockup `DesktopSocios`; desktop-mvp-plan Fases 13.7 e 13.10).
 * Regra de negócio (Perfis): sócio só existe em perfil empresarial (database-design §4.2). O menu
 * já esconde o item no perfil pessoal, mas a URL continua alcançável — pelo histórico, ou trocando
 * o perfil com a tela aberta —, e então a tela explica em vez de chamar uma rota que o núcleo
 * recusa.
 *
 * @return A tela de sócios.
 */
export function PartnersScreen(): ReactNode {
    const { profile } = useActiveProfile();
    // Parada no perfil pessoal, que o núcleo recusa: sócio só existe em perfil empresarial.
    const query = usePartners(profile.type === 'business' ? { profileId: profile.id } : null);
    if (profile.type !== 'business') {
        return (
            <>
                <SectionHeader title="Sócios" description="Pessoas com participação num perfil empresarial" />
                <EmptyState title="Só em perfil empresarial" description={`O perfil ${profile.name} é pessoal e não tem sócios.`} />
            </>
        );
    }
    return (
        <>
            <SectionHeader
                title="Sócios"
                description={`Pessoas com participação no perfil ${profile.name}. A soma das participações precisa dar 100%.`}
                actions={
                    <Button asChild variant="outline">
                        <Link to="/reports/partner">Ver relatório por sócio →</Link>
                    </Button>
                }
            />
            <QueryState query={query}>
                {/* A chave remonta o editor quando o que está gravado muda (depois de salvar), para que
                    o formulário recomece do gravado; a contagem de lançamentos fica fora dela, porque
                    não é um campo do formulário. */}
                {(saved) => <PartnersEditor key={`${profile.id}:${saved.map((partner) => `${partner.id}=${partner.name}=${String(partner.percentage)}`).join('|')}`} saved={saved} />}
            </QueryState>
        </>
    );
}

/**
 * O formulário da lista inteira: a divisão, a tabela editável, a soma ao vivo e um "Salvar" para
 * tudo. Regra de negócio (Sócios, decisão de interface 10 dos mockups): a soma precisa dar 100%
 * para salvar, por isso a gravação é da lista inteira, e não sócio a sócio — cada passo
 * intermediário de uma redivisão (60/40 → 50/50) seria recusado.
 * "Aportou" e "Deveria ter aportado" vêm do relatório por sócio e são de todos os períodos
 * (reports-design §8): o total de aportes com sócio dividido pela participação digitada. O mês de
 * referência só é a entrada da rota; nenhum número desta tela depende dele.
 *
 * @param props.saved Sócios gravados, maior participação primeiro.
 * @return O editor.
 */
function PartnersEditor({ saved }: { readonly saved: readonly PartnerResponse[] }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const report = usePartnerReport({ profileId: profile.id, period });
    const save = useCoreMutation('partners.save');
    const [draft, setDraft] = useState<readonly PartnerDraftRow[]>(() => draftFromPartners(saved));
    const [error, setError] = useState<string | null>(null);
    const nextKey = useRef(0);
    const view = buildPartnerRosterView({ draft, saved, report: report.data });

    /**
     * @param key Linha alterada.
     * @param patch Campo novo da linha.
     * @return void
     */
    const update = (key: string, patch: Partial<Pick<PartnerDraftRow, 'name' | 'percentage'>>): void => {
        setDraft((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    };

    /**
     * Sócio novo entra com 0%, como no mockup: a soma continua dizendo quanto falta, e o usuário
     * redistribui as participações antes de salvar.
     *
     * @param name Nome digitado, já aparado e não vazio.
     * @return void
     */
    const add = (name: string): void => {
        nextKey.current += 1;
        const key = `novo-${String(nextKey.current)}`;
        setDraft((rows) => [...rows, { key, id: null, name, percentage: '0' }]);
    };

    /**
     * @return Promessa resolvida quando a lista foi gravada ou o erro apareceu.
     */
    const submit = async (): Promise<void> => {
        if (!view.canSave) {
            return;
        }
        setError(null);
        try {
            await save.mutateAsync(toSavePartnersInput(draft, profile.id));
            toast.success('Sócios salvos.');
        } catch (rejection) {
            reportRejection(rejection, {}, () => undefined, setError);
        }
    };

    return (
        <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <DivisionCard view={view} />
            <section aria-label="Lista de sócios" className="overflow-hidden rounded-10 border border-line bg-surface">
                <div className={cn(TABLE_COLUMNS, 'items-center border-b border-line bg-surface2 py-3 text-12 text-muted')}>
                    <span />
                    <span>Nome</span>
                    <span className="text-right">Participação</span>
                    <span className="text-right">Aportou</span>
                    <span className="text-right">Deveria ter aportado</span>
                    <span />
                </div>
                {view.rows.map((row, index) => {
                    const entry = draft[index];
                    return entry === undefined ? null : (
                        <PartnerRow
                            key={row.key}
                            row={row}
                            entry={entry}
                            position={index + 1}
                            onChange={(patch) => {
                                update(row.key, patch);
                            }}
                            onRemove={() => {
                                setDraft((rows) => rows.filter((candidate) => candidate.key !== row.key));
                            }}
                        />
                    );
                })}
                <NewPartnerRow color={view.nextColor} onAdd={add} />
            </section>
            <StatusBox view={view} />
            {view.removedWarning !== null && <p className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">{view.removedWarning}</p>}
            <p className="rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">
                “Deveria ter aportado” divide o total de aportes com sócio, de todos os períodos (<span className="tabular-nums">{view.base}</span>), pela participação. Receitas
                sem sócio, como as de serviço, ficam fora da divisão.
            </p>
            {error !== null && (
                <p role="alert" className="text-13 text-danger">
                    {error}
                </p>
            )}
            <div className="flex items-center justify-end gap-2.5">
                <Button
                    type="button"
                    variant="outline"
                    disabled={!view.dirty || save.isPending}
                    onClick={() => {
                        setDraft(draftFromPartners(saved));
                        setError(null);
                    }}
                >
                    Descartar alterações
                </Button>
                <Button type="submit" disabled={!view.canSave || save.isPending}>
                    {save.isPending ? 'Salvando…' : 'Salvar'}
                </Button>
            </div>
        </form>
    );
}

/**
 * Quadro "Divisão" do mockup: a soma ao vivo, a barra com a parte de cada sócio e a legenda. A
 * barra é uma imagem com descrição, porque a legenda ao lado já diz os mesmos números em texto.
 *
 * @param props.view Cadastro montado.
 * @return O quadro.
 */
function DivisionCard({ view }: { readonly view: PartnerRosterView }): ReactNode {
    return (
        <section aria-label="Divisão da participação" className="flex flex-col gap-3 rounded-10 border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
                <h3 className="text-16 font-semibold">Divisão</h3>
                <span aria-live="polite" className="text-14 tabular-nums">
                    {view.sumLabel}
                </span>
            </div>
            <div role="img" aria-label={view.barLabel === '' ? 'Nenhum sócio' : view.barLabel} className="flex h-3.5 overflow-hidden rounded-full bg-track">
                {view.segments.map((segment) => (
                    <div key={segment.key} className={cn('h-full', PARTNER_COLORS[segment.color])} style={{ width: `${String(segment.width)}%` }} />
                ))}
            </div>
            {view.rows.length > 0 && (
                <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-13">
                    {view.rows.map((row) => (
                        <li key={row.key} className="flex items-center gap-2">
                            <span aria-hidden="true" className={cn('size-3 rounded-3', PARTNER_COLORS[row.color])} />
                            {row.label} <span className="text-muted tabular-nums">{row.share}</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * Uma linha editável da tabela: nome, participação, o que aportou e deveria ter aportado, e remover.
 * Remover só tira a linha do formulário; nada sai do banco antes de "Salvar", e o aviso abaixo da
 * tabela diz quantos lançamentos ficam sem sócio.
 *
 * @param props.row Linha montada, com os valores e os erros.
 * @param props.entry Linha do formulário, com o texto dos campos.
 * @param props.position Posição na lista, para o rótulo do leitor de tela ("Nome do sócio 2").
 * @param props.onChange Troca o nome ou a participação.
 * @param props.onRemove Tira o sócio do formulário.
 * @return A linha.
 */
function PartnerRow({
    row,
    entry,
    position,
    onChange,
    onRemove,
}: {
    readonly row: PartnerRosterRow;
    readonly entry: PartnerDraftRow;
    readonly position: number;
    readonly onChange: (patch: Partial<Pick<PartnerDraftRow, 'name' | 'percentage'>>) => void;
    readonly onRemove: () => void;
}): ReactNode {
    const nameId = `partner-name-${row.key}`;
    const percentageId = `partner-percentage-${row.key}`;
    return (
        <div className={cn(TABLE_COLUMNS, 'border-b border-line2 py-3 text-14')}>
            <span aria-hidden="true" className={cn('mt-3 size-3 rounded-3', PARTNER_COLORS[row.color])} />
            <div className="flex flex-col gap-1">
                <label htmlFor={nameId} className="sr-only">
                    Nome do sócio {position}
                </label>
                <Input
                    id={nameId}
                    maxLength={PARTNER_NAME_MAX_LENGTH}
                    value={entry.name}
                    aria-invalid={row.nameError !== null}
                    aria-describedby={row.nameError === null ? undefined : `${nameId}-error`}
                    onChange={(event) => {
                        onChange({ name: event.target.value });
                    }}
                />
                {row.nameError !== null && (
                    <p id={`${nameId}-error`} className="text-12 text-danger">
                        {row.nameError}
                    </p>
                )}
            </div>
            <div className="flex flex-col gap-1">
                <label htmlFor={percentageId} className="sr-only">
                    Participação de {row.label}
                </label>
                {/* O `%` fica dentro da moldura, como no mockup; a moldura repete o foco e o erro do `Input`. */}
                <div
                    className={cn(
                        'flex h-9 items-center overflow-hidden rounded-8 border border-line shadow-xs transition-[color,box-shadow] focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/50 dark:bg-line/30',
                        row.percentageError !== null && 'border-danger ring-danger/20 dark:ring-danger/40',
                    )}
                >
                    <input
                        id={percentageId}
                        inputMode="decimal"
                        value={entry.percentage}
                        aria-invalid={row.percentageError !== null}
                        aria-describedby={row.percentageError === null ? undefined : `${percentageId}-error`}
                        onChange={(event) => {
                            onChange({ percentage: event.target.value.replace(/[^0-9.,]/g, '') });
                        }}
                        className="h-full w-full min-w-0 bg-transparent pr-1.5 pl-3 text-right text-14 tabular-nums outline-none"
                    />
                    <span aria-hidden="true" className="px-2.5 text-muted">
                        %
                    </span>
                </div>
                {row.percentageError !== null && (
                    <p id={`${percentageId}-error`} className="text-12 text-danger">
                        {row.percentageError}
                    </p>
                )}
            </div>
            <span className="mt-2 text-right tabular-nums">{row.contributed}</span>
            <span className="mt-2 text-right text-muted tabular-nums">{row.expected}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover ${row.label === 'Sem nome' ? 'sócio' : row.label}`} onClick={onRemove} className="mt-0.5 text-muted hover:text-danger">
                <XIcon />
            </Button>
        </div>
    );
}

/**
 * Última linha da tabela, com o nome do sócio novo. É um grupo à parte do formulário principal,
 * e não um `<form>` aninhado (que o HTML não permite): Enter no campo adiciona, em vez de salvar
 * a lista.
 *
 * @param props.color Cor que o sócio novo vai receber.
 * @param props.onAdd Adiciona o sócio ao formulário com 0%.
 * @return A linha de adicionar.
 */
function NewPartnerRow({ color, onAdd }: { readonly color: number; readonly onAdd: (name: string) => void }): ReactNode {
    const [name, setName] = useState('');

    /**
     * @return void
     */
    const add = (): void => {
        const trimmed = name.trim();
        if (trimmed === '') {
            return;
        }
        onAdd(trimmed);
        setName('');
    };

    return (
        <div className={cn(TABLE_COLUMNS, 'items-center bg-surface2 py-3 text-14')}>
            <span aria-hidden="true" className={cn('size-3 rounded-3 opacity-50', PARTNER_COLORS[color])} />
            <div>
                <label htmlFor="partner-new-name" className="sr-only">
                    Nome do novo sócio
                </label>
                <Input
                    id="partner-new-name"
                    maxLength={PARTNER_NAME_MAX_LENGTH}
                    placeholder="Nome do novo sócio"
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            add();
                        }
                    }}
                />
            </div>
            <Button type="button" variant="outline" disabled={name.trim() === ''} onClick={add}>
                + Adicionar
            </Button>
            <span className="col-span-3 text-12 text-muted">Entra com 0%; ajuste a participação de todos.</span>
        </div>
    );
}

/**
 * Quadro da soma abaixo da tabela: verde quando fecha 100%, aviso quando falta ou passa — com o
 * texto dizendo quanto, porque a cor não pode ser o único sinal (decisão de interface 7).
 *
 * @param props.view Cadastro montado.
 * @return O quadro.
 */
function StatusBox({ view }: { readonly view: PartnerRosterView }): ReactNode {
    const { status } = view;
    return (
        <p
            role="status"
            className={cn(
                'rounded-8 px-3 py-2.5 text-13 tabular-nums',
                status.kind === 'ok' && 'bg-ok-bg text-ok-ink',
                status.kind === 'off' && 'bg-warn-bg text-warn-ink',
                status.kind === 'empty' && 'bg-surface2 text-muted ring-1 ring-line',
            )}
        >
            {status.text}
        </p>
    );
}
