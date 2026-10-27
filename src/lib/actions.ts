import { createNoopSigner, type Address, type Signature } from '@solana/kit';
import {
  getCurrentLedgerInstant,
  KaminoAction,
  PROGRAM_ID,
  U64_MAX,
  VanillaObligation,
  type KaminoMarket,
  type KaminoObligation,
  type KaminoReserve,
} from '@kamino-finance/klend-sdk';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import { platformFeeIx } from './fee';
import { getQuote, getSwapInstructions } from './jupiter';
import { collateralReserve, rpc, toBaseUnits, tokenBalance } from './kamino';
import { sendGroups, type IxGroup, type SignAll } from './tx';

type Ctx = {
  market: KaminoMarket;
  owner: Address;
  obligation: KaminoObligation | null;
  signAll: SignAll;
  onStatus?: (s: string) => void;
};

const NO_LUT_INIT = { skipInitialization: false, skipLutCreation: true };

/**
 * Open a short: [platform fee] + [deposit USDC collateral, borrow meme] + [sell meme -> USDC on Jupiter].
 * The fee rides in the same transaction as the borrow, so it is never charged unless the short opens.
 */
export async function openShort(
  ctx: Ctx,
  memeReserve: KaminoReserve,
  collateralUi: number,
  shortTokensUi: number,
): Promise<Signature[]> {
  const { market, owner } = ctx;
  const signer = createNoopSigner(owner);
  const collat = collateralReserve(market);
  const instant = await getCurrentLedgerInstant(rpc, 'confirmed');
  const obligation = ctx.obligation ?? new VanillaObligation(PROGRAM_ID);
  const borrowAmount = toBaseUnits(shortTokensUi, memeReserve.stats.decimals);
  if (borrowAmount.lten(0)) throw new Error('Short size must be greater than 0.');

  const common = {
    kaminoMarket: market,
    owner: signer,
    obligation,
    useV2Ixs: true,
    scopeRefreshConfig: undefined,
    includeAtaIxs: true,
    requestElevationGroup: false,
    initUserMetadata: NO_LUT_INIT,
    currentLedgerInstant: instant,
  };
  const action =
    collateralUi > 0
      ? await KaminoAction.buildDepositAndBorrowTxns({
          ...common,
          depositAmount: toBaseUnits(collateralUi, collat.stats.decimals),
          depositReserveAddress: collat.address,
          borrowAmount,
          borrowReserveAddress: memeReserve.address,
        })
      : await KaminoAction.buildBorrowTxns({ ...common, amount: borrowAmount, reserveAddress: memeReserve.address });

  // Kamino adds its origination fee to the debt, so the full borrowed amount arrives and is sold.
  const quote = await getQuote(memeReserve.getLiquidityMint(), collat.getLiquidityMint(), BigInt(borrowAmount.toString()));
  const swap = await getSwapInstructions(quote, owner);

  const groups: IxGroup[] = [
    {
      label: 'Fee + borrow',
      ixs: [platformFeeIx(owner), ...KaminoAction.actionToIxs(action)],
      luts: action.luts,
    },
    { label: 'Sell borrowed tokens', ixs: swap.ixs, luts: swap.luts },
  ];
  return sendGroups(rpc, owner, ctx.signAll, groups, ctx.onStatus);
}

/**
 * Close a short: buy back the borrowed meme with USDC on Jupiter, repay the whole debt,
 * and withdraw all collateral when no other shorts remain open.
 */
