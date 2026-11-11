/**
 * Variáveis `EXPO_PUBLIC_*` que o app lê. Declaradas para o acesso com ponto: o Expo só troca
 * `process.env.EXPO_PUBLIC_X` pelo valor na hora do bundle quando o acesso é com ponto, e o
 * `noPropertyAccessFromIndexSignature` do projeto exigiria colchetes, que o Expo não troca.
 */
declare namespace NodeJS {
    interface ProcessEnv {
        /** `1` liga a medição da Fase 5 (`src/startup/benchmark.ts`). */
        readonly EXPO_PUBLIC_BENCHMARK?: string;
    }
}
