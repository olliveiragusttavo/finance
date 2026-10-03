import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { AppFailure } from '../lib/failures.ts';
import { ReportProblem } from './ReportProblem.tsx';

/**
 * Tela de erro fatal: substitui o app inteiro quando algo não previsto acontece. Fica fora do
 * shell — sem menu nem mês de referência —, como a tela de bloqueio, porque depois de um erro
 * desconhecido nada do que está na tela é confiável. Oferece só duas saídas: relatar o
 * problema e fechar o app; reabrir é o único jeito de voltar a um estado conhecido.
 *
 * @param props.failure O erro a mostrar.
 * @return A tela de erro, ou o relato quando o usuário escolhe reportar.
 */
export function ErrorScreen({ failure }: { readonly failure: AppFailure }): ReactNode {
    const [reporting, setReporting] = useState(false);
    return (
        <main role="alert" className="flex h-full items-center justify-center overflow-auto p-8">
            <section className="flex w-full max-w-2xl flex-col gap-4 rounded-10 border border-line bg-surface p-8">
                {reporting ? (
                    <ReportProblem failure={failure} onBack={() => { setReporting(false); }} />
                ) : (
                    <>
                        <h1 className="text-22 font-semibold">{failure.title}</h1>
                        <p className="text-ink2">{failure.message}</p>
                        <details className="rounded-8 border border-line2 bg-surface2 p-3">
                            <summary className="cursor-pointer text-13 text-ink2">Detalhes técnicos</summary>
                            <pre className="mt-2 max-h-48 overflow-auto text-12 whitespace-pre-wrap break-all text-muted">{failure.details}</pre>
                        </details>
                        <div className="flex flex-wrap gap-2">
                            <Button onClick={() => { setReporting(true); }}>Reportar problema</Button>
                            <Button variant="outline" onClick={() => { window.close(); }}>Fechar o app</Button>
                        </div>
                    </>
                )}
            </section>
        </main>
    );
}
