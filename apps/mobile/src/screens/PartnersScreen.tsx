import {
    buildPartnerRosterView,
    draftFromPartners,
    formatProfileType,
    PARTNER_NAME_MAX_LENGTH,
    reportRejection,
    toSavePartnersInput,
    useCoreMutation,
    usePartners,
    type PartnerDraftRow,
    type PartnerRosterView,
} from '@finance/client';
import type { PartnerResponse } from '@finance/core';
import { useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, RowInput } from '../ui/form.tsx';
import { Icon } from '../ui/Icon.tsx';
import { EmptyState, QueryView } from '../ui/states.tsx';
import { TextField } from '../ui/TextField.tsx';

/**
 * Cor de cada sócio na barra e na lista, pela posição (`PARTNER_COLOR_COUNT` do `client`), as
 * mesmas do desktop: o sócio tem a mesma cor nas duas telas.
 */
const PARTNER_COLORS: readonly string[] = ['bg-accent', 'bg-out', 'bg-muted', 'bg-dot'];

/** Fundo e texto do aviso da soma, pelo estado: a cor acompanha o texto, nunca o substitui. */
const STATUS_TONE: Readonly<Record<PartnerRosterView['status']['kind'], string>> = {
    ok: 'bg-ok-bg text-ok-ink',
    off: 'bg-warn-bg text-warn-ink',
    empty: 'bg-surface2 text-muted',
};

/**
 * Divisão (mockup `MobileSocios`): a soma ao vivo e a barra com um segmento por sócio, que o
 * leitor de tela lê como uma frase (`barLabel`).
 *
 * @param props.view Estado montado pelo `buildPartnerRosterView`.
 * @return O cartão da divisão.
 */
function Division({ view }: { readonly view: PartnerRosterView }): ReactNode {
    return (
        <View accessibilityLabel="Divisão" className="gap-2.5 rounded-12 border border-line bg-surface p-3.5">
            <View className="flex-row items-center justify-between">
                <AppText className="text-13 text-muted">Soma das participações</AppText>
                <AppText accessibilityLiveRegion="polite" className="font-semibold">{view.sumLabel}</AppText>
            </View>
            <View accessibilityRole="image" accessibilityLabel={view.barLabel === '' ? 'Nenhum sócio' : view.barLabel} className="h-3.5 flex-row overflow-hidden rounded-full bg-track">
                {view.segments.map((segment) => (
                    <View key={segment.key} style={{ width: `${String(segment.width)}%` }} className={`h-full ${PARTNER_COLORS[segment.color] ?? ''}`} />
                ))}
            </View>
        </View>
    );
}

/**
 * Editor dos sócios: as linhas com nome e participação, a de novo sócio, a soma e salvar. O
 * rascunho é local e só vai ao núcleo inteiro, em `partners.save`, porque a soma só fecha em 100%
 * com todas as linhas juntas.
 * Regra de negócio (Sócios, decisão de interface 10): nome até 100 caracteres, participação
 * com soma ao vivo e barra, e salvar só com 100% (`canSave`); remover um sócio com lançamentos
 * deixa esses lançamentos sem sócio, e o aviso diz quantos (`removedWarning`). As regras e as
 * frases são as do desktop, todas do `client`.
 *
 * @param props.saved Sócios gravados, de onde o rascunho começa.
 * @return O editor.
 */
