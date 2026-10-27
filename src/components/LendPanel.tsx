import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import type { KaminoReserve } from '@kamino-finance/klend-sdk';
import type { AppData } from '../App';
import { supplyMeme, withdrawSupply } from '../lib/actions';
import { pct, tokens as fmtTokens, usd } from '../lib/format';
import { tokenBalance } from '../lib/kamino';
import { TxResult, errorMessage, type TxState } from './TxResult';

type Balances = { wallet: number; supplied: number };

export function LendPanel({ data, reserves }: { data: AppData; reserves: KaminoReserve[] }) {
  return (
    <div className="card">
      <h2>Lend your memes</h2>
      <p className="muted">
        Bullish? Supply tokens for shorters to borrow and earn the interest they pay. You keep full exposure to the token's price.
      </p>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Supply APY</th>
            <th>Utilization</th>
            <th>Total supplied</th>
            <th>You supplied</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {reserves.map((r) => (
            <LendRow key={r.address} data={data} reserve={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LendRow({ data, reserve }: { data: AppData; reserve: KaminoReserve }) {
  const [amount, setAmount] = useState('');
  const [bal, setBal] = useState<Balances | null>(null);
  const [tx, setTx] = useState<TxState>({ busy: false });
  const { owner, market, instant } = data;

  useEffect(() => {
    if (!owner) return setBal(null);
    let live = true;
    Promise.all([tokenBalance(owner, reserve.getLiquidityMint()), tokenBalance(owner, reserve.getCTokenMint())])
      .then(([w, c]) => {
        if (!live) return;
        const supplied = reserve.cTokensToLiquidity(new Decimal(c.raw.toString()), instant).div(reserve.getMintFactor());
        setBal({ wallet: w.ui, supplied: supplied.toNumber() });
      })
      .catch(() => live && setBal(null));
    return () => {
      live = false;
    };
  }, [owner, reserve, instant, tx.sigs]);

  const totalSupply = reserve.getTotalSupply().div(reserve.getMintFactor()).toNumber();
  const price = reserve.getOracleMarketPrice().toNumber();
  const utilization = totalSupply > 0 ? reserve.getBorrowedAmount().div(reserve.getMintFactor()).toNumber() / totalSupply : 0;

  async function run(kind: 'supply' | 'withdraw') {
    if (!owner || !data.signAll) return;
    setTx({ busy: true });
    const ctx = { market, owner, obligation: null, signAll: data.signAll, onStatus: (status: string) => setTx({ busy: true, status }) };
    try {
      const sigs = kind === 'supply' ? await supplyMeme(ctx, reserve, Number(amount)) : await withdrawSupply(ctx, reserve);
      setTx({ busy: false, sigs });
      setAmount('');
      await data.refresh();
    } catch (e) {
      setTx({ busy: false, error: errorMessage(e) });
    }
  }

  return (
    <tr>
      <td className="sym">{reserve.symbol}</td>
      <td className="good">{pct(reserve.totalSupplyAPY(instant))}</td>
      <td>{pct(utilization)}</td>
      <td>{usd(totalSupply * price)}</td>
      <td>{bal ? fmtTokens(bal.supplied) : '—'}</td>
      <td className="lend-actions">
        <input
          inputMode="decimal"
          placeholder={bal ? `max ${fmtTokens(bal.wallet)}` : 'amount'}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button className="ghost" disabled={!owner || tx.busy || !(Number(amount) > 0)} onClick={() => run('supply')}>
          Supply
        </button>
        <button className="ghost" disabled={!owner || tx.busy || !bal?.supplied} onClick={() => run('withdraw')}>
          Withdraw all
        </button>
        <TxResult state={tx} />
      </td>
    </tr>
  );
}
