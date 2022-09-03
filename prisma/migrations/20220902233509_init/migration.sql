-- CreateEnum
CREATE TYPE "Modifier" AS ENUM ('NONE', 'SIGNER', 'PROGRAM');

-- CreateTable
CREATE TABLE "Slot" (
    "id" INTEGER NOT NULL,
    "parentId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "hash" TEXT NOT NULL,
    "slotId" INTEGER NOT NULL,
    "CUConsumed" INTEGER NOT NULL,
    "CURequested" INTEGER NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountKey" (
    "id" SERIAL NOT NULL,
    "txId" INTEGER NOT NULL,
    "addressId" INTEGER NOT NULL,
    "modifier" "Modifier" NOT NULL DEFAULT 'NONE',

    CONSTRAINT "AccountKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountAddress" (
    "id" SERIAL NOT NULL,
    "address" TEXT NOT NULL,

    CONSTRAINT "AccountAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_hash_key" ON "Transaction"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "AccountAddress_address_key" ON "AccountAddress"("address");
