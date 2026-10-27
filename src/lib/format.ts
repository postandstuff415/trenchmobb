export function usd(n: number): string {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function price(n: number): string {
  if (!isFinite(n) || n === 0) return '—';
  if (n >= 1) return `$${n.toFixed(4)}`;
  const digits = Math.min(12, Math.max(4, -Math.floor(Math.log10(n)) + 3));
  return `$${n.toFixed(digits)}`;
}

export function tokens(n: number): string {
  if (!isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : 4 });
}

export function pct(n: number): string {
  return isFinite(n) ? `${(n * 100).toFixed(2)}%` : '—';
}

export const explorerTx = (sig: string) => `https://solscan.io/tx/${sig}`;
