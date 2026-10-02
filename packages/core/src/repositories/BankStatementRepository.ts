import type { BankStatement } from '../domain/statement/BankStatement.ts';
import type { AccountId, BankStatementId } from '../domain/shared/ids.ts';
import type { YearMonth } from '../domain/shared/YearMonth.ts';

/** Acesso aos extratos mensais. Toda leitura considera só extratos vivos. */
export interface BankStatementRepository {
    /**
     * @param id Extrato procurado.
     * @return O extrato vivo, ou `null`.
     */
    findById(id: BankStatementId): BankStatement | null;

    /**
     * @param accountId Conta dona do extrato.
     * @param period Competência procurada.
     * @return O extrato vivo daquele mês, ou `null` quando o mês não tem extrato.
     */
    findByPeriod(accountId: AccountId, period: YearMonth): BankStatement | null;

    /**
     * @param accountId Conta dona dos extratos.
     * @param from Primeira competência incluída.
     * @return Os extratos vivos a partir de `from`, em ordem cronológica — o trecho da
     * cadeia que um recálculo reconstrói.
     */
    listFrom(accountId: AccountId, from: YearMonth): readonly BankStatement[];

    /**
     * @param accountId Conta dona dos extratos.
     * @param period Competência de referência, exclusiva.
     * @return O último extrato vivo **antes** de `period`, cujo fechamento é o saldo inicial
     * do trecho recalculado; `null` quando não há anterior.
     */
    findLatestBefore(accountId: AccountId, period: YearMonth): BankStatement | null;

    /**
     * Insere o extrato ou, se a linha com o mesmo id determinístico existe com soft
     * delete, a revive. Recriar uma linha identificada pelo conteúdo significa revivê-la,
     * não inserir outra (sync-design §5.6).
     *
     * @param statement Extrato a garantir.
     * @return void
     */
    insertOrRevive(statement: BankStatement): void;

    /**
     * @param statement Extrato com os quatro saldos recalculados.
     * @return void
     */
    saveBalances(statement: BankStatement): void;
}
