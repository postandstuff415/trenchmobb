import { explorerTx } from '../lib/format';

export type TxState = { busy: boolean; status?: string; error?: string; sigs?: string[] };

export function TxResult({ state }: { state: TxState }) {
  if (state.busy) return <p className="tx tx-busy">{state.status ?? 'Working…'}</p>;
  if (state.error) return <p className="tx tx-error">{state.error}</p>;
  if (state.sigs?.length)
    return (
      <p className="tx tx-ok">
        Done.{' '}
        {state.sigs.map((s, i) => (
          <a key={s} href={explorerTx(s)} target="_blank" rel="noreferrer">
            View tx{state.sigs!.length > 1 ? ` ${i + 1}` : ''} ↗
          </a>
        ))}
      </p>
    );
  return null;
}

export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/User rejected|rejected the request/i.test(msg)) return 'Cancelled in wallet.';
  return msg;
}
