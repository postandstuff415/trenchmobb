import {
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  fetchAddressesForLookupTables,
  getBase64Decoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Base64EncodedWireTransaction,
  type Instruction,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from '@solana/kit';
import { VersionedTransaction } from '@solana/web3.js';
import { config } from '../config';
import { computeUnitLimitIx, computeUnitPriceIx, withoutComputeBudget } from './instructions';

const MAX_TX_BYTES = 1232;
const CU_LIMIT = 1_400_000;

/** A set of instructions that must land together, in order. */
export type IxGroup = { label: string; ixs: Instruction[]; luts: Address[] };

export type SignAll = (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>;

type Blockhash = Parameters<typeof setTransactionMessageLifetimeUsingBlockhash>[0];

function compile(
  payer: Address,
  blockhash: Blockhash,
  ixs: Instruction[],
  lutAddresses: Awaited<ReturnType<typeof fetchAddressesForLookupTables>>,
): Uint8Array | null {
  try {
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(payer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) =>
        appendTransactionMessageInstructions(
          [computeUnitLimitIx(CU_LIMIT), computeUnitPriceIx(config.priorityMicroLamports), ...withoutComputeBudget(ixs)],
          m,
        ),
      (m) => compressTransactionMessageUsingAddressLookupTables(m, lutAddresses),
    );
    const bytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
    return bytes.length <= MAX_TX_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

async function confirm(rpc: Rpc<SolanaRpcApi>, sig: Signature, lastValidBlockHeight: bigint) {
  for (;;) {
    const { value } = await rpc.getSignatureStatuses([sig]).send();
    const status = value[0];
    if (status?.err) throw new Error(`Transaction ${sig} failed: ${JSON.stringify(status.err, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return;
    const height = await rpc.getBlockHeight().send();
    if (height > lastValidBlockHeight) throw new Error(`Transaction ${sig} expired before confirming. Please retry.`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * Packs every group into one atomic transaction when it fits. Otherwise sends one
 * transaction per group, in order, waiting for each to confirm before the next.
 * The wallet is asked to sign once either way.
 */
export async function sendGroups(
  rpc: Rpc<SolanaRpcApi>,
  payer: Address,
  signAll: SignAll,
  groups: IxGroup[],
  onStatus: (s: string) => void = () => {},
): Promise<Signature[]> {
  onStatus('Preparing transaction…');
  const { value: latest } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const allLuts = [...new Set(groups.flatMap((g) => g.luts))];
  const lutAddresses = allLuts.length ? await fetchAddressesForLookupTables(allLuts, rpc) : {};

  let wires: Uint8Array[];
  const single = compile(payer, latest, groups.flatMap((g) => g.ixs), lutAddresses);
  if (single) {
    wires = [single];
  } else {
    wires = groups.map((g) => {
      const bytes = compile(payer, latest, g.ixs, lutAddresses);
      if (!bytes) throw new Error(`"${g.label}" is too large for a single Solana transaction. Try a token with a simpler swap route.`);
      return bytes;
    });
  }

  onStatus(wires.length > 1 ? `Approve ${wires.length} transactions in your wallet…` : 'Approve in your wallet…');
  const signed = await signAll(wires.map((w) => VersionedTransaction.deserialize(w)));

  const sigs: Signature[] = [];
  for (let i = 0; i < signed.length; i++) {
    onStatus(wires.length > 1 ? `Sending transaction ${i + 1}/${signed.length}…` : 'Sending…');
    const wire = getBase64Decoder().decode(signed[i].serialize()) as Base64EncodedWireTransaction;
    const sig = await rpc
      .sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5n })
      .send();
    sigs.push(sig);
    onStatus('Confirming…');
    await confirm(rpc, sig, latest.lastValidBlockHeight);
  }
  return sigs;
}
