import {
    cardProfileId,
    carryOverReview,
    formatMoneyForInput,
    formatProfileSummary,
    importRunInput,
    initialReview,
    parseMoneyInput,
    profileCategories,
    profileShares,
    reviewPending,
    useCoreMutation,
    useCoreQueries,
    useProfiles,
    withAccountProfile,
    type ExistingRegistries,
    type ReviewAccount,
    type ReviewCard,
    type ReviewState,
} from '@finance/client';
import type { AccountListResponse, CategoryBranchResponse, CreditCardListResponse, ImportAnalysis, ImportResponse, ProfileResponse } from '@finance/core';
import type { CoreCallError } from '@finance/client';
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { bridge } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { currentPeriod } from '@/shell/referenceMonth';
import type { FileReading, ReadRows } from './ImportScreen.tsx';
import { ImportCard, NativeSelect, Pill, StepFooter } from './importParts.tsx';
import { formatCount, importButtonLabel, issueText, readProblemText } from './importView.ts';

/** Problemas listados na revisão; o resto vira contagem. */
const LISTED_PROBLEMS = 8;

/** Valor do "Ligar a" que cria a conta ou o cartão. */
const CREATE = 'create';

/**
 * @param results Uma lista de contas por perfil.
 * @return Todas as contas ativas, ou `null` enquanto alguma carrega.
 */
function combineAccounts(results: readonly UseQueryResult<AccountListResponse, CoreCallError>[]): ExistingRegistries['accounts'] | null {
    return results.every((result) => result.data !== undefined) ? results.flatMap((result) => result.data.accounts).filter((account) => !account.disabled) : null;
}

/**
 * @param results Uma lista de cartões por perfil.
 * @return Todos os cartões ativos, ou `null` enquanto algum carrega.
 */
function combineCards(results: readonly UseQueryResult<CreditCardListResponse, CoreCallError>[]): ExistingRegistries['creditCards'] | null {
    return results.every((result) => result.data !== undefined) ? results.flatMap((result) => result.data.creditCards).filter((card) => !card.disabled) : null;
}

/**
 * @param results Uma árvore de categorias por perfil.
 * @return As árvores, na ordem dos perfis, ou `null` enquanto alguma carrega.
 */
function combineTrees(results: readonly UseQueryResult<readonly CategoryBranchResponse[], CoreCallError>[]): readonly (readonly CategoryBranchResponse[])[] | null {
    return results.every((result) => result.data !== undefined) ? results.map((result) => result.data) : null;
}

/**
 * Etapa 3 — Revisar (mockup `DesktopImportRevisar`; import-design §5): perfil de cada conta,
 * contas e cartões a criar ou ligar, categorias por perfil e as opções de séries. O botão
 * Importar fica desabilitado enquanto faltar informação obrigatória.
 *
 * @param props.reading Leitura do arquivo.
 * @param props.read Linhas lidas, enviadas ao núcleo.
 * @param props.analysis Análise do núcleo sobre as linhas.
 * @param props.paymentDateMapped Se o arquivo tem coluna de pagamento — sem ela, aparece o "pagas
 * até hoje".
 * @param props.review Decisões atuais; `null` até a etapa montá-las.
 * @param props.onReview Avisado com as decisões novas.
 * @param props.onBack Volta às colunas.
 * @param props.onDone Avisado com o resumo da importação feita.
 * @return A etapa.
 */
