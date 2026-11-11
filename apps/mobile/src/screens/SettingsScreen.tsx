import { formatSchemaVersion, importResultMessage, lastExportText, THEME_OPTIONS, type ThemePreference } from '@finance/client';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { appVersions } from '../platform/appVersions.ts';
import { pickDatabaseCopy, shareFile } from '../platform/sharing.ts';
import { useDevicePreferences } from '../preferences/devicePreferences.tsx';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { ROUTES } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useStartupControls } from '../startup/StartupGate.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormSection, Segmented } from '../ui/form.tsx';
import { MenuGroup, MenuRow } from '../ui/menu.tsx';
import { Sheet } from '../ui/Sheet.tsx';

/** O tema nas três escolhas do mockup, com os rótulos curtos que cabem na linha. */
const THEMES = THEME_OPTIONS.map((option) => ({ value: option.value, label: option.value === 'system' ? 'Sistema' : option.label }));

/**
 * Aviso da importação (mobile-mvp-plan §3): a cópia é uma ponte de teste, não sincronização.
 * Regra de negócio (Cópia do banco): ela substitui o banco do celular inteiro, e depois disso os
 * dois bancos divergem a cada escrita — a tela diz isso com todas as letras antes de abrir o
 * seletor.
 */
const IMPORT_WARNING =
    'A cópia substitui todos os dados deste celular; o banco atual é guardado antes, em backups. Não é sincronização: depois da importação, o que for lançado aqui não chega ao computador, nem o contrário.';

/**
 * Linha só de leitura (versões): rótulo à esquerda, valor à direita.
 *
 * @param props.label Rótulo.
 * @param props.value Valor.
 * @param props.first Se é a primeira do grupo.
 * @return A linha.
 */
function InfoRow({ label, value, first = false }: { readonly label: string; readonly value: string; readonly first?: boolean }): ReactNode {
    return (
        <View className={`min-h-12.5 flex-row items-center justify-between gap-3 px-3.5 ${first ? '' : 'border-t border-line2'}`}>
            <AppText className="text-muted">{label}</AppText>
            <AppText>{value}</AppText>
        </View>
    );
}

/**
 * Ajustes (mockup `MobileAjustes`; mobile-mvp-plan, Fase 18): o tema, o perfil, a cópia dos dados
 * — exportar, importar e a data da última cópia —, relatar problema e as versões do app, do núcleo
 * e do banco. Diverge do mockup em três linhas: sem "Bloquear com biometria" (fora do MVP), sem
 * "Lembrete de exportação" (descartado, §5.1) e com "Importar cópia do banco" e "Relatar
 * problema", que o plano pede e o mockup não desenha.
 *
 * Exportar grava a cópia num temporário (`VACUUM INTO`), abre a folha de compartilhamento e apaga
 * o temporário (mobile-shell-design §6.2); a data fica nas preferências do aparelho. Importar
 * confere a cópia, troca o banco e reabre o núcleo; a frase do resultado vem do `client`, a mesma
 * do desktop, e o `StartupGate` a mostra por cima do app reaberto.
 *
 * @return A tela.
 */