function PartnersEditor({ saved }: { readonly saved: readonly PartnerResponse[] }): ReactNode {
    const { profile } = useActiveProfile();
    const save = useCoreMutation('partners.save');
    const [draft, setDraft] = useState<readonly PartnerDraftRow[]>(() => draftFromPartners(saved));
    const [newName, setNewName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const nextKey = useRef(0);
    const view = buildPartnerRosterView({ draft, saved });

    /**
     * @param key Linha alterada.
     * @param patch Campo novo.
     */
    const update = (key: string, patch: Partial<Pick<PartnerDraftRow, 'name' | 'percentage'>>): void => {
        setDraft((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    };

    /** Acrescenta o novo sócio com 0%, como o desktop: a divisão de todos se ajusta depois. */
    const add = (): void => {
        const trimmed = newName.trim();
        if (trimmed === '') {
            return;
        }
        nextKey.current += 1;
        const key = `novo-${String(nextKey.current)}`;
        setDraft((rows) => [...rows, { key, id: null, name: trimmed, percentage: '0' }]);
        setNewName('');
    };

    /** Grava a divisão inteira, só quando ela fecha em 100%. */
    const submit = (): void => {
        if (!view.canSave) {
            return;
        }
        setError(null);
        save.mutateAsync(toSavePartnersInput(draft, profile.id)).then(
            () => undefined,
            (rejection: unknown) => {
                reportRejection(rejection, {}, () => undefined, setError);
            },
        );
    };

    return (
        <>
            <Division view={view} />
            {view.rows.length > 0 && (
                <FormGroup>
                    {view.rows.map((row, index) => {
                        const entry = draft[index];
                        if (entry === undefined) {
                            return null;
                        }
                        return (
                            <View key={row.key} className={`gap-1 px-3.5 py-2.5 ${index === 0 ? '' : 'border-t border-line2'}`}>
                                <View className="flex-row items-center gap-2.5">
                                    <View className={`h-3 w-3 rounded-full ${PARTNER_COLORS[row.color] ?? ''}`} />
                                    <View className="min-w-0 flex-1">
                                        <RowInput
                                            label={`Nome do sócio ${String(index + 1)}`}
                                            error={row.nameError ?? undefined}
                                            maxLength={PARTNER_NAME_MAX_LENGTH}
                                            value={entry.name}
                                            onChangeText={(name) => {
                                                update(row.key, { name });
                                            }}
                                            className="min-h-11 py-2 text-left font-sans text-15 text-ink"
                                        />
                                    </View>
                                    <View className="w-20 flex-row items-center">
                                        <RowInput
                                            label={`Participação de ${row.label}`}
                                            error={row.percentageError ?? undefined}
                                            keyboardType="decimal-pad"
                                            value={entry.percentage}
                                            onChangeText={(text) => {
                                                update(row.key, { percentage: text.replace(/[^0-9.,]/g, '') });
                                            }}
                                            className="min-h-11 flex-1 py-2 text-right font-sans text-15 text-ink"
                                        />
                                        <AppText className="text-muted">%</AppText>
                                    </View>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Remover ${row.label === 'Sem nome' ? 'sócio' : row.label}`}
                                        onPress={() => {
                                            setDraft((rows) => rows.filter((candidate) => candidate.key !== row.key));
                                        }}
                                        className="h-11 w-11 items-center justify-center rounded-full active:bg-line2"
                                    >
                                        <Icon name="close" tone="muted" />
                                    </Pressable>
                                </View>
                                {row.nameError !== null && <AppText className="text-12 text-danger">{row.nameError}</AppText>}
                                {row.percentageError !== null && <AppText className="text-12 text-danger">{row.percentageError}</AppText>}
                            </View>
                        );
                    })}
                </FormGroup>
            )}
            <TextField label="Nome do novo sócio" placeholder="Novo sócio" maxLength={PARTNER_NAME_MAX_LENGTH} hint="Entra com 0%; ajuste a participação de todos." value={newName} onChangeText={setNewName} onSubmitEditing={add} returnKeyType="done" />
            <Button label="Adicionar" variant="secondary" disabled={newName.trim() === ''} onPress={add} />
            <AppText accessibilityRole="summary" className={`rounded-8 px-3 py-2.5 text-13 ${STATUS_TONE[view.status.kind]}`}>
                {view.status.text}
            </AppText>
            {view.removedWarning !== null && <AppText className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">{view.removedWarning}</AppText>}
            {error !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {error}
                </AppText>
            )}
            <AppText className="text-12 text-muted">Na transação, o campo “Quem pagou” lista estes sócios.</AppText>
            <Button label="Salvar" disabled={!view.canSave} busy={save.isPending} onPress={submit} />
            {view.dirty && (
                <Button
                    label="Descartar alterações"
                    variant="ghost"
                    onPress={() => {
                        setDraft(draftFromPartners(saved));
                        setError(null);
                    }}
                />
            )}
        </>
    );
}

/**
 * Sócios (mockup `MobileSocios`; mobile-mvp-plan, Fase 17), só no perfil empresarial. Aberta pela
 * URL no perfil pessoal — depois de trocar de perfil com a tela na pilha —, explica em vez de
 * chamar a rota que o núcleo recusa, como o desktop.
 *
 * @return A tela.
 */
export function PartnersScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const partners = usePartners(profile.type === 'business' ? { profileId: profile.id } : null);
    const header = (
        <ScreenHeader
            back
            left={
                <View className="min-w-0 flex-1">
                    <AppText accessibilityRole="header" className="text-17 font-semibold">Sócios</AppText>
                    <AppText className="text-12 text-muted" numberOfLines={1}>
                        {profile.name} · {formatProfileType(profile.type)}
                    </AppText>
                </View>
            }
        />
    );
    if (profile.type !== 'business') {
        return (
            <Screen header={header}>
                <EmptyState title="Só em perfil empresarial" body={`O perfil ${profile.name} é pessoal e não tem sócios.`} />
            </Screen>
        );
    }
    return (
        <Screen header={header}>
            <QueryView query={partners} loadingLabel="Abrindo os sócios…">
                {/* A chave remonta o editor quando o gravado muda (depois de salvar), para que o
                    rascunho recomece do que está no núcleo. */}
                {(saved) => <PartnersEditor key={`${profile.id}:${saved.map((partner) => `${partner.id}=${partner.name}=${String(partner.percentage)}`).join('|')}`} saved={saved} />}
            </QueryView>
        </Screen>
    );
}
