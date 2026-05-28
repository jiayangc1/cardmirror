/**
 * Host-bound Learn store singleton.
 *
 * Wraps `LearnStore` with debounced persistence to the host KV
 * (`writeLearnStore`) and a one-time load from it (`readLearnStore`).
 * Other modules import `learnStore` directly; `loadLearnStore()` is
 * awaited once at boot.
 */

import { LearnStore } from './learn-store.js';
import { getHost } from './host/index.js';

const PERSIST_DELAY_MS = 400;
let writeTimer: number | null = null;
let pending: string | null = null;

function debouncedPersist(json: string): void {
  pending = json;
  if (writeTimer !== null) return;
  writeTimer = window.setTimeout(() => {
    writeTimer = null;
    const j = pending;
    pending = null;
    if (j !== null) void getHost().writeLearnStore(j);
  }, PERSIST_DELAY_MS);
}

export const learnStore = new LearnStore(debouncedPersist);

let loaded = false;
/** Load the persisted store once. Safe to call repeatedly. */
export async function loadLearnStore(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    learnStore.loadJson(await getHost().readLearnStore());
  } catch (err) {
    console.warn('Failed to load learn store:', err);
  }
}

/** Today as a local-day `YYYY-MM-DD` string (the scheduler's day bucket). */
export function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
