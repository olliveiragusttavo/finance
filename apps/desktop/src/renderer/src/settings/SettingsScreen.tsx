import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { bridge } from '@/lib/bridge';
import { useDevicePreferences } from '@/lib/devicePreferences';
import type { AppInfo } from '../../../shared/bridge.ts';
import { exportFailureMessage, formatSchemaVersion, lastExportText, SHORTCUT_GUIDE, THEME_OPTIONS } from './settingsView.ts';

/**
 * Chave do cache das informações do app. Não é rota do núcleo — vem do processo principal —, e
 * por isso fica fora das chaves do `client` e do mapa de invalidação: só a exportação a muda.
 */
const APP_INFO_KEY = ['device', 'appInfo'] as const;

/**
 * Ajustes (desktop-mvp-plan Fase 13; mockup `DesktopAjustes`): tema, cópia dos dados, atalhos e
 * versões. **Decisões:** sem a seção "Perfil atual" do mockup — o perfil se edita só em
 * Cadastros › Perfis, num lugar só —, e sem o "Lembrete de exportação". O mês de referência
 * fica escondido, como em toda tela de configuração (Fase 4).
 *
 * @return A tela de Ajustes.
 */
export function SettingsScreen(): ReactNode {
    const info = useQuery({ queryKey: APP_INFO_KEY, queryFn: () => bridge.about.info() });
    return (
        <div className="flex max-w-220 flex-col gap-5">
            <h1 className="text-24 font-semibold">Ajustes</h1>
            <AppearanceSection />
            <DataCopySection info={info.data} />
            <ShortcutsSection />
            <SettingsCard title="Sobre" titleHidden>
                <SettingRow label="Versão do app">
                    <InfoValue value={info.data?.appVersion} />
                </SettingRow>
                <SettingRow label="Versão do banco de dados" description="Esquema do arquivo SQLite, que muda quando uma atualização migra o banco.">
                    <InfoValue value={info.data === undefined ? undefined : formatSchemaVersion(info.data.schemaVersion)} />
                </SettingRow>
            </SettingsCard>
        </div>
    );
}

/**
 * Tema do aparelho, o mesmo do menu da barra superior: as duas entradas gravam a mesma
 * preferência, então mudar aqui muda o rótulo de lá na hora.
 *
 * @return A seção "Aparência".
 */
function AppearanceSection(): ReactNode {
    const { preferences, update } = useDevicePreferences();
    return (
        <SettingsCard title="Aparência">
            <div className="flex items-center justify-between gap-4 px-5 py-3.5 text-14">
                <span id="settings-theme">Tema</span>
                <span role="radiogroup" aria-labelledby="settings-theme" className="flex items-center gap-4.5">
                    {THEME_OPTIONS.map((option) => (
                        <label key={option.value} className="flex items-center gap-1.5">
                            <input
                                type="radio"
                                name="theme"
                                value={option.value}
                                checked={preferences.theme === option.value}
                                className="accent-accent"
                                onChange={() => {
                                    update({ theme: option.value });
                                }}
                            />
                            {option.label}
                        </label>
                    ))}
                </span>
            </div>
        </SettingsCard>
    );
}

/**
 * Exportar a cópia do banco e onde está o arquivo. A falha fica escrita na linha, e não num
 * aviso que some: ela diz o que fazer, e o usuário precisa dela enquanto escolhe outra pasta.
 *
 * @param props.info Informações do app; `undefined` enquanto carregam.
 * @return A seção "Cópia dos dados".
 */