export function ReviewStep({
    reading,
    read,
    analysis,
    paymentDateMapped,
    review,
    onReview,
    onBack,
    onDone,
}: {
    readonly reading: FileReading;
    readonly read: ReadRows;
    readonly analysis: ImportAnalysis;
    readonly paymentDateMapped: boolean;
    readonly review: ReviewState | null;
    readonly onReview: (review: ReviewState) => void;
    readonly onBack: () => void;
    readonly onDone: (outcome: ImportResponse) => void;
}): ReactNode {
    const { profile } = useActiveProfile();
    const profiles = useProfiles({});
    const list = profiles.data ?? [];
    const period = currentPeriod(new Date());
    const accounts = useCoreQueries('accounts.list', list.map((item) => ({ profileId: item.id, period })), combineAccounts);
    const cards = useCoreQueries('creditCards.list', list.map((item) => ({ profileId: item.id, period })), combineCards);
    const treeList = useCoreQueries('categories.tree', list.map((item) => ({ profileId: item.id })), combineTrees);
    const existing = useMemo<ExistingRegistries | null>(() => (accounts === null || cards === null ? null : { accounts, creditCards: cards }), [accounts, cards]);
    const trees = useMemo(() => new Map(list.map((item, index) => [item.id, treeList?.[index] ?? []])), [list, treeList]);
    const [initialized, setInitialized] = useState(false);

    // A revisão é montada ao entrar na etapa, já com os cadastros carregados; ao voltar das colunas,
    // as decisões tomadas antes continuam valendo para o que continua no arquivo.
    useEffect(() => {
        if (initialized || existing === null || profiles.data === undefined) {
            return;
        }
        const fresh = initialReview(analysis, profile.id, existing, review?.options);
        onReview(review === null ? fresh : carryOverReview(review, fresh));
        setInitialized(true);
    }, [initialized, existing, profiles.data, analysis, profile.id, review, onReview]);

    if (!initialized || review === null || existing === null) {
        return <LoadingState label="Preparando a revisão…" />;
    }
    return <ReviewContent reading={reading} read={read} analysis={analysis} paymentDateMapped={paymentDateMapped} review={review} profiles={list} existing={existing} trees={trees} onReview={onReview} onBack={onBack} onDone={onDone} />;
}

/**
 * O conteúdo da revisão, já com as decisões e os cadastros carregados.
 *
 * @param props.reading Leitura do arquivo.
 * @param props.read Linhas lidas.
 * @param props.analysis Análise do núcleo.
 * @param props.paymentDateMapped Se há coluna de pagamento.
 * @param props.review Decisões.
 * @param props.profiles Perfis existentes.
 * @param props.existing Contas e cartões ativos.
 * @param props.trees Categorias de cada perfil.
 * @param props.onReview Avisado com as decisões novas.
 * @param props.onBack Volta às colunas.
 * @param props.onDone Avisado com o resumo.
 * @return A revisão.
 */
