-- =============================================================================
-- 0007_report_definitions.sql
--
-- Relatórios personalizados (reports-design §1 e §4; desktop-mvp-plan Fase 15).
--
-- Regra de negócio (Relatórios): o relatório é uma definição salva do perfil —
-- nome, filtro e formato — que o usuário monta e que passa a aparecer na lista
-- de Relatórios. A definição não guarda resultado: abrir o relatório roda o
-- filtro contra as transações do momento.
--
-- O filtro e o formato ficam juntos numa coluna JSON, e não em tabelas de
-- vínculo, porque as listas de ids do filtro (categorias, contas, tags...) não
-- têm consulta própria além de carregar a definição; o JSON leva `version` e é
-- lido pelo mesmo schema da entrada da rota, então mudar o formato é uma
-- conversão na leitura, não uma migration de dados. Ser uma célula só também é
-- o que a sincronização precisa: duas edições concorrentes do mesmo relatório
-- não se misturam campo a campo (sync-design §5.1), e vence a mais recente
-- inteira.
--
-- O nome é único no perfil sem diferenciar maiúsculas, conferido na aplicação
-- (`sameName`), como o das tags: o `NOCASE` do SQLite só dobra ASCII.
-- =============================================================================

CREATE TABLE report_definitions (
    id TEXT NOT NULL PRIMARY KEY,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    definition TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at TEXT NOT NULL,
    deleted_at TEXT,

    CONSTRAINT fk_report_definitions_profile_id FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,

    CONSTRAINT ck_report_definitions_id CHECK (length(id) = 36),
    CONSTRAINT ck_report_definitions_name CHECK (length(name) BETWEEN 1 AND 100),
    CONSTRAINT ck_report_definitions_definition CHECK (json_valid(definition)),
    CONSTRAINT ck_report_definitions_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_report_definitions_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_report_definitions_deleted_at CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_report_definitions_profile_id ON report_definitions (profile_id);
