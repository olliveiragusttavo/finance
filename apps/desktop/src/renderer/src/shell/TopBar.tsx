import { formatMonthLong } from '@finance/client';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ThemeMenu } from './ThemeMenu.tsx';
import { useTransactionPanel } from './TransactionPanel.tsx';
import { useReferenceMonth } from './useReferenceMonth.ts';

/**
 * Barra superior fixa do shell (mockups, decisão de interface 2): mês de referência à
 * esquerda, tema e "+ Lançamento" à direita.
 *
 * @param props.showMonth Se a tela depende de período; nas telas de configuração o mês some e
 * a barra mantém só as ações.
 * @return A barra, presa ao topo da área de conteúdo.
 */
export function TopBar({ showMonth }: { readonly showMonth: boolean }): ReactNode {
    const panel = useTransactionPanel();
    return (
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-surface px-8 py-3">
            {showMonth ? <MonthPicker /> : <div />}
            <div className="flex items-center gap-2.5">
                <ThemeMenu />
                <Button onClick={panel.openNew} aria-keyshortcuts="N">
                    + Lançamento
                </Button>
            </div>
        </header>
    );
}

/**
 * Seletor do mês de referência (‹ mês ›) com "Voltar ao mês atual", que só aparece fora do
 * mês corrente, como no mockup.
 *
 * @return O seletor ligado ao *search param* `period`.
 */
function MonthPicker(): ReactNode {
    const month = useReferenceMonth();
    return (
        <div className="flex items-center gap-2.5">
            <span className="text-12 text-muted">Mês de referência</span>
            <div className="flex items-center rounded-8 border border-line bg-bg">
                <button type="button" aria-label="Mês anterior" aria-keyshortcuts="[" onClick={month.previous} className="rounded-8 px-3 py-2 hover:bg-surface2">
                    <ChevronLeftIcon aria-hidden="true" className="size-4" />
                </button>
                <span data-testid="reference-month" aria-live="polite" className="min-w-38 text-center text-14 font-semibold">
                    {formatMonthLong(month.period)}
                </span>
                <button type="button" aria-label="Próximo mês" aria-keyshortcuts="]" onClick={month.next} className="rounded-8 px-3 py-2 hover:bg-surface2">
                    <ChevronRightIcon aria-hidden="true" className="size-4" />
                </button>
            </div>
            {!month.isCurrent && (
                <Button variant="link" size="sm" onClick={month.goToCurrent} className="text-13 font-normal">
                    Voltar ao mês atual
                </Button>
            )}
        </div>
    );
}
