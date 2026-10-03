import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { ReportChannel, ReportResult } from '../../../shared/bridge.ts';
import { bridge } from '../lib/bridge.ts';
import type { AppFailure } from '../lib/failures.ts';

/** Estado do envio: nada ainda, abrindo o destino, ou o resultado. */
type SendState = null | 'sending' | { readonly channel: ReportChannel; readonly result: ReportResult };

/**
 * @param state Resultado do envio.
 * @return A mensagem de conclusão ou de erro. Diz que o envio não terminou no app: a issue e o
 * e-mail só saem quando o usuário confirma no navegador ou no programa de e-mail.
 */
function sentMessage(state: { readonly channel: ReportChannel; readonly result: ReportResult }): string {
    if (!state.result.ok) {
        return state.channel === 'github'
            ? 'Não foi possível abrir o navegador. Tente enviar por e-mail.'
            : 'Não foi possível abrir o programa de e-mail. Tente abrir a issue no GitHub.';
    }
    const opened = state.channel === 'github'
        ? 'A issue foi aberta no navegador, já preenchida. Revise o texto e clique em "Create" para enviar.'
        : 'O e-mail foi aberto no seu programa de e-mail, já preenchido. Revise o texto e envie.';
    return state.result.logTruncated ? `${opened} O log foi cortado para caber; o arquivo completo fica na pasta logs do app.` : opened;
}

/**
 * Relato de problema (Task de suporte a erros): o usuário descreve o que fazia, vê o log que
 * vai junto e escolhe abrir uma issue pré-preenchida no GitHub — o destino preferido, onde o
 * problema fica rastreável — ou mandar por e-mail, para quem não tem conta lá.
 *
 * O envio não acontece dentro do app: o processo principal abre o navegador (ou o e-mail) e o
 * usuário revisa e confirma. É o que permite relatar sem guardar token do GitHub no app, e é o
 * que dá a última palavra ao usuário sobre o que sai do computador — a issue é pública.
 *
 * @param props.failure Erro a relatar; título e detalhes técnicos vão no relato.
 * @param props.onBack Volta para a tela do erro.
 * @return O formulário de relato.
 */
export function ReportProblem({ failure, onBack }: { readonly failure: AppFailure; readonly onBack: () => void }): ReactNode {
    const [description, setDescription] = useState('');
    const [includeLog, setIncludeLog] = useState(true);
    const [logTail, setLogTail] = useState<string | null>(null);
    const [sent, setSent] = useState<SendState>(null);
    const descriptionId = useId();
    const includeLogId = useId();

    useEffect(() => {
        let active = true;
        bridge.report.logTail().then(
            (text) => {
                if (active) {
                    setLogTail(text);
                }
            },
            () => {
                if (active) {
                    setLogTail('');
                }
            },
        );
        return () => {
            active = false;
        };
    }, []);

    /**
     * @param channel Destino escolhido.
     */
    const send = (channel: ReportChannel): void => {
        setSent('sending');
        bridge.report.send(channel, { title: failure.title, details: failure.details, description, includeLog }).then(
            (result) => {
                setSent({ channel, result });
            },
            () => {
                setSent({ channel, result: { ok: false } });
            },
        );
    };

    return (
        <>
            <h1 className="text-22 font-semibold">Reportar o problema</h1>
            <p className="text-ink2">
                O relato abre no navegador como uma issue já preenchida no GitHub, que você revisa e envia pela sua conta. Se não tiver conta no GitHub, envie por e-mail.
            </p>
            <div className="flex flex-col gap-2">
                <label htmlFor={descriptionId} className="font-medium">O que você estava fazendo quando o erro apareceu?</label>
                <textarea
                    id={descriptionId}
                    value={description}
                    maxLength={5000}
                    rows={4}
                    onChange={(event) => {
                        setDescription(event.target.value);
                    }}
                    className="w-full rounded-8 border border-line bg-transparent px-3 py-2 text-14 outline-none placeholder:text-muted focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50"
                    placeholder="Ex.: salvei uma despesa no cartão e a tela ficou em branco."
                />
            </div>
            <div className="flex items-center gap-2">
                <input
                    id={includeLogId}
                    type="checkbox"
                    checked={includeLog}
                    onChange={(event) => {
                        setIncludeLog(event.target.checked);
                    }}
                    className="size-4 accent-accent"
                />
                <label htmlFor={includeLogId}>Incluir o fim do log do app</label>
            </div>
            {includeLog && (
                <details className="rounded-8 border border-line2 bg-surface2 p-3">
                    <summary className="cursor-pointer text-13 text-ink2">Ver o log que vai junto</summary>
                    <pre className="mt-2 max-h-48 overflow-auto text-12 whitespace-pre-wrap break-all text-muted">
                        {logTail === null ? 'Carregando…' : logTail === '' ? 'O log está vazio.' : logTail}
                    </pre>
                </details>
            )}
            <p className="rounded-8 bg-warn-bg p-3 text-13 text-warn-ink">
                A issue é pública. Revise o texto antes de enviar: o log pode conter nomes de contas e valores.
            </p>
            <div className="flex flex-wrap gap-2">
                <Button disabled={sent === 'sending'} onClick={() => { send('github'); }}>Abrir issue no GitHub</Button>
                <Button variant="outline" disabled={sent === 'sending'} onClick={() => { send('email'); }}>Enviar por e-mail</Button>
                <Button variant="ghost" onClick={onBack}>Voltar</Button>
            </div>
            {sent !== null && sent !== 'sending' && <p role="status" className="text-ink2">{sentMessage(sent)}</p>}
        </>
    );
}
