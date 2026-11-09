-- =============================================================================
-- 0008_default_sources.sql
--
-- Conta e cartão padrão do perfil (database-design §4.1, "A conta e o cartão
-- padrão do lançamento").
--
-- Regra de negócio (Lançamentos): o atalho "Débito / Crédito" do formulário de
-- lançamento novo escolhe a conta padrão (débito) ou o cartão padrão (crédito)
-- do perfil, para que lançar a compra do dia a dia não exija abrir a lista de
-- contas e cartões. Nulo = sem padrão; o formulário deixa a escolha para o
-- usuário.
--
-- Fica no perfil, e não como marcador em `accounts` e `credit_cards`, porque a
-- regra é "no máximo uma conta padrão e um cartão padrão por perfil": numa
-- coluna só ela vale por construção. Um marcador por linha dependeria de
-- desmarcar a anterior na mesma escrita, e a sincronização, que mescla célula a
-- célula (sync-design §5.1), deixaria duas contas marcadas quando dois
-- aparelhos escolhessem padrões diferentes ao mesmo tempo.
--
-- A conta ou o cartão desativado ou excluído deixa de valer como padrão na
-- leitura (`SqliteProfileRepository`), sem apagar a escolha: reativar devolve o
-- padrão, como reativar devolve todo o resto (desktop-mvp-plan §5.1). O
-- `ON DELETE SET NULL` só alcança a exclusão física, que o app não faz.
-- =============================================================================

ALTER TABLE profiles ADD COLUMN default_account_id TEXT
    CONSTRAINT fk_profiles_default_account_id REFERENCES accounts (id) ON DELETE SET NULL;

ALTER TABLE profiles ADD COLUMN default_credit_card_id TEXT
    CONSTRAINT fk_profiles_default_credit_card_id REFERENCES credit_cards (id) ON DELETE SET NULL;

CREATE INDEX idx_profiles_default_account_id ON profiles (default_account_id);
CREATE INDEX idx_profiles_default_credit_card_id ON profiles (default_credit_card_id);
