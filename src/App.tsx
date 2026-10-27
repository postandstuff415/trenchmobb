import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { address, type Address } from '@solana/kit';
import { getCurrentLedgerInstant, type KaminoMarket, type KaminoObligation, type LedgerInstant } from '@kamino-finance/klend-sdk';
import { feeSol } from './config';
import { loadMarket, loadObligation, rpc, shortableReserves } from './lib/kamino';
import type { SignAll } from './lib/tx';
import { ShortPanel } from './components/ShortPanel';
import { Positions } from './components/Positions';
import { LendPanel } from './components/LendPanel';
import { errorMessage } from './components/TxResult';

export type AppData = {
  market: KaminoMarket;
  instant: LedgerInstant;
  obligation: KaminoObligation | null;
  owner: Address | null;
  signAll: SignAll | null;
  refresh: () => Promise<void>;
};

type Tab = 'short' | 'positions' | 'lend';

export default function App() {
  const { publicKey, signAllTransactions } = useWallet();
  const owner = useMemo(() => (publicKey ? address(publicKey.toBase58()) : null), [publicKey]);
  const [tab, setTab] = useState<Tab>('short');
  const [market, setMarket] = useState<KaminoMarket | null>(null);
  const [instant, setInstant] = useState<LedgerInstant | null>(null);
  const [obligation, setObligation] = useState<KaminoObligation | null>(null);
  const [loadError, setLoadError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const m = market ?? (await loadMarket());
      if (market) await m.reload();
      const [i, o] = await Promise.all([
        getCurrentLedgerInstant(rpc, 'confirmed'),
        owner ? loadObligation(m, owner) : Promise.resolve(null),
      ]);
      setMarket(m);
      setInstant(i);
      setObligation(o);
      setLoadError(undefined);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [market, owner]);

  useEffect(() => {
    void refresh();
    // Reload when the wallet changes; refresh itself is stable enough per wallet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const signAll = useMemo<SignAll | null>(
    () => (signAllTransactions ? (txs) => signAllTransactions(txs) : null),
    [signAllTransactions],
  );

  const data: AppData | null = market && instant ? { market, instant, obligation, owner, signAll, refresh } : null;
  const openCount = obligation?.getBorrows().length ?? 0;

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo">⚔️</span>
          <span>Trench<span className="b2">Mobb</span></span>
        </div>
        <nav className="tabs">
          <button className={tab === 'short' ? 'on' : ''} onClick={() => setTab('short')}>Short</button>
          <button className={tab === 'positions' ? 'on' : ''} onClick={() => setTab('positions')}>
            Positions{openCount ? ` (${openCount})` : ''}
          </button>
          <button className={tab === 'lend' ? 'on' : ''} onClick={() => setTab('lend')}>Lend</button>
        </nav>
        <WalletMultiButton />
      </header>

      <section className="hero">
        <h1>Short the <em>trenches</em>.</h1>
        <p>
          Post USDC, borrow the meme, sell it. Buy it back cheaper and keep the difference.
          Flat <b>{feeSol} SOL</b> fee per short, charged in the same transaction as the short, so you only pay if it opens.
        </p>
      </section>

      {loadError && <p className="banner error">Could not load markets: {loadError}</p>}
      {!data && !loadError && <p className="banner">Loading markets…</p>}

      {data && tab === 'short' && <ShortPanel data={data} reserves={shortableReserves(data.market)} />}
      {data && tab === 'positions' && <Positions data={data} />}
      {data && tab === 'lend' && <LendPanel data={data} reserves={shortableReserves(data.market)} />}

      <footer className="foot">
        Shorts are borrows on a Kamino lending market, sold via Jupiter. If the token's price rises enough, your collateral is
        liquidated. Not available where prohibited. Nothing here is financial advice.
      </footer>
    </div>
  );
}
