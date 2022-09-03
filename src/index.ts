import { Connection, PublicKey, SlotUpdate } from "@solana/web3.js";

const conn = new Connection("https://testnet.rpcpool.com");
const commitment = "confirmed";
const votePk = new PublicKey("Vote111111111111111111111111111111111111111");

import { Modifier, PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const sliceInto = <T>(items: T[], length: number) =>
  items.reduce((chunks: T[][], item: T, index) => {
    const offset = Math.floor(index / length);
    chunks[offset] = ([] as T[]).concat(chunks[offset] || [], item);
    return chunks;
  }, []);

async function onSlotUpdate(slotUpdate: SlotUpdate) {
  if (slotUpdate.type == "optimisticConfirmation") console.log(slotUpdate);
}

async function getBlockMeta() {
  const version = await conn.getVersion();
  console.log({ version });
  const slot = await conn.getSlot(commitment);
  console.log({ slot });
  const block = await conn.getBlock(slot, { commitment });
  console.log({ block });
  const tx = block?.transactions[0];
  console.log("tx", tx);
}

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

async function main() {
  const lastSlot = await getLastSlot();
  const newSlots = await conn.getBlocks(lastSlot, undefined, commitment);
  newSlots.shift();
  console.log("newSlots", newSlots);

  for (let slot of newSlots) {
    const block = await conn.getBlock(slot, { commitment });
    const leader = block!.rewards!.find((r) => r.rewardType == "Fee")!.pubkey;

    let nonVoteTxs = block!.transactions.filter(
      (tx) => !tx.transaction.message.programIds()[0].equals(votePk)
    );

    const uniqueAccountKeys = new Set(
      nonVoteTxs
        .map((tx) =>
          tx.transaction.message.accountKeys.map((p) => p.toString())
        )
        .flat(1)
    );

    const txToCreate = nonVoteTxs.map((tx) => ({
      hash: tx.transaction.signatures[0],
      slotId: slot,
      CUConsumed: tx.meta?.computeUnitsConsumed!,
      CURequested: tx.transaction.message.instructions.length * 200000,
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

      const { accountKeys, header } = tx.transaction.message;
      const numAccounts = accountKeys.length;
      const numWriteableSigners =
        header.numRequiredSignatures - header.numReadonlySignedAccounts;
      const lockedSigners = accountKeys
        .slice(0, numWriteableSigners)
        .map((p) => ({
          txId,
          addressId: idByAddress[p.toString()],
          modifier: Modifier.SIGNER,
        }));

      const numWritrableNonSigners =
        numAccounts -
        header.numRequiredSignatures -
        header.numReadonlyUnsignedAccounts;

      const lockedNonsigners = accountKeys
        .slice(
          header.numRequiredSignatures,
          header.numRequiredSignatures + numWritrableNonSigners
        )
        .map((p) => ({
          txId,
          addressId: idByAddress[p.toString()],
          modifier: Modifier.NONE,
        }));

      const programIds = tx.transaction.message.programIds().map((p) => ({
        txId,
        addressId: idByAddress[p.toString()],
        modifier: Modifier.PROGRAM,
      }));

      recordedAccounts.push(
        ...lockedSigners,
        ...lockedNonsigners,
        ...programIds
      );
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
  }

  // main();
}

main();
