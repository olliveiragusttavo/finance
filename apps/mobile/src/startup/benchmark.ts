import type { StartupLog } from '@finance/client/startup';
import type { Core } from '@finance/core';
import { DEFAULT_HISTORY_OPTIONS, formatBenchmarkLog, historyPeriods, runInteractiveBenchmark } from '@finance/core/benchmark';

/**
 * Liga a medição das chamadas interativas (mobile-mvp-plan, Fase 5). Lido na hora do bundle: o
 * Expo troca `process.env.EXPO_PUBLIC_*` pelo valor, então só o APK gerado com
 * `EXPO_PUBLIC_BENCHMARK=1` (`pnpm --filter @finance/mobile build:benchmark`, conduzido por
 * `pnpm bench:android`) mede; no APK
 * comum a condição vira `false` e o minificador tira a chamada. Mede no build de release
 * porque o development build roda o JavaScript sem o bytecode do Hermes e com as verificações
 * do modo de desenvolvimento, e daria números piores que os reais.
 */
export const BENCHMARK_ENABLED = process.env.EXPO_PUBLIC_BENCHMARK === '1';

/** Rodadas por operação, as mesmas do `pnpm bench:core`, para comparar com o Node. */
const ROUNDS = 40;

/**
 * Espera antes de medir: a primeira tela termina de montar e as consultas dela terminam, para
 * que a medição não dispute a thread JavaScript com a abertura.
 */
const SETTLE_MS = 3000;

/**
 * Agenda a medição sobre o banco de dez anos que o script `android-benchmark.sh` deixou no
 * aparelho, e grava o resultado no `adb logcat` e no log do app. Uma falha (banco que não é o
 * de referência, por exemplo) também vai para os dois, para o script não esperar à toa.
 *
 * @param core Núcleo aberto pela raiz de composição.
 * @param log Log do app, para o resultado ficar no aparelho além do logcat.
 */
export function scheduleBenchmark(core: Core, log: StartupLog): void {
    setTimeout(() => {
        runInteractiveBenchmark(core, { ...historyPeriods(DEFAULT_HISTORY_OPTIONS), rounds: ROUNDS, now: () => performance.now() }).then(
            (stats) => {
                console.log(`${formatBenchmarkLog(stats)}\n[medição] fim`);
                log.write('info', 'benchmark.result', { stats });
            },
            (error: unknown) => {
                console.log(`[medição] falhou: ${error instanceof Error ? error.message : String(error)}\n[medição] fim`);
                log.write('error', 'benchmark.failed', { error });
            },
        );
    }, SETTLE_MS);
}
