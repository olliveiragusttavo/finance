import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { RestoreResult, StartupStatus } from '../../../shared/bridge.ts';
import { bridge } from '../lib/bridge.ts';
import { technicalText, type AppFailure } from '../lib/failures.ts';
import { ReportProblem } from './ReportProblem.tsx';

/** Estados que bloqueiam o app; `ready` nunca chega a esta tela. */
type BlockedStatus = Exclude<StartupStatus, { readonly kind: 'ready' }>;

/** Título e explicação de cada bloqueio. */
interface BlockingCopy {
    readonly title: string;
    readonly body: string;
}

/** Andamento da restauração: nada ainda, em curso, ou o resultado. */
type RestoreState = RestoreResult | 'running' | null;

/**
 * @param status Como a abertura terminou.
 * @return O texto da tela. Cada bloqueio diz o que aconteceu com os dados — a primeira
 * pergunta de quem vê o app não abrir é se perdeu alguma coisa.
 */
function copyOf(status: BlockedStatus): BlockingCopy {
    switch (status.kind) {
        case 'schemaNewerThanApp':
            return {
                title: 'Este banco é de uma versão mais nova do app',
                body: `O arquivo foi gravado pela versão ${String(status.databaseVersion)} do banco, e este app conhece até a ${String(status.appVersion)}. Atualize o app para abri-lo; nada foi alterado no arquivo.`,
            };
        case 'migrationFailed':
            return {
                title: 'A atualização do banco falhou',
                body: status.backupFile === null
                    ? 'A etapa que falhou foi desfeita e o banco não foi aberto. Não há cópia anterior a restaurar, porque o banco ainda estava vazio.'
                    : 'A etapa que falhou foi desfeita e o banco não foi aberto. Você pode restaurar a cópia feita antes da atualização; o banco atual fica guardado na pasta de backups.',
            };
        case 'backupFailed':
            return {
                title: 'Não foi possível copiar o banco antes de atualizá-lo',
                body: 'Sem a cópia de segurança, a atualização não foi feita e o banco continua como estava. Verifique o espaço em disco e a permissão da pasta de dados e abra o app de novo.',
            };
        case 'openFailed':
            return {
                title: 'Não foi possível abrir o banco',
                body: 'O arquivo do banco não pôde ser aberto. O detalhe do erro foi registrado no log do app.',
            };
        case 'restoreIncomplete':
            return {
                title: 'Uma restauração de cópia não terminou',
                body: status.failedCopy === null
                    ? 'O app foi interrompido enquanto restaurava uma cópia do banco e não vai abrir até que isso seja resolvido, para não criar um banco vazio no lugar dos seus dados. Reporte o problema.'
                    : `O app foi interrompido enquanto restaurava uma cópia do banco e não vai abrir até que isso seja resolvido, para não criar um banco vazio no lugar dos seus dados. O banco anterior está guardado em ${status.failedCopy}. Reporte o problema.`,
            };
        case 'unexpected':
            return {
                title: 'Erro inesperado ao abrir o banco',
                body: 'O banco não foi aberto, para não mostrar números errados. O detalhe do erro foi registrado no log do app; feche e abra o app de novo e, se o erro voltar, reporte o problema.',
            };
    }
}

/**
 * @param result Resultado da restauração.
 * @return A mensagem de conclusão ou de erro, dizendo onde estão os dados em cada caso.
 */
function restoreMessage(result: RestoreResult): string {
    if (result.ok) {
        return `Cópia ${result.restoredFrom} restaurada. Feche o app e use a versão anterior até a correção; o banco que falhou foi guardado em ${result.failedCopy}.`;
    }
    switch (result.reason) {
        case 'io-error':
            return 'Não foi possível restaurar a cópia. Nada foi alterado: o banco atual continua no lugar. Verifique o espaço em disco e tente de novo.';
        case 'core-busy':
            return 'O app não conseguiu liberar o banco para restaurar a cópia. Nada foi alterado; feche e abra o app e tente de novo.';
        case 'database-moved':
            return `Não foi possível restaurar a cópia nem devolver o banco ao lugar. Seus dados estão guardados em ${result.failedCopy}; o app não vai abrir até que isso seja resolvido. Reporte o problema.`;
        case 'no-backup':
            return 'Não há cópia para restaurar.';
        case 'not-blocked':
            return 'A restauração não se aplica a este estado do banco.';
    }
}

/**
 * @param state Andamento da restauração.
 * @return `true` quando dá para (tentar de novo) restaurar: as falhas em que nada foi
 * alterado liberam outra tentativa.
 */
function canTryRestore(state: RestoreState): boolean {
    return state === null || (state !== 'running' && !state.ok && (state.reason === 'io-error' || state.reason === 'core-busy'));
}

/**
 * Tela de bloqueio da abertura (backend-design §4.5 e §4.8): o banco não foi aberto e o app
 * não segue para as telas, porque abrir mesmo assim produziria número errado ou gravaria
 * num banco pela metade. Fica fora do shell — sem menu nem mês de referência —, já que nada
 * do banco pode ser lido. Todo bloqueio pode ser relatado, com o log, pela tela de relato.
 *
 * @param props.status O bloqueio a explicar.
 * @return A tela.
 */
export function BlockingScreen({ status }: { readonly status: BlockedStatus }): ReactNode {
    const [restore, setRestore] = useState<RestoreState>(null);
    const [reporting, setReporting] = useState(false);
    const copy = copyOf(status);
    const offersRestore = status.kind === 'migrationFailed' && status.backupFile !== null && canTryRestore(restore);
    const failure: AppFailure = {
        title: copy.title,
        message: copy.body,
        details: `Estado da abertura: ${technicalText(status)}${restore !== null && restore !== 'running' ? `\nRestauração: ${technicalText(restore)}` : ''}`,
    };

    /** Pede a restauração; a rejeição vira resultado, para a tela nunca ficar parada. */
    const runRestore = (): void => {
        setRestore('running');
        bridge.startup.restoreBackup().then(setRestore, () => {
            setRestore({ ok: false, reason: 'io-error' });
        });
    };

    return (
        <main role="alert" className="flex h-full items-center justify-center overflow-auto p-8">
            <section className="flex w-full max-w-2xl flex-col gap-4 rounded-10 border border-line bg-surface p-8">
                {reporting ? (
                    <ReportProblem failure={failure} onBack={() => { setReporting(false); }} />
                ) : (
                    <>
                        <h1 className="text-22 font-semibold">{copy.title}</h1>
                        <p className="text-ink2">{copy.body}</p>
                        {restore === 'running' && <p role="status" className="text-ink2">Restaurando a cópia…</p>}
                        {restore !== null && restore !== 'running' && <p role="status" className="text-ink2">{restoreMessage(restore)}</p>}
                        <div className="flex flex-wrap gap-2">
                            {offersRestore && (
                                <Button onClick={runRestore}>{restore === null ? 'Restaurar a cópia anterior' : 'Tentar restaurar de novo'}</Button>
                            )}
                            <Button variant="outline" disabled={restore === 'running'} onClick={() => { setReporting(true); }}>Reportar problema</Button>
                        </div>
                    </>
                )}
            </section>
        </main>
    );
}
