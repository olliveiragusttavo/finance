import type { Uuid } from '../domain/shared/ids.ts';

/**
 * Porta da geração de UUID v4. É porta porque o React Native não oferece
 * `crypto.randomUUID()` e cada plataforma tem sua fonte de aleatoriedade segura
 * (backend-design §3.4). O UUID v5 determinístico não passa por aqui: ele precisa dar o
 * mesmo resultado em todo dispositivo e por isso é implementado no próprio núcleo
 * (`DeterministicIds`).
 */
export interface IdGenerator {
    /**
     * @return Um UUID v4 aleatório, canônico e minúsculo.
     */
    random(): Uuid;
}