export async function closeShort(ctx: Ctx, memeReserve: KaminoReserve): Promise<Signature[]> {
  const { market, owner, obligation } = ctx;
  if (!obligation) throw new Error('No open position.');
  const debt = obligation.getBorrowByReserve(memeReserve.address);
  if (!debt) throw new Error(`No open ${memeReserve.symbol} short.`);
  const signer = createNoopSigner(owner);
  const collat = collateralReserve(market);
  const usdcMint = collat.getLiquidityMint();
  const memeMint = memeReserve.getLiquidityMint();

  // Buy a little more than the debt so accrued interest and slippage are covered.
  const needed = debt.amount.mul(1.002).ceil();
  let usdcIn = BigInt(
    debt.marketValueRefreshed.mul(1.03).mul(new Decimal(10).pow(collat.stats.decimals)).ceil().toFixed(0),
  );
  let quote = await getQuote(usdcMint, memeMint, usdcIn);
  for (let i = 0; i < 4 && new Decimal(quote.otherAmountThreshold).lt(needed); i++) {
    const scale = needed.div(quote.otherAmountThreshold).mul(1.01);
    usdcIn = BigInt(new Decimal(usdcIn.toString()).mul(scale).ceil().toFixed(0));
    quote = await getQuote(usdcMint, memeMint, usdcIn);
  }
  if (new Decimal(quote.otherAmountThreshold).lt(needed)) {
    throw new Error('Could not find a swap route that covers the debt. Try again shortly.');
  }

  const balance = await tokenBalance(owner, usdcMint);
  if (balance.raw < usdcIn) {
    const short = Number(usdcIn - balance.raw) / 10 ** collat.stats.decimals;
    throw new Error(`You need ${short.toFixed(2)} more ${collat.symbol} in your wallet to buy back the ${memeReserve.symbol} you owe.`);
  }

  const swap = await getSwapInstructions(quote, owner);
  const instant = await getCurrentLedgerInstant(rpc, 'confirmed');
  const onlyBorrow = obligation.getBorrows().length === 1;
  const hasCollateral = !!obligation.getDepositByReserve(collat.address);
  const common = {
    kaminoMarket: market,
    obligation,
    useV2Ixs: true,
    scopeRefreshConfig: undefined,
    includeAtaIxs: true,
    requestElevationGroup: false,
    initUserMetadata: NO_LUT_INIT,
    currentLedgerInstant: instant,
  };
  const repay =
    onlyBorrow && hasCollateral
      ? await KaminoAction.buildRepayAndWithdrawTxns({
          ...common,
          payer: signer,
          repayAmount: new BN(U64_MAX),
          repayReserveAddress: memeReserve.address,
          withdrawAmount: new BN(U64_MAX),
          withdrawReserveAddress: collat.address,
        })
      : await KaminoAction.buildRepayTxns({
          ...common,
          owner: signer,
          amount: new BN(U64_MAX),
          reserveAddress: memeReserve.address,
        });

  return sendGroups(
    rpc,
    owner,
    ctx.signAll,
    [
      { label: 'Buy back', ixs: swap.ixs, luts: swap.luts },
      { label: onlyBorrow ? 'Repay + withdraw collateral' : 'Repay', ixs: KaminoAction.actionToIxs(repay), luts: repay.luts },
    ],
    ctx.onStatus,
  );
}

/** Lenders supply meme tokens to the reserve to earn the borrow interest shorters pay (the "bull" side). */
export async function supplyMeme(ctx: Ctx, reserve: KaminoReserve, amountUi: number): Promise<Signature[]> {
  const instant = await getCurrentLedgerInstant(rpc, 'confirmed');
  const action = await KaminoAction.buildDepositReserveLiquidityTxns({
    kaminoMarket: ctx.market,
    amount: toBaseUnits(amountUi, reserve.stats.decimals),
    reserveAddress: reserve.address,
    owner: createNoopSigner(ctx.owner),
    obligation: new VanillaObligation(PROGRAM_ID),
    scopeRefreshConfig: undefined,
    includeAtaIxs: true,
    currentLedgerInstant: instant,
  });
  return sendGroups(rpc, ctx.owner, ctx.signAll, [{ label: 'Supply', ixs: KaminoAction.actionToIxs(action), luts: action.luts }], ctx.onStatus);
}

/** Redeem every receipt (cToken) the wallet holds for the reserve back into the meme token. */
export async function withdrawSupply(ctx: Ctx, reserve: KaminoReserve): Promise<Signature[]> {
  const cTokens = await tokenBalance(ctx.owner, reserve.getCTokenMint());
  if (cTokens.raw === 0n) throw new Error(`You have no ${reserve.symbol} supplied.`);
  const instant = await getCurrentLedgerInstant(rpc, 'confirmed');
  const action = await KaminoAction.buildRedeemReserveCollateralTxns({
    kaminoMarket: ctx.market,
    amount: new BN(cTokens.raw.toString()),
    reserveAddress: reserve.address,
    owner: createNoopSigner(ctx.owner),
    obligation: new VanillaObligation(PROGRAM_ID),
    scopeRefreshConfig: undefined,
    includeAtaIxs: true,
    currentLedgerInstant: instant,
  });
  return sendGroups(rpc, ctx.owner, ctx.signAll, [{ label: 'Withdraw', ixs: KaminoAction.actionToIxs(action), luts: action.luts }], ctx.onStatus);
}
