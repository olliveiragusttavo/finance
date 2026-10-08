-- =============================================================================
-- 0004_recurrence_template.sql
--
-- Modelo e calendário das recorrências (database-design §4.12; desktop-mvp-plan
-- Fase 9.1).
--
-- A regra passa a guardar o que ela emite — o modelo de cada ocorrência — e o
-- calendário da série, porque é a regra que emite as ocorrências ainda não
-- materializadas (séries fixas) e que regenera as futuras quando o usuário muda
-- a série. Copiar de uma ocorrência existente faria um valor atípico editado em
-- "somente esta" vazar para as seguintes.
--
-- A marca d'água vira uma contagem (`materialized_count`) e cada ocorrência
-- ganha o seu número (`transactions.occurrence`), que é a chave do id
-- determinístico: a data de uma série pode mudar de dia, e dois aparelhos
-- gerariam a mesma ocorrência com datas — e ids — diferentes
-- (sync-design §5.6).
--
-- A tabela é recriada, e não alterada coluna a coluna, porque o `ALTER TABLE`
-- não adiciona coluna `NOT NULL` sem default nem chave estrangeira não nula. Até
-- aqui nenhum código grava em `recurrences`, então ela está vazia em todo banco;
-- a guarda abaixo aborta a migration se não estiver, em vez de apagar regras
-- (o runner desfaz a migration e a abertura oferece restaurar o backup). Vazia,
-- o `DROP TABLE` não mexe em nenhuma transação, e as chaves estrangeiras de
-- `transactions.recurrence_id` voltam a apontar para a tabela nova, que tem o
-- mesmo nome.
--
-- Por último, sai a unicidade de (recurrence_id, due_date) entre as ocorrências
-- vivas (recurrence-edit-proposal.md, linha 1). A identidade de uma ocorrência
-- passa a ser o número dela na série: o id determinístico e o
-- `uq_transactions_recurrence_occurrence` já impedem gerar a mesma ocorrência
-- duas vezes. O índice por data ficaria redundante e causaria falhas: uma
-- ocorrência movida em "somente esta" para a data de outra ainda não gravada
-- faria o complemento falhar ao gravá-la. Regra de negócio (Recorrências): duas
-- ocorrências da mesma série podem vencer no mesmo dia.
-- =============================================================================

CREATE TEMP TABLE migration_0004_guard (recurrences INTEGER NOT NULL CHECK (recurrences = 0));
INSERT INTO migration_0004_guard (recurrences) SELECT count(*) FROM recurrences;
DROP TABLE migration_0004_guard;

DROP INDEX idx_recurrences_profile_id;
DROP TABLE recurrences;