function ReviewContent({
    reading,
    read,
    analysis,
    paymentDateMapped,
    review,
    profiles,
    existing,
    trees,
    onReview,
    onBack,
    onDone,
}: {
    readonly reading: FileReading;
    readonly read: ReadRows;
    readonly analysis: ImportAnalysis;
    readonly paymentDateMapped: boolean;
    readonly review: ReviewState;
    readonly profiles: readonly ProfileResponse[];
    readonly existing: ExistingRegistries;
    readonly trees: ReadonlyMap<string, readonly CategoryBranchResponse[]>;
    readonly onReview: (review: ReviewState) => void;
    readonly onBack: () => void;
    readonly onDone: (outcome: ImportResponse) => void;
}): ReactNode {
    const run = useCoreMutation('imports.run');
    const [failure, setFailure] = useState<string | null>(null);
    const [copying, setCopying] = useState(false);
    const [defaultProfile, setDefaultProfile] = useState(review.accounts[0]?.profileId ?? profiles[0]?.id ?? '');
    const profileOptions = profiles.map((item) => ({ value: item.id, label: `${item.name} · ${formatProfileSummary(item)}` }));
    const shares = profileShares(analysis, review, profiles, existing);
    const categories = profileCategories(analysis, review, profiles, existing, trees);
    const pending = reviewPending(review);
    const accepted = analysis.standalone.length + analysis.series.reduce((total, series) => total + series.occurrences.length, 0);
    const fixed = analysis.series.filter((series) => series.kind === 'fixed');
    const installments = analysis.series.filter((series) => series.kind === 'installments');
    const transfers = read.rows.some((row) => row.type === 'transference');
    const lastFixed = fixed.flatMap((series) => series.occurrences.map((item) => item.row.dueDate.toString())).sort().at(-1);
    const problems = [...read.problems.map(readProblemText), ...analysis.issues.map(issueText)];
    const { options } = review;

    /**
     * @param changes Opções a mudar.
     */
    const setOptions = (changes: Partial<ReviewState['options']>): void => {
        onReview({ ...review, options: { ...options, ...changes } });
    };

    /**
     * @param name Conta do arquivo.
     * @param changes Decisão nova.
     */
    const setAccount = (name: string, changes: Partial<ReviewAccount>): void => {
        onReview({ ...review, accounts: review.accounts.map((account) => (account.name === name ? { ...account, ...changes } : account)) });
    };

    /**
     * @param name Cartão do arquivo.
     * @param changes Decisão nova.
     */
    const setCard = (name: string, changes: Partial<ReviewCard>): void => {
        onReview({ ...review, cards: review.cards.map((card) => (card.name === name ? { ...card, ...changes } : card)) });
    };

    /**
     * Exporta a cópia (quando marcada) e importa. Sem a cópia pedida, não importa: o usuário
     * marcou a cópia como caminho de volta (import-design §7).
     */
    const submit = async (): Promise<void> => {
        setFailure(null);
        if (review.exportCopy) {
            setCopying(true);
            const copy = await bridge.database.exportCopy();
            setCopying(false);
            if (!copy.ok) {
                setFailure(copy.reason === 'canceled' ? 'A cópia do banco foi cancelada, e nada foi importado. Escolha onde salvar a cópia ou desmarque a opção.' : 'A cópia do banco falhou, e nada foi importado. Tente outra pasta ou desmarque a opção.');
                return;
            }
        }
        run.mutate(importRunInput(read.rows, review), {
            onSuccess: onDone,
            onError: (error) => {
                setFailure(`Nada foi importado: ${error.message}`);
            },
        });
    };

    return (
        <>
            <div className="flex flex-col gap-1">
                <h1 className="text-24 font-semibold">Revisar antes de importar</h1>
                <span className="text-12 text-muted">
                    {reading.file.name} · {formatCount(accepted)} linhas. Escolha o perfil de cada conta e confira o que será criado.
                </span>
            </div>

            <ImportCard title="Perfil de destino">
                <span className="text-12 text-muted">Os lançamentos vão para o perfil da conta (ou da conta que paga o cartão). Categorias e tags são criadas nesse perfil.</span>
                <div className="flex flex-wrap items-center gap-3 text-13">
                    <span className="text-12 text-muted">Padrão</span>
                    <NativeSelect label="Perfil padrão" value={defaultProfile} options={profileOptions} onChange={setDefaultProfile} />
                    <Button
                        variant="outline"
                        size="sm"
                        className="border-line text-13 font-normal"
                        onClick={() => {
                            onReview(withAccountProfile(review, null, defaultProfile, existing));
                        }}
                    >
                        Aplicar a todas as contas
                    </Button>
                </div>
                <ul aria-label="Divisão das linhas" className="flex flex-wrap gap-6 text-13">
                    {shares.map((share) => (
                        <li key={share.profile.id} className="flex flex-col">
                            <span className="font-medium">{share.profile.name}</span>
                            <span className="tabular-nums">{formatCount(share.rows)} linhas</span>
                            <span className="text-12 text-muted">{share.accounts.length === 0 ? 'nenhuma conta' : share.accounts.join(', ')}</span>
                        </li>
                    ))}
                </ul>
            </ImportCard>

            <section aria-label="Resumo" className="grid grid-cols-4 gap-3">
                <Kpi label="Lançamentos avulsos" value={formatCount(analysis.standalone.length)} note={options.groupSeries ? 'linhas sem série' : 'toda linha avulsa'} />
                <Kpi label="Recorrências fixas" value={formatCount(fixed.length)} note={`a partir de ${formatCount(fixed.reduce((total, series) => total + series.occurrences.length, 0))} linhas`} />
                <Kpi label="Parcelamentos" value={formatCount(installments.length)} note={`a partir de ${formatCount(installments.reduce((total, series) => total + series.occurrences.length, 0))} parcelas`} />
                <Kpi label="Situação" value={`${formatCount(analysis.paid)} pagas`} note={`${formatCount(analysis.pending)} pendentes`} />
            </section>

            <ImportCard title="Contas" aside={`${String(review.accounts.length)} no arquivo · ${String(review.accounts.filter((account) => account.linkTo !== null).length)} já existem`}>
                <table className="w-full text-13">
                    <thead>
                        <tr className="text-left text-12 text-muted">
                            <th className="py-1 font-normal">No arquivo</th>
                            <th className="py-1 text-right font-normal">Linhas</th>
                            <th className="py-1 pl-4 font-normal">Perfil</th>
                            <th className="py-1 font-normal">Ligar a</th>
                            <th className="py-1 font-normal">Tipo</th>
                            <th className="py-1 font-normal">No saldo total</th>
                        </tr>
                    </thead>
                    <tbody className="tabular-nums">
                        {review.accounts.map((account) => {
                            const linkable = existing.accounts.filter((item) => item.profileId === account.profileId);
                            return (
                                <tr key={account.name} className="border-t border-line2">
                                    <td className="py-2 font-medium">{account.name}</td>
                                    <td className="py-2 text-right">{formatCount(account.rows)}</td>
                                    <td className="py-2 pl-4">
                                        <NativeSelect
                                            label={`Perfil de ${account.name}`}
                                            value={account.profileId}
                                            options={profileOptions}
                                            onChange={(profileId) => {
                                                onReview(withAccountProfile(review, account.name, profileId, existing));
                                            }}
                                        />
                                    </td>
                                    <td className="py-2">
                                        <NativeSelect
                                            label={`Ligar ${account.name} a`}
                                            value={account.linkTo ?? CREATE}
                                            options={[{ value: CREATE, label: `+ Criar “${account.name}”` }, ...linkable.map((item) => ({ value: item.id, label: item.name }))]}
                                            onChange={(value) => {
                                                setAccount(account.name, { linkTo: value === CREATE ? null : value });
                                            }}
                                        />
                                    </td>
                                    <td className="py-2">
                                        {account.linkTo === null ? (
                                            <NativeSelect
                                                label={`Tipo de ${account.name}`}
                                                value={account.type}
                                                options={[{ value: 'checking', label: 'Corrente' }, { value: 'investment', label: 'Investimentos' }]}
                                                onChange={(type) => {
                                                    setAccount(account.name, { type });
                                                }}
                                            />
                                        ) : (
                                            <span className="text-muted">—</span>
                                        )}
                                    </td>
                                    <td className="py-2">
                                        {account.linkTo === null ? (
                                            <label className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    className="accent-accent"
                                                    checked={account.considerBalance}
                                                    onChange={(event) => {
                                                        setAccount(account.name, { considerBalance: event.target.checked });
                                                    }}
                                                />
                                                Sim
                                            </label>
                                        ) : (
                                            <span className="text-muted">—</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <span className="text-12 text-muted">“Ligar a” mostra só as contas ativas do perfil escolhido. Saldo inicial das contas novas: zero.</span>
            </ImportCard>

            {review.cards.length > 0 && (
                <ImportCard title="Cartões de crédito" aside="O cartão fica no perfil da conta que paga a fatura">
                    <table className="w-full text-13">
                        <thead>
                            <tr className="text-left text-12 text-muted">
                                <th className="py-1 font-normal">No arquivo</th>
                                <th className="py-1 text-right font-normal">Linhas</th>
                                <th className="py-1 pl-4 font-normal">Paga com</th>
                                <th className="py-1 font-normal">Perfil</th>
                                <th className="py-1 font-normal">Ligar a</th>
                                <th className="py-1 font-normal">Vencimento</th>
                                <th className="py-1 font-normal">Fechamento *</th>
                                <th className="py-1 font-normal">Limite</th>
                            </tr>
                        </thead>
                        <tbody className="tabular-nums">
                            {review.cards.map((card) => {
                                const profileId = cardProfileId(review, card, existing);
                                const owner = profiles.find((item) => item.id === profileId);
                                const linkable = existing.creditCards.filter((item) => item.profileId === profileId);
                                const created = card.linkTo === null;
                                const currency = owner?.currency ?? 'BRL';
                                return (
                                    <tr key={card.name} className="border-t border-line2">
                                        <td className="py-2 font-medium">{card.name}</td>
                                        <td className="py-2 text-right">{formatCount(card.rows)}</td>
                                        <td className="py-2 pl-4">
                                            {created ? (
                                                <NativeSelect
                                                    label={`Conta que paga ${card.name}`}
                                                    value={card.payingAccount}
                                                    options={review.accounts.map((account) => ({ value: account.name, label: account.name }))}
                                                    onChange={(payingAccount) => {
                                                        setCard(card.name, { payingAccount });
                                                    }}
                                                />
                                            ) : (
                                                <span className="text-muted">a do cartão ligado</span>
                                            )}
                                        </td>
                                        <td className="py-2">
                                            <span className="flex flex-col">
                                                <span>{owner?.name ?? '—'}</span>
                                                <span className="text-12 text-muted">{created ? 'segue a conta pagadora' : 'perfil do cartão'}</span>
                                            </span>
                                        </td>
                                        <td className="py-2">
                                            <NativeSelect
                                                label={`Ligar ${card.name} a`}
                                                value={card.linkTo ?? CREATE}
                                                options={[{ value: CREATE, label: `+ Criar cartão “${card.name}”` }, ...linkable.map((item) => ({ value: item.id, label: item.name }))]}
                                                onChange={(value) => {
                                                    setCard(card.name, { linkTo: value === CREATE ? null : value });
                                                }}
                                            />
                                        </td>
                                        <td className="py-2">
                                            <span className="flex flex-col">
                                                <span>dia {String(card.dueDay)}</span>
                                                <span className="text-12 text-muted">pelas datas do arquivo</span>
                                            </span>
                                        </td>
                                        <td className="py-2">
                                            {created ? (
                                                <span className="flex flex-col gap-0.5">
                                                    <DayInput
                                                        label={`Dia de fechamento de ${card.name}`}
                                                        value={card.closingDay}
                                                        onChange={(closingDay) => {
                                                            setCard(card.name, { closingDay });
                                                        }}
                                                    />
                                                    {card.closingSuggestion !== null && card.closingDay === null && (
                                                        <button
                                                            type="button"
                                                            className="text-left text-12 text-accent hover:text-soft-ink"
                                                            onClick={() => {
                                                                setCard(card.name, { closingDay: card.closingSuggestion });
                                                            }}
                                                        >
                                                            provável: dia {String(card.closingSuggestion)}
                                                        </button>
                                                    )}
                                                </span>
                                            ) : (
                                                <span className="text-muted">—</span>
                                            )}
                                        </td>
                                        <td className="py-2">
                                            {created ? (
                                                <Input
                                                    aria-label={`Limite de ${card.name}`}
                                                    inputMode="decimal"
                                                    placeholder="opcional"
                                                    className="h-9 w-28 text-right"
                                                    defaultValue={card.limit === 0 ? '' : formatMoneyForInput({ amount: card.limit, currency })}
                                                    onBlur={(event) => {
                                                        const parsed = parseMoneyInput(event.target.value, currency);
                                                        setCard(card.name, { limit: parsed.ok && parsed.amount > 0 ? parsed.amount : 0 });
                                                    }}
                                                />
                                            ) : (
                                                <span className="text-muted">—</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {review.cards.some((card) => card.linkTo === null && card.closingDay === null) && (
                        <div className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">
                            Informe o <b>dia de fechamento</b> dos cartões novos. O arquivo não traz essa informação, e ela converte o vencimento de cada compra na fatura certa.
                        </div>
                    )}
                </ImportCard>
            )}

            <div className="grid grid-cols-2 items-start gap-4">
                <ImportCard title="Categorias por perfil">
                    {categories.length === 0 && <span className="text-12 text-muted">Nenhuma categoria a importar.</span>}
                    {categories.map((group) => (
                        <div key={group.profile.id} className="flex flex-col gap-2">
                            <span className="text-13 font-medium">{group.profile.name}</span>
                            {group.existing.length > 0 && (
                                <div className="flex flex-col gap-1">
                                    <span className="text-12 text-muted">Já existem ({String(group.existing.length)})</span>
                                    <div className="flex flex-wrap gap-1">
                                        {group.existing.map((label) => (
                                            <Pill key={label} tone="ok">
                                                {label}
                                            </Pill>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {group.created.length > 0 && (
                                <div className="flex flex-col gap-1">
                                    <span className="text-12 text-muted">Serão criadas ({String(group.created.length)})</span>
                                    <div className="flex flex-wrap gap-1">
                                        {group.created.map((label) => (
                                            <Pill key={label} tone="neutral">
                                                {label}
                                            </Pill>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                    <span className="text-12 text-muted">A mesma categoria usada em contas de perfis diferentes é criada em cada perfil.</span>
                </ImportCard>

                <ImportCard title="Recorrências e detalhes">
                    <fieldset className="flex flex-col gap-2 text-13">
                        <legend className="mb-1 text-12 text-muted">Linhas da mesma série (mesmo nome, conta e recorrência)</legend>
                        <Option
                            type="radio"
                            name="import-series"
                            checked={options.groupSeries}
                            onChange={() => {
                                setOptions({ groupSeries: true });
                            }}
                            title="Agrupar numa recorrência do app"
                            note={`${formatCount(fixed.length)} fixas e ${formatCount(installments.length)} parcelamentos. Editar depois pergunta o escopo, como num lançamento feito no app.`}
                        />
                        <Option
                            type="radio"
                            name="import-series"
                            checked={!options.groupSeries}
                            onChange={() => {
                                setOptions({ groupSeries: false });
                            }}
                            title="Importar cada linha como lançamento avulso"
                            note={`${formatCount(accepted)} lançamentos independentes`}
                        />
                    </fieldset>
                    <div className="flex flex-col gap-2 border-t border-line2 pt-3 text-13">
                        {options.groupSeries && (
                            <Option
                                type="checkbox"
                                checked={options.keepFutureOccurrences}
                                onChange={(checked) => {
                                    setOptions({ keepFutureOccurrences: checked });
                                }}
                                title="Manter as ocorrências futuras do arquivo"
                                note={`${lastFixed === undefined ? 'Sem séries fixas no arquivo.' : `As séries fixas vão até ${lastFixed.slice(5, 7)}/${lastFixed.slice(0, 4)} no arquivo.`} Desmarcado: o app gera 12 meses à frente.${analysis.droppedFuture > 0 ? ` ${formatCount(analysis.droppedFuture)} ocorrências ficam de fora.` : ''}`}
                            />
                        )}
                        <Option
                            type="checkbox"
                            checked={options.hashtagsAsTags}
                            onChange={(checked) => {
                                setOptions({ hashtagsAsTags: checked });
                            }}
                            title="Transformar #palavras das observações em tags"
                            note={analysis.hashtags.rows === 0 ? 'Nenhuma #palavra no arquivo.' : `${formatCount(analysis.hashtags.rows)} ${analysis.hashtags.rows === 1 ? 'linha' : 'linhas'}: ${analysis.hashtags.names.map((name) => `#${name}`).join(', ')}`}
                        />
                        {!paymentDateMapped && (
                            <Option
                                type="checkbox"
                                checked={options.pastDueAsPaid}
                                onChange={(checked) => {
                                    setOptions({ pastDueAsPaid: checked });
                                }}
                                title="Considerar pagas as que vencem até hoje"
                                note="O arquivo não tem data de pagamento. Marcado, cada linha vencida é paga no próprio vencimento; desmarcado, todo o histórico fica pendente."
                            />
                        )}
                    </div>
                    {transfers && (
                        <div className="flex flex-col gap-1.5 border-t border-line2 pt-3 text-13">
                            <span className="text-12 text-muted">Categoria das transferências (criada no perfil de origem quando falta)</span>
                            <div className="flex gap-2">
                                <Input
                                    aria-label="Categoria das transferências"
                                    className="h-9"
                                    value={review.transferCategory.category}
                                    onChange={(event) => {
                                        onReview({ ...review, transferCategory: { ...review.transferCategory, category: event.target.value } });
                                    }}
                                />
                                <Input
                                    aria-label="Subcategoria das transferências"
                                    className="h-9"
                                    value={review.transferCategory.subCategory}
                                    onChange={(event) => {
                                        onReview({ ...review, transferCategory: { ...review.transferCategory, subCategory: event.target.value } });
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </ImportCard>
            </div>

            {problems.length > 0 && (
                <ImportCard title="Linhas que ficam de fora" aside={`${formatCount(problems.length)} com problema`}>
                    <ul className="flex flex-col gap-0.5 text-13 text-warn-ink">
                        {problems.slice(0, LISTED_PROBLEMS).map((text) => (
                            <li key={text}>{text}</li>
                        ))}
                        {problems.length > LISTED_PROBLEMS && <li>e mais {formatCount(problems.length - LISTED_PROBLEMS)}.</li>}
                    </ul>
                </ImportCard>
            )}

            <section aria-label="Cópia antes de importar" className="rounded-10 border border-line bg-surface px-5 py-4 text-13">
                <Option
                    type="checkbox"
                    checked={review.exportCopy}
                    onChange={(checked) => {
                        onReview({ ...review, exportCopy: checked });
                    }}
                    title="Exportar uma cópia do banco antes de importar"
                    note="Não há backup em nuvem. Com a cópia, dá para voltar ao estado de antes. Importar o mesmo arquivo de novo duplica os lançamentos."
                />
            </section>

            {failure !== null && (
                <p role="alert" className="text-13 text-danger">
                    {failure}
                </p>
            )}

            <StepFooter
                back={
                    <Button variant="outline" className="border-line text-13 font-normal" onClick={onBack} disabled={run.isPending || copying}>
                        ‹ Voltar às colunas
                    </Button>
                }
            >
                {pending.length > 0 && <span className="text-12 text-muted">Falta: {pending.join(', ')}</span>}
                <Button
                    disabled={pending.length > 0 || accepted === 0 || run.isPending || copying}
                    onClick={() => {
                        void submit();
                    }}
                >
                    {copying ? 'Exportando a cópia…' : run.isPending ? 'Importando…' : importButtonLabel(accepted)}
                </Button>
            </StepFooter>
        </>
    );
}

/**
 * Indicador da linha de resumo.
 *
 * @param props.label Rótulo.
 * @param props.value Número principal.
 * @param props.note Explicação abaixo.
 * @return O indicador.
 */
function Kpi({ label, value, note }: { readonly label: string; readonly value: string; readonly note: string }): ReactNode {
    return (
        <div className="flex flex-col gap-1 rounded-10 border border-line bg-surface px-4 py-3.5">
            <span className="text-12 text-muted">{label}</span>
            <span className="text-22 font-semibold tabular-nums">{value}</span>
            <span className="text-12 text-muted tabular-nums">{note}</span>
        </div>
    );
}

/**
 * Opção com título e explicação, como as do mockup.
 *
 * @param props.type Rádio ou caixa de seleção.
 * @param props.name Grupo do rádio.
 * @param props.checked Se está marcada.
 * @param props.onChange Avisado com o estado novo.
 * @param props.title Texto principal.
 * @param props.note Explicação.
 * @return A opção.
 */
function Option({
    type,
    name,
    checked,
    onChange,
    title,
    note,
}: {
    readonly type: 'radio' | 'checkbox';
    readonly name?: string;
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
    readonly title: string;
    readonly note: string;
}): ReactNode {
    return (
        <label className="flex items-start gap-2.5">
            <input
                type={type}
                name={name}
                checked={checked}
                className="mt-1 accent-accent"
                onChange={(event) => {
                    onChange(event.target.checked);
                }}
            />
            <span className="flex flex-col">
                <span>{title}</span>
                <span className="text-12 text-muted">{note}</span>
            </span>
        </label>
    );
}

/**
 * Campo de dia do mês (1–31), vazio enquanto não informado.
 *
 * @param props.label Rótulo para leitores de tela.
 * @param props.value Dia; `null` vazio.
 * @param props.onChange Avisado com o dia, ou `null` quando o texto não é um dia válido.
 * @return O campo, com a borda de atenção enquanto vazio.
 */
function DayInput({ label, value, onChange }: { readonly label: string; readonly value: number | null; readonly onChange: (day: number | null) => void }): ReactNode {
    return (
        <Input
            aria-label={label}
            aria-invalid={value === null}
            inputMode="numeric"
            placeholder="dia"
            className={cn('h-9 w-20', value === null && 'border-warn-ink')}
            value={value === null ? '' : String(value)}
            onChange={(event) => {
                const day = Number(event.target.value);
                onChange(/^\d{1,2}$/.test(event.target.value) && day >= 1 && day <= 31 ? day : null);
            }}
        />
    );
}
