-- =============================================================================
-- 0006_goal_archive.sql
--
-- Marcador de "arquivada" nas metas (database-design §4.11; desktop-mvp-plan
-- Fase 13.4).
--
-- Regra de negócio (Metas): arquivar tira a meta de vista sem apagar nada — a
-- tela Metas lista por padrão só as ativas, e a meta arquivada some das escolhas
-- do campo "Meta" de lançamentos novos. Os lançamentos vinculados continuam
-- vinculados, e o progresso continua sendo calculado, porque o dinheiro guardado
-- não deixa de ter sido guardado. Nula = ativa; preenchida = instante UTC do
-- arquivamento, no mesmo formato de timestamp das demais colunas
-- (database-design §3.9).
--
-- É uma coluna nova, e não reaproveitamento de `deleted_at`, pelo mesmo motivo
-- do `disabled_at` de contas e cartões (migration `0002`): `deleted_at`
-- significa "não existe mais" para toda leitura e para a sincronização
-- (database-design §3.6); uma meta arquivada continua existindo.
-- =============================================================================

ALTER TABLE goals ADD COLUMN archived_at TEXT
    CONSTRAINT ck_goals_archived_at CHECK (archived_at IS strftime('%Y-%m-%d %H:%M:%S', archived_at));
