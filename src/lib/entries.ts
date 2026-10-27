// Remembers what each short sold for, so the positions view can show PnL. Per-browser only.
const KEY = 'trenchmobb.entries.v1';
type Entry = { tokens: number; proceedsUsd: number };

function read(): Record<string, Entry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
function write(v: Record<string, Entry>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export function getEntry(owner: string, reserve: string): Entry | undefined {
  return read()[`${owner}:${reserve}`];
}
export function addEntry(owner: string, reserve: string, tokens: number, proceedsUsd: number) {
  const all = read();
  const k = `${owner}:${reserve}`;
  const prev = all[k] ?? { tokens: 0, proceedsUsd: 0 };
  all[k] = { tokens: prev.tokens + tokens, proceedsUsd: prev.proceedsUsd + proceedsUsd };
  write(all);
}
export function clearEntry(owner: string, reserve: string) {
  const all = read();
  delete all[`${owner}:${reserve}`];
  write(all);
}
