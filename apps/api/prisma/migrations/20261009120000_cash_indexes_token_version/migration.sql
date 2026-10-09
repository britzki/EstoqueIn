-- Versão do login: trocar ou redefinir a senha invalida as sessões abertas antes disso.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Resumo do caixa: vendas, devoluções e pagamentos de fiado são buscados pelo caixa.
CREATE INDEX "Sale_cashSessionId_idx" ON "Sale"("cashSessionId");
CREATE INDEX "SaleReturn_cashSessionId_idx" ON "SaleReturn"("cashSessionId");
CREATE INDEX "CustomerPayment_cashSessionId_idx" ON "CustomerPayment"("cashSessionId");
