import { z } from 'zod';

/** Sem parâmetros: a verificação cobre o banco inteiro, não um perfil. */
export const verifyBalancesRequest = z.strictObject({});
