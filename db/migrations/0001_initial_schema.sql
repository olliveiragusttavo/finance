-- =============================================================================
-- 0001_initial_schema.sql
--
-- First version of the schema. A transcription of docs/plans/database-design.md
-- section 4 (tables) under the rules of section 3 (conventions). When this file
-- and that document disagree, one of them is wrong and both get fixed.
--
-- Not in this file, by design:
--   * PRAGMA foreign_keys = ON and PRAGMA journal_mode = WAL. They belong to
--     connection setup in the Repository layer (design doc section 3.2).
--   * IF NOT EXISTS. A migration runs exactly once; the runner tracks versions.
--   * Business rules (exclusive arcs, paid/payment_date, partners only on
--     business profiles). The Service layer enforces them (section 3.10).
--
-- Conventions applied throughout (section 3):
--   * Every table is STRICT.
--   * id: application-generated UUID v4, canonical lowercase 36-char text.
--   * created_at: filled by the database, UTC. updated_at: stamped by the
--     application, UTC. deleted_at: soft delete; a row is live when NULL.
--   * Dates and timestamps are ISO-8601 TEXT, format-checked with strftime.
--   * Money is REAL, denominated in the profile's currency.
--   * Every FK column has a plain (non-partial) index: idx_<table>_<column>.
--   * Every uniqueness rule is a partial unique index over live rows:
--     uq_<table>_<columns> ... WHERE deleted_at IS NULL.
--   * Constraint names: ck_<table>_<column>, fk_<table>_<column>.
--   * ON DELETE: CASCADE for ownership, SET NULL for references, NO ACTION for
--     vocabulary (never RESTRICT — it would break the profile cascade).
--
-- Requires SQLite >= 3.37 (STRICT tables).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 4.1 profiles — the tenant root
-- -----------------------------------------------------------------------------
CREATE TABLE profiles (
    id          TEXT    NOT NULL PRIMARY KEY,
    name        TEXT    NOT NULL,
    type        INTEGER NOT NULL,                 -- 1: personal, 2: business
    currency    TEXT    NOT NULL,                 -- ISO 4217; the unit everything is stored in
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at  TEXT    NOT NULL,
    deleted_at  TEXT,

    CONSTRAINT ck_profiles_id         CHECK (length(id) = 36),
    CONSTRAINT ck_profiles_name       CHECK (length(name) <= 45),
    CONSTRAINT ck_profiles_type       CHECK (type IN (1, 2)),
    CONSTRAINT ck_profiles_currency   CHECK (length(currency) = 3 AND currency = upper(currency)),
    CONSTRAINT ck_profiles_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_profiles_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_profiles_deleted_at CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;


-- -----------------------------------------------------------------------------
-- 4.2 partners — individuals holding a share of a business profile
-- -----------------------------------------------------------------------------
CREATE TABLE partners (
    id          TEXT NOT NULL PRIMARY KEY,
    profile_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    percentage  REAL NOT NULL,                    -- ownership share, 0-100
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,

    CONSTRAINT fk_partners_profile_id FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,

    CONSTRAINT ck_partners_id         CHECK (length(id) = 36),
    CONSTRAINT ck_partners_name       CHECK (length(name) <= 100),
    CONSTRAINT ck_partners_percentage CHECK (percentage >= 0 AND percentage <= 100),
    CONSTRAINT ck_partners_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_partners_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_partners_deleted_at CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_partners_profile_id ON partners (profile_id);


-- -----------------------------------------------------------------------------
-- 4.3 notes — a flat list of observations and reminders
-- -----------------------------------------------------------------------------
CREATE TABLE notes (
    id          TEXT NOT NULL PRIMARY KEY,
    profile_id  TEXT NOT NULL,
    note        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,

    CONSTRAINT fk_notes_profile_id FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,

    CONSTRAINT ck_notes_id         CHECK (length(id) = 36),
    CONSTRAINT ck_notes_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_notes_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_notes_deleted_at CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_notes_profile_id ON notes (profile_id);


-- -----------------------------------------------------------------------------
-- 4.4 accounts — a checking or investment account
-- -----------------------------------------------------------------------------
CREATE TABLE accounts (
    id                TEXT    NOT NULL PRIMARY KEY,
    profile_id        TEXT    NOT NULL,
    name              TEXT    NOT NULL,
    balance           REAL    NOT NULL,           -- derived cache, in the profile's currency
    currency          TEXT    NOT NULL,           -- ISO 4217; descriptive only
    consider_balance  INTEGER NOT NULL DEFAULT 1, -- bool: counts toward the consolidated balance
    type              INTEGER NOT NULL,           -- 1: checking account, 2: investment account
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at        TEXT    NOT NULL,
    deleted_at        TEXT,

    CONSTRAINT fk_accounts_profile_id FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,

    CONSTRAINT ck_accounts_id               CHECK (length(id) = 36),
    CONSTRAINT ck_accounts_name             CHECK (length(name) <= 45),
    CONSTRAINT ck_accounts_currency         CHECK (length(currency) = 3 AND currency = upper(currency)),
    CONSTRAINT ck_accounts_consider_balance CHECK (consider_balance IN (0, 1)),
    CONSTRAINT ck_accounts_type             CHECK (type IN (1, 2)),
    CONSTRAINT ck_accounts_created_at       CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_accounts_updated_at       CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_accounts_deleted_at       CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_accounts_profile_id ON accounts (profile_id);


-- -----------------------------------------------------------------------------
-- 4.5 credit_cards — owned by a profile, settled by an account
-- -----------------------------------------------------------------------------
CREATE TABLE credit_cards (
    id            TEXT    NOT NULL PRIMARY KEY,
    profile_id    TEXT    NOT NULL,
    account_id    TEXT    NOT NULL,               -- the settling account (same profile: app rule)
    name          TEXT    NOT NULL,
    limit_value   REAL    NOT NULL,               -- "limit" is a SQLite keyword
    closing_date  INTEGER NOT NULL,               -- day of month
    due_date      INTEGER NOT NULL,               -- day of month
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at    TEXT    NOT NULL,
    deleted_at    TEXT,

    CONSTRAINT fk_credit_cards_profile_id FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
    -- CASCADE, not RESTRICT: a card cannot exist without its settling account,
    -- and RESTRICT would block the profile cascade (design doc section 3.8).
    CONSTRAINT fk_credit_cards_account_id FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,

    CONSTRAINT ck_credit_cards_id           CHECK (length(id) = 36),
    CONSTRAINT ck_credit_cards_name         CHECK (length(name) <= 45),
    CONSTRAINT ck_credit_cards_closing_date CHECK (closing_date BETWEEN 1 AND 31),
    CONSTRAINT ck_credit_cards_due_date     CHECK (due_date BETWEEN 1 AND 31),
    CONSTRAINT ck_credit_cards_created_at   CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_credit_cards_updated_at   CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_credit_cards_deleted_at   CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_credit_cards_profile_id ON credit_cards (profile_id);
CREATE INDEX idx_credit_cards_account_id ON credit_cards (account_id);


-- -----------------------------------------------------------------------------
-- 4.6 bank_statements — one row per account per month
-- -----------------------------------------------------------------------------
CREATE TABLE bank_statements (
    id          TEXT    NOT NULL PRIMARY KEY,
    account_id  TEXT    NOT NULL,
    month       INTEGER NOT NULL,
    year        INTEGER NOT NULL,
    balance     REAL    NOT NULL,                 -- closing balance, derived cache
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at  TEXT    NOT NULL,
    deleted_at  TEXT,

    CONSTRAINT fk_bank_statements_account_id FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,

    CONSTRAINT ck_bank_statements_id         CHECK (length(id) = 36),
    CONSTRAINT ck_bank_statements_month      CHECK (month BETWEEN 1 AND 12),
    CONSTRAINT ck_bank_statements_year       CHECK (year BETWEEN 1900 AND 9999),
    CONSTRAINT ck_bank_statements_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_bank_statements_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_bank_statements_deleted_at CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_bank_statements_account_id ON bank_statements (account_id);
CREATE UNIQUE INDEX uq_bank_statements_account_period
    ON bank_statements (account_id, year, month)
    WHERE deleted_at IS NULL;


-- -----------------------------------------------------------------------------
-- 4.7 invoices — one row per credit card per month
-- -----------------------------------------------------------------------------
CREATE TABLE invoices (
    id                 TEXT    NOT NULL PRIMARY KEY,
    credit_card_id     TEXT    NOT NULL,
    bank_statement_id  TEXT,                      -- statement of the month the invoice is paid in; NULL until then
    month              INTEGER NOT NULL,
    year               INTEGER NOT NULL,
    balance            REAL    NOT NULL,          -- invoice total, derived cache
    created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at         TEXT    NOT NULL,
    deleted_at         TEXT,

    CONSTRAINT fk_invoices_credit_card_id    FOREIGN KEY (credit_card_id)    REFERENCES credit_cards (id)    ON DELETE CASCADE,
    CONSTRAINT fk_invoices_bank_statement_id FOREIGN KEY (bank_statement_id) REFERENCES bank_statements (id) ON DELETE SET NULL,

    CONSTRAINT ck_invoices_id         CHECK (length(id) = 36),
    CONSTRAINT ck_invoices_month      CHECK (month BETWEEN 1 AND 12),
    CONSTRAINT ck_invoices_year       CHECK (year BETWEEN 1900 AND 9999),
    CONSTRAINT ck_invoices_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_invoices_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_invoices_deleted_at CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_invoices_credit_card_id    ON invoices (credit_card_id);
CREATE INDEX idx_invoices_bank_statement_id ON invoices (bank_statement_id);
CREATE UNIQUE INDEX uq_invoices_credit_card_period
    ON invoices (credit_card_id, year, month)
    WHERE deleted_at IS NULL;


-- -----------------------------------------------------------------------------
-- 4.8 transaction_categories — upper level of the classification hierarchy
-- -----------------------------------------------------------------------------
CREATE TABLE transaction_categories (
    id          TEXT NOT NULL PRIMARY KEY,
    profile_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,

    CONSTRAINT fk_transaction_categories_profile_id FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,

    CONSTRAINT ck_transaction_categories_id         CHECK (length(id) = 36),
    CONSTRAINT ck_transaction_categories_name       CHECK (length(name) <= 45),
    CONSTRAINT ck_transaction_categories_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_transaction_categories_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_transaction_categories_deleted_at CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_transaction_categories_profile_id ON transaction_categories (profile_id);
CREATE UNIQUE INDEX uq_transaction_categories_profile_name
    ON transaction_categories (profile_id, name COLLATE NOCASE)
    WHERE deleted_at IS NULL;


-- -----------------------------------------------------------------------------
-- 4.9 transaction_sub_categories — lower level; every transaction points here
-- -----------------------------------------------------------------------------
CREATE TABLE transaction_sub_categories (
    id           TEXT NOT NULL PRIMARY KEY,
    category_id  TEXT NOT NULL,
    name         TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,

    CONSTRAINT fk_transaction_sub_categories_category_id FOREIGN KEY (category_id) REFERENCES transaction_categories (id) ON DELETE CASCADE,

    CONSTRAINT ck_transaction_sub_categories_id         CHECK (length(id) = 36),
    CONSTRAINT ck_transaction_sub_categories_name       CHECK (length(name) <= 45),
    CONSTRAINT ck_transaction_sub_categories_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_transaction_sub_categories_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_transaction_sub_categories_deleted_at CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_transaction_sub_categories_category_id ON transaction_sub_categories (category_id);
CREATE UNIQUE INDEX uq_transaction_sub_categories_category_name
    ON transaction_sub_categories (category_id, name COLLATE NOCASE)
    WHERE deleted_at IS NULL;


-- -----------------------------------------------------------------------------
-- 4.10 tags — free-form labels, many-to-many with transactions
-- -----------------------------------------------------------------------------
CREATE TABLE tags (
    id          TEXT NOT NULL PRIMARY KEY,
    profile_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,

    CONSTRAINT fk_tags_profile_id FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,

    CONSTRAINT ck_tags_id         CHECK (length(id) = 36),
    CONSTRAINT ck_tags_name       CHECK (length(name) <= 45),
    CONSTRAINT ck_tags_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_tags_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_tags_deleted_at CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_tags_profile_id ON tags (profile_id);
CREATE UNIQUE INDEX uq_tags_profile_name
    ON tags (profile_id, name COLLATE NOCASE)
    WHERE deleted_at IS NULL;


-- -----------------------------------------------------------------------------
-- 4.11 goals — a target funded by linked transactions; progress is computed
-- -----------------------------------------------------------------------------
CREATE TABLE goals (
    id           TEXT NOT NULL PRIMARY KEY,
    profile_id   TEXT NOT NULL,
    name         TEXT NOT NULL,
    value        REAL NOT NULL,                   -- target amount
    target_date  TEXT,                            -- NULL: open-ended goal
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,

    CONSTRAINT fk_goals_profile_id FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,

    CONSTRAINT ck_goals_id          CHECK (length(id) = 36),
    CONSTRAINT ck_goals_name        CHECK (length(name) <= 45),
    CONSTRAINT ck_goals_target_date CHECK (target_date IS strftime('%Y-%m-%d', target_date)),
    CONSTRAINT ck_goals_created_at  CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_goals_updated_at  CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_goals_deleted_at  CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_goals_profile_id ON goals (profile_id);


-- -----------------------------------------------------------------------------
-- 4.12 recurrences — the rule that emits repeating transactions
-- -----------------------------------------------------------------------------
CREATE TABLE recurrences (
    id                    TEXT    NOT NULL PRIMARY KEY,
    profile_id            TEXT    NOT NULL,
    type                  INTEGER NOT NULL,       -- 1: installments, 2: fixed
    recurrence            INTEGER NOT NULL,       -- 1: daily, 2: weekly, 3: monthly, 4: yearly
    installments          INTEGER,                -- type = 1 only
    value_type            INTEGER,                -- 1: total, 2: per_installment; type = 1 only
    end_at                TEXT,                   -- type = 2 only; NULL = endless
    materialized_through  TEXT    NOT NULL,       -- watermark; only moves forward
    created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at            TEXT    NOT NULL,
    deleted_at            TEXT,

    CONSTRAINT fk_recurrences_profile_id FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,

    CONSTRAINT ck_recurrences_id                   CHECK (length(id) = 36),
    CONSTRAINT ck_recurrences_type                 CHECK (type IN (1, 2)),
    CONSTRAINT ck_recurrences_recurrence           CHECK (recurrence IN (1, 2, 3, 4)),
    CONSTRAINT ck_recurrences_installments         CHECK (installments IS NULL OR installments > 0),
    CONSTRAINT ck_recurrences_value_type           CHECK (value_type IS NULL OR value_type IN (1, 2)),
    CONSTRAINT ck_recurrences_end_at               CHECK (end_at IS strftime('%Y-%m-%d', end_at)),
    CONSTRAINT ck_recurrences_materialized_through CHECK (materialized_through IS strftime('%Y-%m-%d', materialized_through)),
    CONSTRAINT ck_recurrences_created_at           CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_recurrences_updated_at           CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_recurrences_deleted_at           CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_recurrences_profile_id ON recurrences (profile_id);


-- -----------------------------------------------------------------------------
-- 4.13 transactions — the central entity
-- -----------------------------------------------------------------------------
CREATE TABLE transactions (
    id                      TEXT    NOT NULL PRIMARY KEY,
    sub_category_id         TEXT    NOT NULL,
    bank_statement_id       TEXT,                 -- exclusive with invoice_id (app rule)
    invoice_id              TEXT,                 -- exclusive with bank_statement_id (app rule)
    destination_account_id  TEXT,                 -- type 3 and 4 only
    partner_id              TEXT,                 -- who paid; business profiles only, optional
    goal_id                 TEXT,
    recurrence_id           TEXT,                 -- set only on rule-emitted occurrences
    name                    TEXT    NOT NULL,
    description             TEXT,
    value                   REAL    NOT NULL,     -- ALWAYS already converted into the profile's currency
    currency                TEXT    NOT NULL,     -- origin currency; provenance only
    conversion_rate         REAL    NOT NULL DEFAULT 1, -- provenance only; reports never multiply by it
    due_date                TEXT    NOT NULL,
    paid                    INTEGER NOT NULL DEFAULT 0,
    payment_date            TEXT,
    charges                 REAL    NOT NULL DEFAULT 0, -- fees / interest on top of value
    type                    INTEGER NOT NULL,     -- 1: income, 2: expense, 3: transference, 4: investment
    created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at              TEXT    NOT NULL,
    deleted_at              TEXT,

    -- Vocabulary: NO ACTION (checked at end of statement), deliberately not
    -- RESTRICT (checked immediately, which would break the profile cascade).
    CONSTRAINT fk_transactions_sub_category_id        FOREIGN KEY (sub_category_id)        REFERENCES transaction_sub_categories (id) ON DELETE NO ACTION,
    -- Ownership: the containers.
    CONSTRAINT fk_transactions_bank_statement_id      FOREIGN KEY (bank_statement_id)      REFERENCES bank_statements (id)            ON DELETE CASCADE,
    CONSTRAINT fk_transactions_invoice_id             FOREIGN KEY (invoice_id)             REFERENCES invoices (id)                   ON DELETE CASCADE,
    -- References: the transaction survives the other side.
    CONSTRAINT fk_transactions_destination_account_id FOREIGN KEY (destination_account_id) REFERENCES accounts (id)                   ON DELETE SET NULL,
    CONSTRAINT fk_transactions_partner_id             FOREIGN KEY (partner_id)             REFERENCES partners (id)                   ON DELETE SET NULL,
    CONSTRAINT fk_transactions_goal_id                FOREIGN KEY (goal_id)                REFERENCES goals (id)                      ON DELETE SET NULL,
    CONSTRAINT fk_transactions_recurrence_id          FOREIGN KEY (recurrence_id)          REFERENCES recurrences (id)                ON DELETE SET NULL,

    CONSTRAINT ck_transactions_id           CHECK (length(id) = 36),
    CONSTRAINT ck_transactions_name         CHECK (length(name) <= 100),
    CONSTRAINT ck_transactions_currency     CHECK (length(currency) = 3 AND currency = upper(currency)),
    CONSTRAINT ck_transactions_due_date     CHECK (due_date IS strftime('%Y-%m-%d', due_date)),
    CONSTRAINT ck_transactions_paid         CHECK (paid IN (0, 1)),
    CONSTRAINT ck_transactions_payment_date CHECK (payment_date IS strftime('%Y-%m-%d', payment_date)),
    CONSTRAINT ck_transactions_type         CHECK (type IN (1, 2, 3, 4)),
    CONSTRAINT ck_transactions_created_at   CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_transactions_updated_at   CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_transactions_deleted_at   CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_transactions_sub_category_id        ON transactions (sub_category_id);
CREATE INDEX idx_transactions_bank_statement_id      ON transactions (bank_statement_id);
CREATE INDEX idx_transactions_invoice_id             ON transactions (invoice_id);
CREATE INDEX idx_transactions_destination_account_id ON transactions (destination_account_id);
CREATE INDEX idx_transactions_partner_id             ON transactions (partner_id);
CREATE INDEX idx_transactions_goal_id                ON transactions (goal_id);
CREATE INDEX idx_transactions_recurrence_id          ON transactions (recurrence_id);
CREATE INDEX idx_transactions_due_date               ON transactions (due_date);
-- Backstop against double generation of a recurrence occurrence.
CREATE UNIQUE INDEX uq_transactions_recurrence_due_date
    ON transactions (recurrence_id, due_date)
    WHERE deleted_at IS NULL AND recurrence_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 4.14 transactions_tags — many-to-many join
-- -----------------------------------------------------------------------------
CREATE TABLE transactions_tags (
    id              TEXT NOT NULL PRIMARY KEY,
    transaction_id  TEXT NOT NULL,
    tag_id          TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,

    CONSTRAINT fk_transactions_tags_transaction_id FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE,
    CONSTRAINT fk_transactions_tags_tag_id         FOREIGN KEY (tag_id)         REFERENCES tags (id)         ON DELETE CASCADE,

    CONSTRAINT ck_transactions_tags_id         CHECK (length(id) = 36),
    CONSTRAINT ck_transactions_tags_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_transactions_tags_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_transactions_tags_deleted_at CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_transactions_tags_transaction_id ON transactions_tags (transaction_id);
CREATE INDEX idx_transactions_tags_tag_id         ON transactions_tags (tag_id);
CREATE UNIQUE INDEX uq_transactions_tags_pair
    ON transactions_tags (transaction_id, tag_id)
    WHERE deleted_at IS NULL;


-- -----------------------------------------------------------------------------
-- 4.15 attachments — file name only; bytes live on disk at
--      profile/{profileID}/attachments/{transactionID}/{attachmentName}
-- -----------------------------------------------------------------------------
CREATE TABLE attachments (
    id              TEXT NOT NULL PRIMARY KEY,
    transaction_id  TEXT NOT NULL,
    name            TEXT NOT NULL,                -- original file name, extension included; a path component
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,

    CONSTRAINT fk_attachments_transaction_id FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE,

    CONSTRAINT ck_attachments_id         CHECK (length(id) = 36),
    CONSTRAINT ck_attachments_name       CHECK (length(name) BETWEEN 1 AND 255 AND instr(name, '/') = 0 AND instr(name, '\') = 0),
    CONSTRAINT ck_attachments_created_at CHECK (created_at IS strftime('%Y-%m-%d %H:%M:%S', created_at)),
    CONSTRAINT ck_attachments_updated_at CHECK (updated_at IS strftime('%Y-%m-%d %H:%M:%S', updated_at)),
    CONSTRAINT ck_attachments_deleted_at CHECK (deleted_at IS strftime('%Y-%m-%d %H:%M:%S', deleted_at))
) STRICT;

CREATE INDEX idx_attachments_transaction_id ON attachments (transaction_id);
CREATE UNIQUE INDEX uq_attachments_transaction_name
    ON attachments (transaction_id, name COLLATE NOCASE)
    WHERE deleted_at IS NULL;
