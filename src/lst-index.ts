import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { AccountInfo, AddressLookupTableAccount, ComputeBudgetInstruction, ComputeBudgetProgram, Connection, PublicKey, VoteAccount } from "@solana/web3.js";
import * as lo from "@solana/buffer-layout";
import { LstList } from "sanctum-lst-list"
import { fetch } from "undici";

const prisma = new PrismaClient();
dotenv.config();
const { RPC_URL } = process.env;
const conn = new Connection(RPC_URL!);
const commitment = "confirmed";
const votePk = new PublicKey("Vote111111111111111111111111111111111111111");


async function main() {

  const lsts = LstList.flatMap(({ name, mint, pool }) => {
    const votePk = (pool as any).voteAccount;
    if (votePk) {
      return [{ name, mint, votePk }];
    } else {
      return [];
    }
  });

  const lstVoteAis = await conn.getMultipleAccountsInfo(lsts.map(lst => new PublicKey(lst.votePk)));
  const lstPricesByMint = (await (await fetch(`https://price.jup.ag/v6/price?ids=${lsts.map(lst => lst.mint)}&vsToken=So11111111111111111111111111111111111111112`)).json() as any)['data'];

  let data = []
  for (let i = 0; i < lsts.length; ++i) {
    const { nodePubkey } = VoteAccount.fromAccountData(lstVoteAis[i]!.data);
    console.log(lsts[i].name, lsts[i].mint);
    const { price } = lstPricesByMint[lsts[i].mint];
    data.push({ ...lsts[i], signer: nodePubkey.toString(), price });
  }

  console.log('saving prices for', data.length, 'lsts');
  await prisma.lst.createMany({data})

  setTimeout(main, 100 * 1000);
}

main()