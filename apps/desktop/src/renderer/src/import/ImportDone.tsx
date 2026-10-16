import type { ImportResponse } from '@finance/core';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { outcomeText } from './importView.ts';

/**
 * Fim da importação: o que entrou e os próximos passos. Não é um aviso que some, porque o resumo
 * (quantas faturas pagas, quantas linhas de fora) é o que o usuário confere antes de seguir.
 *
 * @param props.outcome Resumo do núcleo.
 * @param props.onAnother Recomeça o assistente para o próximo arquivo.
 * @return A confirmação.
 */
export function ImportDone({ outcome, onAnother }: { readonly outcome: ImportResponse; readonly onAnother: () => void }): ReactNode {
    return (
        <div className="flex max-w-220 flex-col gap-4">
            <h1 className="text-24 font-semibold">Importação concluída</h1>
            <p role="status" className="rounded-8 bg-ok-bg px-3 py-2.5 text-14 text-ok-ink">
                {outcomeText(outcome)}
            </p>
            <div className="flex gap-3">
                <Button asChild>
                    <Link to="/transactions">Ver transações</Link>
                </Button>
                <Button variant="outline" className="border-line text-13 font-normal" onClick={onAnother}>
                    Importar outro arquivo
                </Button>
            </div>
        </div>
    );
}
