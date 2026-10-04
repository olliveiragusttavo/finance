import { sha1 } from '@noble/hashes/legacy.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import type { AccountId, BankStatementId, CreditCardId, InvoiceId, TagId, TransactionId, TransactionTagId, Uuid } from './ids.ts';
import type { YearMonth } from './YearMonth.ts';

/**
 * Namespace UUID v5 da aplicação. **Nunca alterar**: todo id determinístico já gravado em
 * qualquer aparelho foi derivado dele, e mudá-lo faria dois dispositivos derivarem ids
 * diferentes para "o extrato de março da conta X" (sync-design §5.6 e §11.2).
 */
export const APP_UUID_NAMESPACE = '89faa621-91d8-4ede-85ac-30e38e2f9244';

/**
 * Deriva um UUID v5 (RFC 9562) do namespace da aplicação e de uma chave natural. Linhas
 * identificadas pelo conteúdo — extratos e faturas, uma por mês — recebem esse id para
 * que dois aparelhos offline criando "a mesma" linha derivem o mesmo id e a sincronização
 * mescle em vez de colidir no índice único parcial (database-design §3.5). É código do
 * núcleo, e não porta, porque precisa dar o mesmo resultado byte a byte em todo runtime.
 *
 * @param name Chave natural da linha, num formato estável que também nunca muda.
 * @return O UUID v5 canônico e minúsculo.
 */
export function deriveUuid(name: string): Uuid {
    return uuidV5(APP_UUID_NAMESPACE, name);
}

/**
 * UUID v5 genérico, separado de `deriveUuid` para poder ser conferido contra os vetores
 * de teste do RFC com outros namespaces — um erro de bit aqui mudaria todo id
 * determinístico já gravado.
 *
 * @param namespace UUID do namespace.
 * @param name Nome a derivar, codificado em UTF-8.
 * @return O UUID v5 canônico e minúsculo.
 */
export function uuidV5(namespace: string, name: string): Uuid {
    const namespaceBytes = uuidToBytes(namespace);
    const nameBytes = utf8ToBytes(name);
    const input = new Uint8Array(namespaceBytes.length + nameBytes.length);
    input.set(namespaceBytes, 0);
    input.set(nameBytes, namespaceBytes.length);

    const hash = sha1(input).slice(0, 16);
    // Versão 5 no nibble alto do byte 6 e variante RFC (10xx) nos bits altos do byte 8.
    hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
    hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
    return bytesToUuid(hash);
}

/**
 * Id do extrato de uma conta numa competência. O formato da chave é contrato permanente,
 * como o namespace.
 *
 * @param accountId Conta dona do extrato.
 * @param period Competência do extrato.
 * @return O id determinístico do extrato.
 */
export function bankStatementIdFor(accountId: AccountId, period: YearMonth): BankStatementId {
    return deriveUuid(`bank_statements:${accountId}:${period.toString()}`) as BankStatementId;
}

/**
 * Id da fatura de um cartão numa competência. O formato da chave é contrato permanente,
 * como o namespace.
 *
 * @param creditCardId Cartão dono da fatura.
 * @param period Competência da fatura.
 * @return O id determinístico da fatura.
 */
export function invoiceIdFor(creditCardId: CreditCardId, period: YearMonth): InvoiceId {
    return deriveUuid(`invoices:${creditCardId}:${period.toString()}`) as InvoiceId;
}

/**
 * Id do vínculo entre uma transação e uma tag (database-design §4.14). Derivado do par, e
 * não aleatório, pelo mesmo motivo dos extratos: dois aparelhos que marcam a mesma tag no
 * mesmo lançamento derivam a mesma linha, e reaplicar uma tag removida revive a linha
 * excluída em vez de esbarrar no índice único do par. O formato da chave é contrato
 * permanente, como o namespace.
 *
 * @param transactionId Transação marcada.
 * @param tagId Tag aplicada.
 * @return O id determinístico do vínculo.
 */
export function transactionTagIdFor(transactionId: TransactionId, tagId: TagId): TransactionTagId {
    return deriveUuid(`transactions_tags:${transactionId}:${tagId}`) as TransactionTagId;
}

/**
 * @param uuid UUID canônico com hífens.
 * @return Os 16 bytes do UUID, na ordem de rede que o RFC usa no hash.
 */
function uuidToBytes(uuid: string): Uint8Array {
    const hex = uuid.replaceAll('-', '');
    const bytes = new Uint8Array(16);
    for (let index = 0; index < 16; index++) {
        bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}

/**
 * @param bytes Os 16 bytes do UUID.
 * @return O UUID na forma canônica minúscula de 36 caracteres que o schema exige.
 */
function bytesToUuid(bytes: Uint8Array): Uuid {
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as Uuid;
}
