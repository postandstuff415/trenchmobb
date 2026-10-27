import { AccountRole, address, type Address, type Instruction } from '@solana/kit';
import { config } from '../config';

export type JupQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  [k: string]: unknown;
};

type JupIx = {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
};

function headers(): HeadersInit {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (config.jupApiKey) h['x-api-key'] = config.jupApiKey;
  return h;
}

export async function getQuote(inputMint: Address, outputMint: Address, amount: bigint): Promise<JupQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: String(config.slippageBps),
    swapMode: 'ExactIn',
    // Keep the route small so it fits in one transaction next to the Kamino instructions.
    maxAccounts: '32',
  });
  const res = await fetch(`${config.jupApi}/quote?${params}`, { headers: headers() });
  if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function toIx(ix: JupIx): Instruction {
  return {
    programAddress: address(ix.programId),
    accounts: ix.accounts.map((a) => ({
      address: address(a.pubkey),
      role: a.isSigner
        ? a.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
        : a.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY,
    })),
    data: Uint8Array.from(atob(ix.data), (c) => c.charCodeAt(0)),
  };
}

export async function getSwapInstructions(
  quote: JupQuote,
  user: Address,
): Promise<{ ixs: Instruction[]; luts: Address[] }> {
  const res = await fetch(`${config.jupApi}/swap-instructions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: user,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: false,
    }),
  });
  if (!res.ok) throw new Error(`Jupiter swap-instructions failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  if (body.error) throw new Error(`Jupiter: ${body.error}`);
  const ixs: Instruction[] = [
    ...(body.setupInstructions ?? []).map(toIx),
    toIx(body.swapInstruction),
    ...(body.cleanupInstruction ? [toIx(body.cleanupInstruction)] : []),
  ];
  return { ixs, luts: (body.addressLookupTableAddresses ?? []).map((a: string) => address(a)) };
}