export function SettingsScreen(): ReactNode {
    const { preferences, update } = useDevicePreferences();
    const { profile } = useActiveProfile();
    const { schemaVersion, copies, restart } = useStartupControls();
    const router = useRouter();
    const versions = appVersions();
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState<'export' | 'import' | 'report' | null>(null);
    const [confirmImport, setConfirmImport] = useState(false);

    /** Exporta a cópia, abre a folha de compartilhamento e apaga o temporário. */
    const exportCopy = (): void => {
        if (copies === null) {
            setMessage('O banco não está aberto agora. Feche e abra o app para exportar a cópia.');
            return;
        }
        setMessage(null);
        setBusy('export');
        const exported = copies.exportCopy();
        if (!exported.ok) {
            setBusy(null);
            setMessage('Não foi possível gravar a cópia. Confira se há espaço no aparelho e tente de novo.');
            return;
        }
        shareFile(exported.uri, 'application/x-sqlite3', 'Exportar cópia do banco')
            .then((outcome) => {
                if (outcome === 'unavailable') {
                    setMessage('Este aparelho não tem como compartilhar arquivos.');
                    return;
                }
                update({ lastExportAt: new Date().toISOString() });
            })
            .catch(() => {
                setMessage('A folha de compartilhamento fechou sem enviar a cópia. Tente de novo.');
            })
            .finally(() => {
                copies.discard(exported.uri);
                setBusy(null);
            });
    };

    /** Abre o seletor, confere a cópia e, se ela entrou, reabre o núcleo com a frase do resultado. */
    const importCopy = (): void => {
        setConfirmImport(false);
        if (copies === null) {
            setMessage('O banco não está aberto agora. Feche e abra o app para importar a cópia.');
            return;
        }
        setMessage(null);
        setBusy('import');
        pickDatabaseCopy()
            .then((picked) => {
                if (picked === null) {
                    return;
                }
                const { result, closed } = copies.importCopy(picked.uri, picked.name);
                const text = importResultMessage(result);
                if (closed) {
                    restart(text);
                } else {
                    setMessage(text);
                }
            })
            .catch(() => {
                setMessage('Não foi possível abrir o arquivo escolhido. Nada foi alterado.');
            })
            .finally(() => {
                setBusy(null);
            });
    };

    /** Compartilha o log do app, para relatar um problema. */
    const report = (): void => {
        const logUri = copies?.logUri() ?? null;
        if (logUri === null) {
            setMessage('Ainda não há registro do app para enviar.');
            return;
        }
        setMessage(null);
        setBusy('report');
        shareFile(logUri, 'text/plain', 'Relatar problema')
            .then((outcome) => {
                if (outcome === 'unavailable') {
                    setMessage('Este aparelho não tem como compartilhar arquivos.');
                }
            })
            .catch(() => {
                setMessage('A folha de compartilhamento fechou sem enviar o registro. Tente de novo.');
            })
            .finally(() => {
                setBusy(null);
            });
    };

    return (
        <Screen header={<ScreenHeader title="Ajustes" back />}>
            {message !== null && (
                <AppText accessibilityRole="alert" className="rounded-8 bg-surface2 px-3 py-2.5 text-13 text-ink2">
                    {message}
                </AppText>
            )}
            <FormSection>Aparência</FormSection>
            <Segmented
                label="Tema"
                options={THEMES}
                value={preferences.theme}
                onChange={(theme: ThemePreference) => {
                    update({ theme });
                }}
            />
            <FormSection>Perfil</FormSection>
            <MenuGroup>
                <MenuRow
                    first
                    label="Perfil atual"
                    trailing={profile.name}
                    onPress={() => {
                        router.push(ROUTES.profiles);
                    }}
                />
                <MenuRow
                    label="Moeda"
                    trailing={profile.currency}
                    onPress={() => {
                        router.push(ROUTES.profiles);
                    }}
                />
            </MenuGroup>
            <FormSection>Cópia dos dados</FormSection>
            <MenuGroup>
                <MenuRow first label={busy === 'export' ? 'Exportando…' : 'Exportar cópia do banco'} detail={lastExportText(preferences.lastExportAt)} onPress={exportCopy} />
                <MenuRow
                    label={busy === 'import' ? 'Importando…' : 'Importar cópia do banco'}
                    detail="Substitui os dados deste celular"
                    onPress={() => {
                        setConfirmImport(true);
                    }}
                />
            </MenuGroup>
            <FormSection>Ajuda</FormSection>
            <MenuGroup>
                <MenuRow first label={busy === 'report' ? 'Abrindo…' : 'Relatar problema'} detail="Envia o registro do app pela folha de compartilhamento" onPress={report} />
            </MenuGroup>
            <FormSection>Sobre</FormSection>
            <FormGroup>
                <InfoRow first label="Versão do app" value={versions.app} />
                <InfoRow label="Versão do núcleo" value={versions.core} />
                <InfoRow label="Versão do banco de dados" value={formatSchemaVersion(schemaVersion)} />
            </FormGroup>
            {confirmImport && (
                <Sheet
                    open
                    title="Importar cópia do banco?"
                    onClose={() => {
                        setConfirmImport(false);
                    }}
                >
                    <AppText className="text-ink2">{IMPORT_WARNING}</AppText>
                    <Button label="Escolher a cópia" variant="danger" onPress={importCopy} />
                    <Button
                        label="Cancelar"
                        variant="secondary"
                        onPress={() => {
                            setConfirmImport(false);
                        }}
                    />
                </Sheet>
            )}
        </Screen>
    );
}
