import { useState } from 'react';
import type { AppData } from '../App';
import { closeShort } from '../lib/actions';
import { clearEntry, getEntry } from '../lib/entries';
import { usd, price as fmtPrice, tokens as fmtTokens, pct } from '../lib/format';
import { TxResult, errorMessage, type TxState } from './TxResult';

export function Positions({ data }: { data: AppData }) {
  const [tx, setTx] = useState<Record<string, TxState>>({});
  const { obligation, market, owner } = data;

  if (!owner) return <p className="banner">Connect a wallet to see your shorts.</p>;
  const borrows = obligation?.getBorrows() ?? [];
  if (!obligation || !borrows.length) return <p className="banner">No open shorts.</p>;

  const s = obligation.refreshedStats;

  async function close(reserveAddress: string) {
    const reserve = market.getReserveByAddress(reserveAddress as never);
    if (!reserve || !owner || !data.signAll) return;
    const set = (v: TxState) => setTx((t) => ({ ...t, [reserveAddress]: v }));
    set({ busy: true });
    try {
      const sigs = await closeShort(
        { market, owner, obligation, signAll: data.signAll, onStatus: (status) => set({ busy: true, status }) },
        reserve,
      );
      clearEntry(owner, reserveAddress);
      set({ busy: false, sigs });
      await data.refresh();
    } catch (e) {
      set({ busy: false, error: errorMessage(e) });
    }
  }

  return (
    <div className="card">
      <h2>Your shorts</h2>
      <div className="stats">
        <div>
          <span>Collateral</span>
          <b>{usd(s.userTotalDeposit.toNumber())}</b>
        </div>
        <div>
          <span>Owed</span>
          <b>{usd(s.userTotalBorrow.toNumber())}</b>
        </div>
        <div>
          <span>LTV / liquidation</span>
          <b className={s.loanToValue.div(s.liquidationLtv).gt(0.85) ? 'bad' : ''}>
            {pct(s.loanToValue.toNumber())} / {pct(s.liquidationLtv.toNumber())}
          </b>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Owed</th>
            <th>Price</th>
            <th>Value</th>
            <th>PnL</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {borrows.map((b) => {
            const reserve = market.getReserveByAddress(b.reserveAddress);
            const amount = b.amount.div(b.mintFactor).toNumber();
            const value = b.marketValueRefreshed.toNumber();
            const entry = getEntry(owner, b.reserveAddress);
            const pnl = entry ? entry.proceedsUsd - value : null;
            const state = tx[b.reserveAddress] ?? { busy: false };
            return (
              <tr key={b.reserveAddress}>
                <td className="sym">{reserve?.symbol ?? b.mintAddress.slice(0, 4)}</td>
                <td>{fmtTokens(amount)}</td>
                <td>{fmtPrice(reserve?.getOracleMarketPrice().toNumber() ?? 0)}</td>
                <td>{usd(value)}</td>
                <td className={pnl == null ? 'muted' : pnl >= 0 ? 'good' : 'bad'}>{pnl == null ? '—' : usd(pnl)}</td>
                <td>
                  <button className="ghost" disabled={state.busy || !data.signAll} onClick={() => close(b.reserveAddress)}>
                    Close
                  </button>
                  <TxResult state={state} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        Closing buys the owed tokens back with {`USDC`} from your wallet, repays the loan and, if it was your last short, returns
        your collateral. No platform fee on close.
      </p>
    </div>
  );
}
