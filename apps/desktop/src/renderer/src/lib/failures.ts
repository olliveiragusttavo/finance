import type { CoreClient } from '@finance/client';
import type { CoreInput, CoreOutput, CoreResult, CoreRoute } from '@finance/core';
import type { FatalFailure, FinanceBridge } from '../../../shared/bridge.ts';

/** O que a tela de erro mostra e o relato envia. */
export interface AppFailure {
    /** Frase curta do que aconteceu, que vira o título do relato. */
    readonly title: string;
    /** Explicação para o usuário: o que houve com os dados e o que fazer. */
    readonly message: string;
    /** Texto técnico (pilha, rota, código) para quem corrige. */
    readonly details: string;
}

/**
 * Guarda a falha fatal do app. Qualquer erro não previsto — na tela, no núcleo, no processo
 * principal — termina aqui, e a raiz troca o app inteiro pela tela de erro: seguir usando
 * depois de um erro desconhecido poderia mostrar número errado ou gravar dado pela metade.
 *
 * Só a primeira falha fica: as seguintes costumam ser consequência dela (o núcleo caiu, e
 * toda chamada pendente falha junto), e trocariam a causa pelo sintoma na tela e no relato.
 */
export class FailureStore {
    private current: AppFailure | null = null;
    private readonly listeners = new Set<() => void>();

    /**
     * @param failure Falha a registrar; ignorada se já houver uma.
     */
    public report(failure: AppFailure): void {
        if (this.current !== null) {
            return;
        }
        this.current = failure;
        for (const listener of this.listeners) {
            listener();
        }
    }

    /** @return A falha registrada; `null` enquanto o app está são. */
    public readonly snapshot = (): AppFailure | null => this.current;

    /**
     * Assinatura no formato do `useSyncExternalStore`.
     *
     * @param listener Avisado quando a falha é registrada.
     * @return Função que cancela a assinatura.
     */
    public readonly subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
}

/** A instância do app; os testes criam a sua. */
export const failures = new FailureStore();

/**
 * @param error O que foi lançado ou rejeitado.
 * @return O texto técnico do erro, com a pilha quando houver. Nunca lança: é usado dentro do
 * tratamento de falhas, onde um objeto circular não pode derrubar a própria tela de erro.
 */
export function technicalText(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ?? `${error.name}: ${error.message}`;
    }
    if (typeof error === 'string') {
        return error;
    }
    // Estes o `JSON.stringify` transforma em `undefined`, apesar do tipo dizer `string`.
    if (error === undefined || typeof error === 'function' || typeof error === 'symbol') {
        return String(error);
    }
    try {
        return JSON.stringify(error);
    } catch {
        // Referência circular ou `BigInt`: `String` só daria "[object Object]".
        return `Valor não serializável (${typeof error})`;
    }
}

/**
 * @param error Exceção não tratada no renderer.
 * @return A falha a mostrar.
 */
export function unexpectedRendererFailure(error: unknown): AppFailure {
    return {
        title: 'Erro inesperado na tela',
        message: 'O app parou para não mostrar dados errados. Feche e abra o app de novo; se o erro voltar, reporte o problema.',
        details: technicalText(error),
    };
}

/**
 * @param failure Falha vinda do processo principal ou do núcleo.
 * @return A falha a mostrar.
 */
export function fatalProcessFailure(failure: FatalFailure): AppFailure {
    if (failure.source === 'core-process') {
        return {
            title: 'O núcleo do app parou',
            message: 'O processo que guarda seus dados terminou inesperadamente. O que já estava gravado continua no banco; o que estava em andamento pode não ter sido salvo. Feche e abra o app de novo.',
            details: failure.message,
        };
    }
    return {
        title: 'Erro inesperado no app',
        message: 'O app parou para proteger seus dados. Feche e abra o app de novo; se o erro voltar, reporte o problema.',
        details: failure.message,
    };
}

/**
 * Liga os avisos globais ao registro: exceções e promessas rejeitadas sem tratamento no
 * renderer, e as falhas que o preload repassa (núcleo que caiu, processo principal). Sem
 * isso, um erro fora da árvore do React — num `setTimeout`, numa promessa solta — só
 * apareceria no console, e o app seguiria num estado desconhecido.
 *
 * @param store Registro que recebe as falhas.
 * @param bridge Ponte do preload, de onde vêm as falhas dos outros processos.
 */
export function installFailureHandlers(store: FailureStore, bridge: FinanceBridge): void {
    window.addEventListener('error', (event) => {
        store.report(unexpectedRendererFailure(event.error ?? event.message));
    });
    window.addEventListener('unhandledrejection', (event) => {
        store.report(unexpectedRendererFailure(event.reason));
    });
    bridge.failures.onFatal((failure) => {
        store.report(fatalProcessFailure(failure));
    });
}

/**
 * Decorador do `CoreClient` que trata `INTERNAL` como falha fatal. Os outros códigos são
 * regra de negócio ou validação, e a tela de origem sabe explicá-los; `INTERNAL` é exceção
 * inesperada no núcleo ou canal fechado, e nenhuma tela sabe o que sobrou de pé depois dele.
 * Decorar o cliente, e não cada consulta, cobre também as chamadas feitas fora do TanStack
 * Query.
 */
export class FailFastCoreClient implements CoreClient {
    /**
     * @param client Cliente real, do preload.
     * @param store Registro que recebe a falha.
     */
    public constructor(private readonly client: CoreClient, private readonly store: FailureStore) {}

    /**
     * @param route Rota chamada.
     * @param input Entrada da rota.
     * @return O resultado do cliente real, sem alteração: quem chamou ainda trata o erro.
     */
    public async call<R extends CoreRoute>(route: R, input: CoreInput<R>): Promise<CoreResult<CoreOutput<R>>> {
        const result = await this.client.call(route, input);
        if (!result.ok && result.error.code === 'INTERNAL') {
            this.store.report({
                title: 'Erro inesperado no núcleo',
                message: 'A operação não foi concluída e o app parou para não gravar dado pela metade. Feche e abra o app de novo; se o erro voltar, reporte o problema.',
                details: `${route}: ${result.error.message}\n${JSON.stringify(result.error.details)}`,
            });
        }
        return result;
    }
}
