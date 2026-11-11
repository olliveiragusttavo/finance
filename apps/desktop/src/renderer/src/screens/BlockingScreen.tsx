import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { blockingCopy, canTryRestore, restoreMessage, type BlockedStatus, type RestoreState } from '@finance/client';
import { bridge } from '../lib/bridge.ts';
import { technicalText, type AppFailure } from '../lib/failures.ts';
import { ReportProblem } from './ReportProblem.tsx';

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
    const copy = blockingCopy(status);
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
