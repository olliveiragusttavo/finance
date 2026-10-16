import type { ReactNode } from 'react';
import { ViewToggle } from './ViewToggle.tsx';

/**
 * Seletor da visualização de uma lista lateral (desktop-mvp-plan Fase 13.4): Metas alterna entre
 * ativas, atingidas e arquivadas; Contas e Cartões, entre ativos e desativados. Botões de
 * alternância visíveis, e não um menu, porque são poucas opções e o que se está vendo precisa
 * ficar à vista — uma lista que esconde as desativadas sem dizer confunde quem procura uma.
 *
 * @param props.views As visualizações, na ordem dos botões.
 * @param props.value Visualização atual.
 * @param props.format Rótulo de cada visualização.
 * @param props.onChange Recebe a visualização escolhida.
 * @return O grupo de botões.
 */
export function ListViewSwitch<View extends string>({
    views,
    value,
    format,
    onChange,
}: {
    readonly views: readonly View[];
    readonly value: View;
    readonly format: (view: View) => string;
    readonly onChange: (view: View) => void;
}): ReactNode {
    return (
        <div role="group" aria-label="Visualização" className="flex flex-wrap gap-1.5 px-5 pb-3">
            {views.map((view) => (
                <ViewToggle
                    key={view}
                    pressed={view === value}
                    onClick={() => {
                        onChange(view);
                    }}
                >
                    {format(view)}
                </ViewToggle>
            ))}
        </div>
    );
}
