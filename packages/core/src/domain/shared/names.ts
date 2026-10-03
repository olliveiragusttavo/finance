import { InvalidValueError } from './errors.ts';

/**
 * Tamanho máximo dos nomes de cadastro — perfil, conta, cartão, categoria e subcategoria —,
 * o mesmo `CHECK (length(name) <= 45)` do schema (database-design §4.1 a §4.9). Fica num
 * lugar só para que o domínio recuse antes de o banco recusar com erro de SQL.
 */
export const REGISTRY_NAME_MAX_LENGTH = 45;

/**
 * Normaliza e valida o nome de um cadastro. O nome é aparado antes de medir porque um
 * nome só de espaços apareceria vazio em toda lista e seletor, e espaços nas pontas
 * fariam "Mercado" e "Mercado " parecerem cadastros diferentes.
 *
 * @param raw Nome como o usuário digitou.
 * @param field Campo do formulário, para a UI apontar o erro.
 * @param maxLength Limite do schema para a coluna.
 * @return O nome aparado.
 * @throws {InvalidValueError} Quando o nome fica vazio ou passa do limite.
 */
export function requireName(raw: string, field = 'name', maxLength = REGISTRY_NAME_MAX_LENGTH): string {
    const name = raw.trim();
    if (name.length === 0 || name.length > maxLength) {
        throw new InvalidValueError(field, `o nome precisa ter de 1 a ${maxLength} caracteres`);
    }
    return name;
}

/**
 * Compara nomes sem diferenciar maiúsculas, como os índices únicos `name COLLATE NOCASE`
 * (database-design §3.11). Não delega ao `NOCASE` do SQLite porque ele só dobra a caixa de
 * ASCII: "Saúde" e "SAÚDE" passariam pelo índice como nomes distintos, e o usuário veria
 * duas categorias iguais. A normalização NFC evita que um "é" composto e um decomposto
 * sejam tratados como letras diferentes.
 *
 * @param a Primeiro nome.
 * @param b Segundo nome.
 * @return `true` quando os dois nomes são o mesmo para o usuário.
 */
export function sameName(a: string, b: string): boolean {
    return foldName(a) === foldName(b);
}

/**
 * @param name Nome a reduzir.
 * @return A forma canônica usada só para comparação; nunca é gravada.
 */
function foldName(name: string): string {
    return name.trim().normalize('NFC').toLowerCase();
}
