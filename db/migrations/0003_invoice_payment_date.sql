-- =============================================================================
-- 0003_invoice_payment_date.sql
--
-- Dia do pagamento da fatura (database-design §4.7; desktop-mvp-plan Fase 7).
--
-- Regra de negócio (Fatura): pagar vincula a fatura ao extrato do mês do
-- pagamento (`bank_statement_id`), e é esse vínculo que decide se a fatura está
-- paga e em que mês ela pesa no saldo. O vínculo guarda só o mês; o extrato da
-- conta precisa também do dia, para mostrar a fatura paga na data em que o
-- dinheiro saiu, entre os outros movimentos do mês.
--
-- A coluna é nula enquanto a fatura está em aberto, e também nas faturas pagas
-- antes desta migration: o dia nunca foi gravado, e inventá-lo (o primeiro ou o
-- último do mês) mostraria uma data que não aconteceu. Ela não decide nada — a
-- situação continua sendo a do `bank_statement_id` —, então uma data órfã, que o
-- `ON DELETE SET NULL` do extrato pode deixar, é ignorada nas leituras.
-- =============================================================================

ALTER TABLE invoices ADD COLUMN payment_date TEXT
    CONSTRAINT ck_invoices_payment_date CHECK (payment_date IS strftime('%Y-%m-%d', payment_date));
