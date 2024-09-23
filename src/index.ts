import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { AddressLookupTableAccount, ComputeBudgetInstruction, ComputeBudgetProgram, Connection, PublicKey } from "@solana/web3.js";
import * as lo from "@solana/buffer-layout";

const prisma = new PrismaClient();
dotenv.config();
const { RPC_URL } = process.env;
const conn = new Connection(RPC_URL!);
const commitment = "confirmed";
const votePk = new PublicKey("Vote111111111111111111111111111111111111111");

const reset = false;
// const reset = true;

async function getLastSlot() {
  let firstSlot = await prisma.slot.findFirst({
    orderBy: [{ id: "desc" }],
  });
  if (firstSlot && !reset) {
    console.log("found last slot in db", firstSlot.id);
    return firstSlot.id;
  } else {
    const epochInfo = await conn.getEpochInfo(commitment);
    return epochInfo.absoluteSlot - 50;
  }
}

const tipPaymentAddresses = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];


const altCache: {[pk: string]: AddressLookupTableAccount} = {};


async function indexBlock(slot: number) {
  try {
    const block = await conn.getBlock(slot, { commitment, maxSupportedTransactionVersion: 1, rewards: true, transactionDetails: "full" });
    const leader = block!.rewards!.find((r) => r.rewardType == "Fee")!.pubkey;

    const nonVoteTxs = block!.transactions.filter(
      (tx) => !tx.transaction.message.compiledInstructions.find(i => tx.transaction.message.staticAccountKeys[i.programIdIndex].equals(votePk))
    );

    const alts = new Set(nonVoteTxs.flatMap(tx => tx.transaction.message.addressTableLookups.map(alt => alt.accountKey)));
    const altPks = [...alts.keys()];

    // update ALT cache
    const newAltPks = altPks.filter(pk => !altCache[pk.toString()]);
    const newAltAis = await conn.getMultipleAccountsInfo(newAltPks);
    newAltPks.forEach(
      (key, i) => {
        let alt = new AddressLookupTableAccount({
          key,
          state: AddressLookupTableAccount.deserialize(newAltAis[i]!.data),
        })
        altCache[key.toString()] = alt;
      }
    );


    const txToCreate = nonVoteTxs.map((tx) => {
      const hash = tx.transaction.signatures[0];
      const CUConsumed = tx.meta?.computeUnitsConsumed!;
      const CURequested = tx.transaction.message.compiledInstructions.length * 200000;

      // decode account keys
      const addressLookupTableAccounts = tx.transaction.message.addressTableLookups.map(alt => altCache[alt.accountKey.toString()]);
      const accountKeys = tx.transaction.message.getAccountKeys({ addressLookupTableAccounts }).keySegments().flat();

      // calculate jito tip
      let TipPaid = 0;
      for (let i = 0; i < accountKeys.length; ++i) {
        const address = accountKeys[i].toString();
        if (tipPaymentAddresses.includes(address)) {
          TipPaid = tx.meta!.postBalances[i] - tx.meta!.preBalances[i];
        }
      }

      // calculate priorioty fee
      let PriorityPaid = 0;
      const computeBudgetIndex = accountKeys.findIndex(k => k.equals(ComputeBudgetProgram.programId));
      const computeLimitIx = tx.transaction.message.compiledInstructions.find(ix => ix.programIdIndex == computeBudgetIndex && ix.data[0] == 3);
      if (computeLimitIx) {
        PriorityPaid = lo.nu64().decode(computeLimitIx.data, 1)
      }

      return {
        hash,
        slotId: slot,
        CUConsumed,
        CURequested,
        TipPaid,
        PriorityPaid,
      };
    }
    );

    const addrsToCreate = [{ address: leader }];

    await Promise.all([
      prisma.transaction.createMany({ data: txToCreate, skipDuplicates: true }),
      prisma.accountAddress.createMany({
        data: addrsToCreate,
        skipDuplicates: true,
      }),
    ]);

    const leaderId = await prisma.accountAddress.findFirst({
      where: { address: { equals: leader } },
    });

    await prisma.slot.create({
      data: {
        id: slot,
        parentId: block!.parentSlot,
        leaderId: leaderId!.id,
        blockTime: new Date(block!.blockTime! * 1000),
      },
    });

    console.log(
      new Date(),
      "finished indexing slot",
      slot,
      "leader:",
      leader,
      "txs:",
      block?.transactions.length,
      "nonVoteTxs:",
      nonVoteTxs.length,
      "compute:",
      txToCreate.reduce((prev, current) => prev + current.CUConsumed, 0)
    );
  } catch (e) {
    console.error("could not index block", slot, e);
  }
}

async function eachLimit<T>(promises: Array<Promise<T>>, limit: number) {
  let rest = promises.slice(limit);
  await Promise.all(
    promises.slice(0, limit).map(async (prom: Promise<T>) => {
      await prom;
      while (rest.length) {
        await rest.shift();
      }
    })
  );
}

async function main() {
  const lastSlot = await getLastSlot();
  const newSlots = await conn.getBlocks(lastSlot, undefined, commitment);
  newSlots.shift();
  console.log("fetch slots", newSlots);


  for (let s of newSlots) {
    await indexBlock(s);
  }
  // await eachLimit(
  //   newSlots.map((s) => indexBlock(s)),
  //   5
  // );

  main();
}

main();
