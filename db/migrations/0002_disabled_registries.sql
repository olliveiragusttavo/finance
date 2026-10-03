-- =============================================================================
-- 0002_disabled_registries.sql
--
-- Marcador de "desativado" em contas e cartões (desktop-mvp-plan §5.1;
-- database-design §4.4 e §4.5).
--
-- Regra de negócio (Contas e Cartões): desativar é a ação padrão no lugar de
-- excluir. A linha desativada some das escolhas de lançamentos novos, mas
-- continua em extratos, faturas, saldos e relatórios, porque o histórico não
-- muda. Nula = ativa; preenchida = instante UTC da desativação, no mesmo
-- formato de timestamp das demais colunas (database-design §3.9).
--
-- É uma coluna nova, e não reaproveitamento de `deleted_at`, porque `deleted_at`
-- significa "não existe mais" para toda leitura e para a sincronização
-- (database-design §3.6); uma conta desativada continua existindo.
-- =============================================================================

ALTER TABLE accounts ADD COLUMN disabled_at TEXT
    CONSTRAINT ck_accounts_disabled_at CHECK (disabled_at IS strftime('%Y-%m-%d %H:%M:%S', disabled_at));

ALTER TABLE credit_cards ADD COLUMN disabled_at TEXT
    CONSTRAINT ck_credit_cards_disabled_at CHECK (disabled_at IS strftime('%Y-%m-%d %H:%M:%S', disabled_at));
