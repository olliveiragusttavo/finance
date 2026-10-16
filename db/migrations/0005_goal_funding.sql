-- =============================================================================
-- 0005_goal_funding.sql
--
-- De onde vem o progresso da meta e o sentido do vínculo do lançamento
-- (database-design §4.11; desktop-mvp-plan Fase 13.3).
--
-- Regra de negócio (Metas): a meta passa a ter um tipo. `kind` 1 é a meta por
-- lançamentos, como até aqui: o progresso soma as receitas e transferências
-- vinculadas pelo campo "Meta" do lançamento. `kind` 2 é a meta vinculada a uma
-- conta de investimento: o progresso é o saldo consolidado de hoje da conta
-- (`account_id`), e nenhum lançamento se vincula a ela. Toda meta existente é
-- por lançamentos, o padrão da coluna. "Conta só na meta vinculada a conta" é
-- garantido na aplicação (database-design §3.10): o `ALTER TABLE` do SQLite não
-- acrescenta `CHECK` entre colunas.
--
-- A conta vinculada é propriedade da meta só no sentido do progresso: excluir a
-- conta exclui a meta junto, em cadeia (desktop-mvp-plan §5.1), com o alerta
-- contando a meta. Como a exclusão é soft delete, quem faz a cadeia é a
-- aplicação; o `ON DELETE CASCADE` cobre o hard delete do perfil.
--
-- Regra de negócio (Metas): `goal_withdrawal` marca a transferência vinculada
-- que **retira** dinheiro da meta (um imprevisto pago com a reserva), e que por
-- isso desconta do progresso. Só a transferência pode retirar; a receita sempre
-- guarda. A mesma coluna entra no modelo da recorrência, que é copiado para as
-- ocorrências (database-design §4.12).
-- =============================================================================

ALTER TABLE goals ADD COLUMN kind INTEGER NOT NULL DEFAULT 1
    CONSTRAINT ck_goals_kind CHECK (kind IN (1, 2));

ALTER TABLE goals ADD COLUMN account_id TEXT
    CONSTRAINT fk_goals_account_id REFERENCES accounts (id) ON DELETE CASCADE
    CONSTRAINT ck_goals_account_id CHECK (account_id IS NULL OR length(account_id) = 36);

CREATE INDEX idx_goals_account_id ON goals (account_id);

ALTER TABLE transactions ADD COLUMN goal_withdrawal INTEGER NOT NULL DEFAULT 0
    CONSTRAINT ck_transactions_goal_withdrawal CHECK (goal_withdrawal IN (0, 1));

ALTER TABLE recurrences ADD COLUMN goal_withdrawal INTEGER NOT NULL DEFAULT 0
    CONSTRAINT ck_recurrences_goal_withdrawal CHECK (goal_withdrawal IN (0, 1));
