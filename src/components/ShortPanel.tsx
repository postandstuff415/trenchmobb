import { useMemo, useState } from 'react';
import type { KaminoReserve } from '@kamino-finance/klend-sdk';
import type { AppData } from '../App';
import { feeSol } from '../config';
import { openShort } from '../lib/actions';
import { addEntry } from '../lib/entries';
import { usd, price as fmtPrice, tokens as fmtTokens, pct } from '../lib/format';
import { collateralReserve } from '../lib/kamino';
import { TxResult, errorMessage, type TxState } from './TxResult';

export function ShortPanel({ data, reserves }: { data: AppData; reserves: KaminoReserve[] }) {
  const [selected, setSelected] = useState<string | null>(reserves[0]?.address ?? null);
  const reserve = reserves.find((r) => r.address === selected) ?? null;

  if (!reserves.length) return <p className="banner">This market has no shortable reserves yet.</p>;

  return (
    <div className="grid">
      <div className="card markets">
        <h2>Markets</h2>
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Price</th>
              <th>Borrow APY</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            {reserves.map((r) => {
              const p = r.getOracleMarketPrice().toNumber();
              const avail = r.getLiquidityAvailableAmount().div(r.getMintFactor()).toNumber();
              return (
                <tr key={r.address} className={r.address === selected ? 'sel' : ''} onClick={() => setSelected(r.address)}>
                  <td className="sym">{r.symbol}</td>
                  <td>{fmtPrice(p)}</td>
                  <td>{pct(r.totalBorrowAPY(data.instant))}</td>
                  <td>{usd(avail * p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {reserve && <ShortForm key={reserve.address} data={data} reserve={reserve} />}
    </div>
  );
}

function ShortForm({ data, reserve }: { data: AppData; reserve: KaminoReserve }) {
  const [collateral, setCollateral] = useState('');
  const [size, setSize] = useState('');
  const [tx, setTx] = useState<TxState>({ busy: false });

  const collat = collateralReserve(data.market);
  const preview = useMemo(() => {
    const p = reserve.getOracleMarketPrice().toNumber();
    const usdcPrice = collat.getOracleMarketPrice().toNumber();
    const bf = reserve.stats.borrowFactor / 100;
    const origination = reserve.getBorrowFee().toNumber();
    const s = data.obligation?.refreshedStats;
    const newCollatUsd = (Number(collateral) || 0) * usdcPrice;
    const sizeUsd = Number(size) || 0;
    const borrowLimit = (s?.borrowLimit.toNumber() ?? 0) + newCollatUsd * collat.stats.loanToValue;
    const liqLimit = (s?.borrowLiquidationLimit.toNumber() ?? 0) + newCollatUsd * collat.stats.liquidationThreshold;
    const existing = s?.userTotalBorrowBorrowFactorAdjusted.toNumber() ?? 0;
    const added = sizeUsd * (1 + origination) * bf;
    const maxSizeUsd = Math.max(0, ((borrowLimit - existing) / ((1 + origination) * bf)) * 0.98);
    const availUsd = reserve.getLiquidityAvailableAmount().div(reserve.getMintFactor()).toNumber() * p;
    return {
      price: p,
      tokens: p > 0 ? sizeUsd / p : 0,
      sizeUsd,
      maxSizeUsd: Math.min(maxSizeUsd, availUsd),
      health: liqLimit > 0 ? (existing + added) / liqLimit : 0,
      liqPrice: added > 0 ? (p * (liqLimit - existing)) / added : 0,
      origination,
    };
  }, [collateral, size, reserve, collat, data.obligation]);

  const tooBig = preview.sizeUsd > preview.maxSizeUsd + 1e-9;
  const canSubmit = !!data.owner && !!data.signAll && preview.sizeUsd > 0 && !tooBig && !tx.busy;

  async function submit() {
    if (!data.owner || !data.signAll) return;
    setTx({ busy: true });
    try {
      const sigs = await openShort(
        {
          market: data.market,
          owner: data.owner,
          obligation: data.obligation,
          signAll: data.signAll,
          onStatus: (status) => setTx({ busy: true, status }),
        },
        reserve,
        Number(collateral) || 0,
        preview.tokens,
      );
      addEntry(data.owner, reserve.address, preview.tokens, preview.sizeUsd);
      setTx({ busy: false, sigs });
      setCollateral('');
      setSize('');
      await data.refresh();
    } catch (e) {
      setTx({ busy: false, error: errorMessage(e) });
    }
  }

  return (
    <div className="card form">
      <h2>
        Short <span className="accent">{reserve.symbol}</span>
      </h2>
      <p className="muted">Price {fmtPrice(preview.price)} · Borrow APY {pct(reserve.totalBorrowAPY(data.instant))}</p>

      <label>
        Add collateral ({collat.symbol})
        <input inputMode="decimal" placeholder="0.00" value={collateral} onChange={(e) => setCollateral(e.target.value)} />
      </label>
      <label>
        Short size (USD)
        <div className="row">
          <input inputMode="decimal" placeholder="0.00" value={size} onChange={(e) => setSize(e.target.value)} />
          <button type="button" className="ghost" onClick={() => setSize(preview.maxSizeUsd.toFixed(2))}>
            Max {usd(preview.maxSizeUsd)}
          </button>
        </div>
      </label>

      <dl className="summary">
        <dt>You borrow & sell</dt>
        <dd>
          {fmtTokens(preview.tokens)} {reserve.symbol}
        </dd>
        <dt>Est. liquidation price</dt>
        <dd>{preview.liqPrice > 0 ? fmtPrice(preview.liqPrice) : '—'}</dd>
        <dt>Position health</dt>
        <dd className={preview.health > 0.85 ? 'bad' : preview.health > 0.6 ? 'warn' : ''}>{pct(preview.health)} of liquidation</dd>
        <dt>Kamino borrow fee</dt>
        <dd>{pct(preview.origination)}</dd>
        <dt>Platform fee</dt>
        <dd>{feeSol} SOL</dd>
      </dl>

      {tooBig && <p className="tx tx-error">Size exceeds what your collateral allows. Add collateral or reduce size.</p>}
      <button className="cta" disabled={!canSubmit} onClick={submit}>
        {!data.owner ? 'Connect wallet' : `Short ${reserve.symbol} · ${feeSol} SOL fee`}
      </button>
      <p className="muted small">
        Sale proceeds land in your wallet as {collat.symbol}; keep them to buy back when you close. Your first short also opens a
        Kamino account, which needs a small refundable rent deposit in SOL.
      </p>
      <TxResult state={tx} />
    </div>
  );
}
