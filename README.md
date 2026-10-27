# TrenchMobb

Short Solana meme coins, dumpy.fun style. Each short charges a flat SOL platform fee inside the same transaction that opens it.

## How a short works

1. The shorter posts **USDC collateral** to a Kamino lending market.
2. They **borrow the meme token** against it.
3. The borrowed tokens are **sold for USDC on Jupiter**. The USDC lands in their wallet.
4. To close, the app **buys the tokens back** with USDC, **repays** the loan and returns the collateral.
   If the price fell, they keep the difference.

The other side is **lenders**: holders who supply meme tokens on the *Lend* tab and earn the interest shorters pay.

## The fee

`src/lib/fee.ts` adds a System Program transfer of `VITE_FEE_SOL` to `VITE_FEE_WALLET`. It is the first instruction of the
transaction that deposits collateral and borrows. Solana transactions are atomic, so if the borrow fails the fee is not
taken. When everything fits in one transaction (the usual case), the Jupiter sale is in that transaction too. Otherwise the
app sends two transactions that the wallet signs together: fee + borrow, then the sale. Closing a short is free.

The fee is enforced by this frontend. Someone calling Kamino directly does not pay it.

## Setup

```bash
npm install
cp .env.example .env   # fill in RPC, market, fee wallet
npm run dev            # http://localhost:5173
npm run build          # static site in dist/, deploy anywhere (Vercel, Netlify, Cloudflare Pages)
```

You need:

- **An RPC with `getProgramAccounts`** (Helius, Triton, QuickNode). The public endpoint will not load markets.
- **A Kamino market with meme-coin reserves.** The main market mostly holds majors, so you will likely create your own
  isolated market (Kamino supports permissionless markets) with a USDC reserve as collateral (LTV > 0) and one reserve per
  meme coin (LTV 0, borrowing enabled, with a live Pyth/Switchboard oracle). Put its address in `VITE_KLEND_MARKET`.
  Every borrowable reserve except USDC is listed as shortable, or restrict them with `VITE_SHORTABLE_MINTS`.
- **Lenders.** Shorts can only be as large as the meme liquidity supplied to each reserve.

## Code map

| File | What it does |
| --- | --- |
| `src/lib/actions.ts` | open short, close short, supply, withdraw |
| `src/lib/fee.ts` | the platform-fee instruction |
| `src/lib/tx.ts` | packs instructions into one atomic v0 tx (or splits), signs once, sends, confirms |
| `src/lib/jupiter.ts` | Jupiter quote + swap instructions |
| `src/lib/kamino.ts` | market/reserve/obligation loading |
| `src/components/*` | Short, Positions, Lend tabs |

## Hero artwork

Save the artwork as `public/hero.jpg` and it appears behind the hero headline. Without it, a neon gradient shows instead.

## Before mainnet

- Test end to end with small amounts first. The transaction flows compile against the Kamino SDK types but were not run
  against a live market during development.
- Shorting/margin products are regulated in many places (e.g. the US). Get legal advice and geo-block where needed.
- Shorts can be liquidated if the price pumps. Make sure users understand that.
