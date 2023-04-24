import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { Connection, PublicKey } from "@solana/web3.js";

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

async function indexBlock(slot: number) {
  try {
    const block = await conn.getBlock(slot, { commitment, maxSupportedTransactionVersion: 1, rewards: true, transactionDetails: "full" });
    const leader = block!.rewards!.find((r) => r.rewardType == "Fee")!.pubkey;

    let nonVoteTxs = block!.transactions.filter(
      (tx) => !tx.transaction.message.compiledInstructions.find(i => tx.transaction.message.staticAccountKeys[i.programIdIndex].equals(votePk))
    );

    const uniqueAccountKeys = new Set(
      nonVoteTxs
        .map(tx => tx.transaction.message.getAccountKeys({accountKeysFromLookups: tx.meta?.loadedAddresses}).keySegments())
        .flat(2)
        .map(pk => pk.toString())
    );

    const txToCreate = nonVoteTxs.map((tx) => ({
      hash: tx.transaction.signatures[0],
      slotId: slot,
      CUConsumed: tx.meta?.computeUnitsConsumed!,
      CURequested: tx.transaction.message.compiledInstructions.length * 200000,
    }));

    const addrsToCreate = Array.from(uniqueAccountKeys.values())
      .map((a) => ({ address: a }))
      .concat([{ address: leader }]);

    await Promise.all([
      prisma.transaction.createMany({ data: txToCreate, skipDuplicates: true }),
      prisma.accountAddress.createMany({
        data: addrsToCreate,
        skipDuplicates: true,
      }),
    ]);
    const [txIds, addressIds] = await Promise.all([
      prisma.transaction.findMany({
        select: { id: true, hash: true },
        where: {
          hash: {
            in: nonVoteTxs.map((tx) => tx.transaction.signatures[0]),
          },
        },
      }),

      prisma.accountAddress.findMany({
        where: { address: { in: Array.from(uniqueAccountKeys.values()) } },
      }),
    ]);
    const idByAddress = Object.fromEntries(
      addressIds.map((aid) => [aid.address, aid.id])
    );

    let recordedAccounts = [];
    for (let tx of nonVoteTxs) {
      const { id: txId } = txIds.find(
        (txid) => txid.hash == tx.transaction.signatures[0]
      )!;
      const programIds = tx.transaction.message.compiledInstructions.map(i => tx.transaction.message.staticAccountKeys[i.programIdIndex]);
      const accountKeys = tx.transaction.message.getAccountKeys({accountKeysFromLookups: tx.meta?.loadedAddresses}).keySegments().flat(1);
      recordedAccounts.push(...accountKeys.map((k, i) => ({
        txId,
        addressId: idByAddress[k.toString()],
        flags: (tx.transaction.message.isAccountWritable(i) ? 1 : 0) + (tx.transaction.message.isAccountSigner(i) ? 4 : programIds.includes(k) ? 8 : 0)
      })));
    }

    await prisma.accountKey.createMany({
      data: recordedAccounts,
      skipDuplicates: true,
    });

    await prisma.slot.create({
      data: {
        id: slot,
        parentId: block!.parentSlot,
        leaderId: idByAddress[leader],
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
      "uniqueAccounts:",
      uniqueAccountKeys.size,
      "accountInfos:",
      recordedAccounts.length,
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


  // for (let s of newSlots) {
  //   await indexBlock(s);
  // }
  await eachLimit(
    newSlots.map((s) => indexBlock(s)),
    5
  );

  main();
}

main();