function DataCopySection({ info }: { readonly info: AppInfo | undefined }): ReactNode {
    const queryClient = useQueryClient();
    const [failure, setFailure] = useState<string | null>(null);
    const exportCopy = useMutation({
        mutationFn: () => bridge.database.exportCopy(),
        onMutate: () => {
            setFailure(null);
        },
        onSuccess: async (result) => {
            if (result.ok) {
                toast.success(`Cópia salva em ${result.file}.`);
                await queryClient.invalidateQueries({ queryKey: APP_INFO_KEY });
            } else {
                setFailure(exportFailureMessage(result.reason));
            }
        },
        onError: () => {
            setFailure(exportFailureMessage('write-failed'));
        },
    });

    return (
        <SettingsCard title="Cópia dos dados">
            <SettingRow
                label="Exportar cópia do banco"
                description={info === undefined ? <Skeleton className="h-4 w-64" /> : lastExportText(info.lastExportAt)}
                footer={
                    failure === null ? null : (
                        <p role="alert" className="text-13 text-danger">
                            {failure}
                        </p>
                    )
                }
            >
                <Button
                    variant="outline"
                    className="border-line text-13 font-normal"
                    disabled={exportCopy.isPending}
                    onClick={() => {
                        exportCopy.mutate();
                    }}
                >
                    {exportCopy.isPending ? 'Exportando…' : 'Exportar…'}
                </Button>
            </SettingRow>
            <SettingRow label="Local do arquivo" description={info === undefined ? <Skeleton className="h-4 w-64" /> : <span className="break-all select-text">{info.databasePath}</span>}>
                <Button
                    variant="outline"
                    className="border-line text-13 font-normal"
                    onClick={() => {
                        void bridge.database.showInFolder();
                    }}
                >
                    Mostrar na pasta
                </Button>
            </SettingRow>
        </SettingsCard>
    );
}

/**
 * Lista de atalhos, lida do `SHORTCUT_GUIDE`, a mesma fonte que o teste confere contra o teclado.
 *
 * @return A seção "Atalhos de teclado".
 */
function ShortcutsSection(): ReactNode {
    return (
        <SettingsCard title="Atalhos de teclado">
            {SHORTCUT_GUIDE.map((group) => (
                <section key={group.title} aria-label={group.title} className="border-b border-line2 last:border-b-0">
                    <h3 className="px-5 pt-3.5 text-12 font-medium text-muted">{group.title}</h3>
                    <ul>
                        {group.entries.map((entry) => (
                            <li key={entry.label} className="flex items-center justify-between gap-4 border-b border-line2 px-5 py-3 text-14 last:border-b-0">
                                <span>{entry.label}</span>
                                <span className="flex items-center gap-1">
                                    {entry.keys.map((key) => (
                                        <kbd key={key} className="rounded-4 border border-b-2 border-line bg-bg px-1.5 py-px font-sans text-12">
                                            {key}
                                        </kbd>
                                    ))}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </SettingsCard>
    );
}

/**
 * Cartão de uma seção, como os do mockup.
 *
 * @param props.title Título da seção; com `titleHidden`, só nomeia a região para leitores de tela.
 * @param props.titleHidden Esconde o cabeçalho visível, como no cartão de versão do mockup.
 * @param props.children Linhas da seção.
 * @return A seção.
 */
function SettingsCard({ title, titleHidden = false, children }: { readonly title: string; readonly titleHidden?: boolean; readonly children: ReactNode }): ReactNode {
    return (
        <section aria-label={title} className="overflow-hidden rounded-10 border border-line bg-surface">
            {!titleHidden && (
                <div className="border-b border-line2 px-5 py-3.5">
                    <h2 className="text-16 font-semibold">{title}</h2>
                </div>
            )}
            {children}
        </section>
    );
}

/**
 * Linha de ajuste: rótulo e apoio à esquerda, valor ou ação à direita.
 *
 * @param props.label Nome do ajuste.
 * @param props.description Texto de apoio abaixo do rótulo, ou o esqueleto enquanto ele carrega.
 * @param props.footer Conteúdo abaixo da linha inteira, como a mensagem de falha.
 * @param props.children Valor ou ação.
 * @return A linha.
 */
function SettingRow({ label, description = null, footer = null, children }: {
    readonly label: string;
    readonly description?: ReactNode;
    readonly footer?: ReactNode;
    readonly children: ReactNode;
}): ReactNode {
    return (
        <div className="flex flex-col gap-2 border-b border-line2 px-5 py-3.5 text-14 last:border-b-0">
            <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span>{label}</span>
                    {description !== null && <div className="text-12 text-muted">{description}</div>}
                </div>
                <div className="shrink-0">{children}</div>
            </div>
            {footer}
        </div>
    );
}

/**
 * @param props.value Valor vindo das informações do app; `undefined` enquanto carregam.
 * @return O valor em texto de apoio, ou o esqueleto.
 */
function InfoValue({ value }: { readonly value: string | undefined }): ReactNode {
    return value === undefined ? <Skeleton className="h-4 w-12" /> : <span className="text-12 text-muted tabular-nums">{value}</span>;
}
