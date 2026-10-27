import { createSolanaRpc, type Address } from '@solana/kit';
import {
  DEFAULT_RECENT_SLOT_DURATION_MS,
  FloatRateReserveKind,
  KaminoMarket,
  PROGRAM_ID,
  VanillaObligation,
  type KaminoObligation,
  type KaminoReserve,
} from '@kamino-finance/klend-sdk';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import { config } from '../config';

export const rpc = createSolanaRpc(config.rpcUrl);

const floatRate = new FloatRateReserveKind();

export async function loadMarket(): Promise<KaminoMarket> {
  const market = await KaminoMarket.load(rpc, config.market, DEFAULT_RECENT_SLOT_DURATION_MS, PROGRAM_ID);
  if (!market) throw new Error(`Kamino market ${config.market} not found on this RPC's cluster.`);
  return market;
}

export function collateralReserve(market: KaminoMarket): KaminoReserve {
  const reserve = market.getReserveByMintAndKind(config.collateralMint, floatRate);
  if (!reserve) throw new Error(`Market has no open-term reserve for collateral mint ${config.collateralMint}.`);
  return reserve;
}

/** Reserves users can short: every borrowable open-term reserve except the collateral (or the allowlist, if set). */
export function shortableReserves(market: KaminoMarket): KaminoReserve[] {
  return market
    .getReserves()
    .filter((r) => floatRate.matches(r))
    .filter((r) => r.getLiquidityMint() !== config.collateralMint)
    .filter((r) => (config.shortableMints.length ? config.shortableMints.includes(r.getLiquidityMint()) : true))
    .filter((r) => r.stats.reserveBorrowLimit.gt(0))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function loadObligation(market: KaminoMarket, owner: Address): Promise<KaminoObligation | null> {
  const pda = await new VanillaObligation(PROGRAM_ID).toPda(market.getAddress(), owner);
  return market.getObligationByAddress(pda);
}

export function toBaseUnits(amount: Decimal.Value, decimals: number): BN {
  return new BN(new Decimal(amount).mul(new Decimal(10).pow(decimals)).floor().toFixed(0));
}

export async function tokenBalance(owner: Address, mint: Address): Promise<{ raw: bigint; ui: number }> {
  const { value } = await rpc.getTokenAccountsByOwner(owner, { mint }, { encoding: 'jsonParsed' }).send();
  let raw = 0n;
  let decimals = 0;
  for (const acc of value) {
    const info = (acc.account.data as { parsed: { info: { tokenAmount: { amount: string; decimals: number } } } }).parsed.info;
    raw += BigInt(info.tokenAmount.amount);
    decimals = info.tokenAmount.decimals;
  }
  return { raw, ui: Number(raw) / 10 ** decimals };
}

export async function solBalance(owner: Address): Promise<number> {
  const { value } = await rpc.getBalance(owner).send();
  return Number(value) / 1e9;
}
