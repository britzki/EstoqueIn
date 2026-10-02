-- Troco fixo da gaveta e quanto ficou nela ao fechar o caixa.
ALTER TABLE "StoreSettings" ADD COLUMN "cashFloatCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CashSession" ADD COLUMN "keptCents" INTEGER;
