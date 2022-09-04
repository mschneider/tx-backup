-- CreateIndex
CREATE INDEX "AccountKey_txId_idx" ON "AccountKey"("txId");

-- CreateIndex
CREATE INDEX "AccountKey_addressId_idx" ON "AccountKey"("addressId");

-- CreateIndex
CREATE INDEX "Transaction_slotId_idx" ON "Transaction"("slotId");
