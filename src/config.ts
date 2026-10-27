import { address, type Address } from '@solana/kit';

function req(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

const env = import.meta.env;

export const config = {
  rpcUrl: req('VITE_RPC_URL', env.VITE_RPC_URL),
  market: address(req('VITE_KLEND_MARKET', env.VITE_KLEND_MARKET)),
  collateralMint: address(env.VITE_COLLATERAL_MINT || 'EPjFWWd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  shortableMints: (env.VITE_SHORTABLE_MINTS || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean)
    .map((s: string) => address(s)) as Address[],
  feeWallet: address(req('VITE_FEE_WALLET', env.VITE_FEE_WALLET)),
  feeLamports: BigInt(Math.round(Number(env.VITE_FEE_SOL || '0.01') * 1e9)),
  jupApi: (env.VITE_JUP_API || 'https://lite-api.jup.ag/swap/v1').replace(/\/$/, ''),
  jupApiKey: env.VITE_JUP_API_KEY || '',
  slippageBps: Number(env.VITE_SLIPPAGE_BPS || '100'),
  priorityMicroLamports: BigInt(env.VITE_PRIORITY_MICROLAMPORTS || '50000'),
};

export const feeSol = Number(config.feeLamports) / 1e9;
