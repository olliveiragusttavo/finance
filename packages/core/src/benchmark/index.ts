// Medição das chamadas interativas (mobile-mvp-plan, Fase 5): o roteiro e o banco de referência,
// os mesmos no Node (`pnpm bench:core`) e no Hermes do aparelho.
export { formatBenchmarkLog, INTERACTIVE_OPERATIONS, INTERACTIVE_P95_BUDGET_MS, runInteractiveBenchmark, type InteractiveBenchmarkOptions, type InteractiveOperation, type OperationStats } from './interactiveBenchmark.ts';
export { DEFAULT_HISTORY_OPTIONS, historyPeriods, type HistoryOptions, type HistoryPeriods } from './referenceHistory.ts';