CREATE TABLE recurrences (
    id                      TEXT    NOT NULL PRIMARY KEY,
    profile_id              TEXT    NOT NULL,
    type                    INTEGER NOT NULL,       -- 1: installments, 2: fixed
    recurrence              INTEGER NOT NULL,       -- 1: daily, 2: weekly, 3: monthly, 4: yearly
    installments            INTEGER,                -- type = 1 only
    value_type              INTEGER,                -- 1: total, 2: per_installment; type = 1 only
    end_at                  TEXT,                   -- type = 2 only; NULL = endless
    -- Calendário: a ocorrência `starts_at` vence em `starts_on`; as outras saem
    -- do passo da frequência e do dia âncora.
    starts_on               TEXT    NOT NULL,
    starts_at               INTEGER NOT NULL,
    anchor_day              INTEGER,                -- dia do mês (monthly, yearly), dia ISO da semana (weekly); NULL em daily
    materialized_count      INTEGER NOT NULL,       -- marca d'água; só avança
    -- Modelo de cada ocorrência, com as mesmas regras de `transactions`.
    transaction_type        INTEGER NOT NULL,       -- 1: income, 2: expense, 3: transference, 4: investment
    account_id              TEXT,                   -- exclusiva com credit_card_id (regra da aplicação)
    credit_card_id          TEXT,
    invoice_offset          INTEGER,                -- meses entre a fatura escolhida e a sugerida; só com credit_card_id
    destination_account_id  TEXT,
    sub_category_id         TEXT    NOT NULL,
    partner_id              TEXT,
    goal_id                 TEXT,
    name                    TEXT    NOT NULL,
    description             TEXT,
    value                   REAL    NOT NULL,       -- o total com value_type = total; senão o valor de cada ocorrência
    charges                 REAL    NOT NULL,
    currency                TEXT    NOT NULL,
    conversion_rate         REAL    NOT NULL,
    created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at              TEXT    NOT NULL,
    deleted_at              TEXT,

    CONSTRAINT fk_recurrences_profile_id             FOREIGN KEY (profile_id)             REFERENCES profiles (id)                   ON DELETE CASCADE,
    CONSTRAINT fk_recurrences_account_id             FOREIGN KEY (account_id)             REFERENCES accounts (id)                   ON DELETE CASCADE,
    CONSTRAINT fk_recurrences_credit_card_id         FOREIGN KEY (credit_card_id)         REFERENCES credit_cards (id)               ON DELETE CASCADE,
    CONSTRAINT fk_recurrences_destination_account_id FOREIGN KEY (destination_account_id) REFERENCES accounts (id)                   ON DELETE CASCADE,
    CONSTRAINT fk_recurrences_sub_category_id        FOREIGN KEY (sub_category_id)        REFERENCES transaction_sub_categories (id) ON DELETE NO ACTION,
    CONSTRAINT fk_recurrences_partner_id             FOREIGN KEY (partner_id)             REFERENCES partners (id)                   ON DELETE SET NULL,
    CONSTRAINT fk_recurrences_goal_id                FOREIGN KEY (goal_id)                REFERENCES goals (id)                      ON DELETE SET NULL,

    CONSTRAINT ck_recurrences_id                 CHECK (length(id) = 36),
    CONSTRAINT ck_recurrences_type               CHECK (type IN (1, 2)),
    CONSTRAINT ck_recurrences_recurrence         CHECK (recurrence IN (1, 2, 3, 4)),
    CONSTRAINT ck_recurrences_installments       CHECK (installments IS NULL OR installments > 0),
    CONSTRAINT ck_recurrences_value_type         CHECK (value_type IS NULL OR value_type IN (1, 2)),
    CONSTRAINT ck_recurrences_end_at             CHECK (end_at IS strftime('%Y-%m-%d', end_at)),
    CONSTRAINT ck_recurrences_starts_on          CHECK (starts_on IS strftime('%Y-%m-%d', starts_on)),
    CONSTRAINT ck_recurrences_starts_at          CHECK (starts_at > 0),
    CONSTRAINT ck_recurrences_anchor_day         CHECK (anchor_day IS NULL OR anchor_day BETWEEN 1 AND 31),
    CONSTRAINT ck_recurrences_materialized_count CHECK (materialized_count >= 0),
    CONSTRAINT ck_recurrences_transaction_type   CHECK (transaction_type IN (1, 2, 3, 4)),
    CONSTRAINT ck_recurrences_name               CHECK (length(name) <= 100),
    CONSTRAINT ck_recurrences_currency           CHECK (length(currency) = 3 AND currency = upper(currency)),
    CONSTRAINT ck_recurrences_created_at         CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_recurrences_updated_at         CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_recurrences_deleted_at         CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_recurrences_profile_id             ON recurrences (profile_id);
CREATE INDEX idx_recurrences_account_id             ON recurrences (account_id);
CREATE INDEX idx_recurrences_credit_card_id         ON recurrences (credit_card_id);
CREATE INDEX idx_recurrences_destination_account_id ON recurrences (destination_account_id);

-- Tags do modelo, copiadas para cada ocorrência (regra de negócio: tags e
-- descrição valem para a série inteira). Mesmo desenho de `transactions_tags`.
CREATE TABLE recurrences_tags (
    id              TEXT NOT NULL PRIMARY KEY,
    recurrence_id   TEXT NOT NULL,
    tag_id          TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,

    CONSTRAINT fk_recurrences_tags_recurrence_id FOREIGN KEY (recurrence_id) REFERENCES recurrences (id) ON DELETE CASCADE,
    CONSTRAINT fk_recurrences_tags_tag_id        FOREIGN KEY (tag_id)        REFERENCES tags (id)        ON DELETE CASCADE,

    CONSTRAINT ck_recurrences_tags_id         CHECK (length(id) = 36),
    CONSTRAINT ck_recurrences_tags_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_recurrences_tags_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_recurrences_tags_deleted_at CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_recurrences_tags_recurrence_id ON recurrences_tags (recurrence_id);
CREATE INDEX idx_recurrences_tags_tag_id        ON recurrences_tags (tag_id);
CREATE UNIQUE INDEX uq_recurrences_tags_pair
    ON recurrences_tags (recurrence_id, tag_id)
    WHERE deleted_at IS NULL;

-- Número da ocorrência na série: preenchido exatamente com `recurrence_id`
-- (regra da aplicação), único entre as ocorrências vivas da mesma série.
ALTER TABLE transactions ADD COLUMN occurrence INTEGER
    CONSTRAINT ck_transactions_occurrence CHECK (occurrence IS NULL OR occurrence > 0);

CREATE UNIQUE INDEX uq_transactions_recurrence_occurrence
    ON transactions (recurrence_id, occurrence)
    WHERE deleted_at IS NULL AND recurrence_id IS NOT NULL;

DROP INDEX uq_transactions_recurrence_due_date;
