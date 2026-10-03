import type { ColorTokenName } from '@finance/tokens';
import * as React from 'react';
import { Legend, ResponsiveContainer, Tooltip, type LegendPayload, type TooltipContentProps } from 'recharts';
import { cn } from '@/lib/cn';

/**
 * Séries de um gráfico, pela chave do dado: rótulo e cor. A cor é um **token**, e não um
 * valor livre, porque o gráfico precisa trocar de tema junto com o resto da tela e nenhuma
 * cor literal entra fora de `packages/tokens` (desktop-mvp-plan §7).
 */
export type ChartConfig = Readonly<Record<string, { readonly label: string; readonly color: ColorTokenName }>>;

const ChartContext = React.createContext<ChartConfig | null>(null);

/**
 * @return As séries do gráfico em volta.
 * @throws {Error} Quando usado fora de `ChartContainer` — erro de montagem, que precisa
 * aparecer no primeiro render.
 */
function useChartConfig(): ChartConfig {
    const config = React.useContext(ChartContext);
    if (config === null) {
        throw new Error('Componentes de gráfico precisam estar dentro de ChartContainer');
    }
    return config;
}

/**
 * Contêiner dos gráficos dos relatórios (Recharts, desktop-mvp-plan §2). Cada série vira a
 * variável `--color-<chave>` apontando para o token, e os elementos do Recharts usam
 * `fill="var(--color-<chave>)"`: como o token é uma variável de tema, o gráfico troca de
 * tema sem re-renderizar. A versão do shadcn/ui gerava um `<style>` por tema; com tokens
 * isso é desnecessário.
 *
 * @param props.config Séries do gráfico.
 * @param props.children O gráfico do Recharts.
 * @param props Demais propriedades do `div`; `className` define o tamanho do gráfico.
 * @return O gráfico responsivo com as variáveis das séries.
 */
function ChartContainer({
    config,
    className,
    children,
    style,
    ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & { readonly config: ChartConfig; readonly children: React.ReactElement }): React.ReactNode {
    const variables: Record<`--color-${string}`, string> = {};
    for (const [key, series] of Object.entries(config)) {
        variables[`--color-${key}`] = `var(--${series.color})`;
    }
    return (
        <ChartContext value={config}>
            <div
                data-slot="chart"
                className={cn(
                    'flex aspect-video justify-center text-12 [&_.recharts-cartesian-axis-tick_text]:fill-muted [&_.recharts-cartesian-grid_line]:stroke-line2 [&_.recharts-layer]:outline-hidden [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-track [&_.recharts-surface]:outline-hidden',
                    className,
                )}
                style={{ ...variables, ...style }}
                {...props}
            >
                <ResponsiveContainer>{children}</ResponsiveContainer>
            </div>
        </ChartContext>
    );
}

const ChartTooltip = Tooltip;

/**
 * Conteúdo da dica do gráfico: o rótulo do ponto e o valor de cada série. A formatação é
 * obrigatória e vem de fora (os formatadores do `client`), porque o valor é dinheiro ou
 * percentual e precisa sair igual à tabela equivalente — o `toLocaleString` do modelo do
 * shadcn/ui usaria `Intl`, que o projeto evita (desktop-shell-design §4.2).
 *
 * @param props.active Se a dica está visível; o Recharts controla.
 * @param props.payload Valores das séries no ponto sob o cursor.
 * @param props.label Rótulo do ponto (o mês, a subcategoria).
 * @param props.formatValue Formata o valor numérico de uma série.
 * @return A dica, ou nada quando inativa.
 */
function ChartTooltipContent({
    active,
    payload,
    label,
    formatValue,
}: Pick<TooltipContentProps, 'active' | 'payload' | 'label'> & { readonly formatValue: (value: number) => string }): React.ReactNode {
    const config = useChartConfig();
    if (!active || payload.length === 0) {
        return null;
    }
    return (
        <div className="grid min-w-32 gap-1.5 rounded-10 border border-line bg-surface px-2.5 py-1.5 text-12 shadow-xl">
            {label !== undefined && <div className="font-medium">{label}</div>}
            {payload.map((item) => {
                const key = typeof item.dataKey === 'string' ? item.dataKey : '';
                const series = config[key];
                return (
                    <div key={key} className="flex items-center gap-2">
                        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-2" style={{ backgroundColor: `var(--color-${key})` }} />
                        <span className="flex-1 text-muted">{series?.label ?? key}</span>
                        <span className="font-medium text-ink">{typeof item.value === 'number' ? formatValue(item.value) : ''}</span>
                    </div>
                );
            })}
        </div>
    );
}

const ChartLegend = Legend;

/**
 * Legenda com os rótulos das séries vindos da configuração, para que o texto da legenda e o
 * da dica sejam sempre o mesmo.
 *
 * @param props.payload Séries que o Recharts desenhou.
 * @param props.className Classes extras do contêiner.
 * @return A legenda, ou nada sem séries.
 */
function ChartLegendContent({ payload, className }: { readonly payload?: readonly LegendPayload[]; readonly className?: string }): React.ReactNode {
    const config = useChartConfig();
    if (payload === undefined || payload.length === 0) {
        return null;
    }
    return (
        <div className={cn('flex items-center justify-center gap-4 pt-3', className)}>
            {payload.map((item) => {
                const key = typeof item.dataKey === 'string' ? item.dataKey : '';
                return (
                    <div key={key} className="flex items-center gap-1.5">
                        <span aria-hidden="true" className="size-2 shrink-0 rounded-2" style={{ backgroundColor: `var(--color-${key})` }} />
                        {config[key]?.label ?? item.value}
                    </div>
                );
            })}
        </div>
    );
}

export { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent };
