import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { launchApp, removeUserData } from './launchApp.ts';

/*
 * Medição do esqueleto (desktop-shell-design §6, passo 4): tempo até a primeira tela com dado
 * do núcleo e memória com a janela aberta. Fica fora do `pnpm check` — o número depende da
 * máquina e serve para registrar no documento, não para reprovar um build. Rodar com
 * `pnpm --filter @finance/desktop measure`.
 */

const RUNS = 5;

/**
 * Memória proporcional (PSS) de um processo, no Linux. O `workingSetSize` do Electron conta
 * as bibliotecas compartilhadas inteiras em cada processo, e somá-lo infla o total; o PSS
 * divide cada página compartilhada entre quem a usa, e a soma é a memória real do app.
 *
 * @param pid Processo do app.
 * @return O PSS em MB; zero quando o processo já terminou.
 */
function pssMb(pid: number): number {
    try {
        const match = /^Pss:\s+(\d+) kB$/m.exec(readFileSync(`/proc/${String(pid)}/smaps_rollup`, 'utf8'));
        return Number(match?.[1] ?? 0) / 1024;
    } catch {
        return 0;
    }
}

/**
 * @param values Amostras.
 * @return A mediana, menos sensível que a média à primeira abertura com o cache frio.
 */
function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

test('memória e tempo de abertura do Electron', async () => {
    const opening: number[] = [];
    const memory: number[] = [];
    const byType = new Map<string, number[]>();
    for (let run = 0; run < RUNS; run++) {
        const started = performance.now();
        const { app, window: page, userData } = await launchApp();
        await expect(page.getByTestId('profiles')).toBeVisible();
        opening.push(performance.now() - started);
        // Espera a janela assentar antes de medir a memória, como um uso real logo após abrir.
        await page.waitForTimeout(2000);
        const metrics = await app.evaluate(({ app: electronApp }) =>
            electronApp.getAppMetrics().map((metric) => ({ type: metric.serviceName ?? metric.type, pid: metric.pid })),
        );
        const sizes = metrics.map((metric) => ({ type: metric.type, mb: pssMb(metric.pid) }));
        memory.push(sizes.reduce((sum, size) => sum + size.mb, 0));
        const totals = new Map<string, number>();
        for (const size of sizes) {
            totals.set(size.type, (totals.get(size.type) ?? 0) + size.mb);
        }
        for (const [type, mb] of totals) {
            byType.set(type, [...(byType.get(type) ?? []), mb]);
        }
        await app.close();
        removeUserData(userData);
    }
    const perProcess = [...byType].map(([type, values]) => `${type} ${median(values).toFixed(0)} MB`).join(', ');
    console.log(`Abertura até a primeira tela com dado (mediana de ${String(RUNS)}): ${median(opening).toFixed(0)} ms`);
    console.log(`Memória (PSS) com a janela aberta (mediana): ${median(memory).toFixed(0)} MB — ${perProcess}`);
});
