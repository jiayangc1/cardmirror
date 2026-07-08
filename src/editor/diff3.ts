/**
 * A small, generic three-way merge (diff3) over sequences.
 *
 * Given a common ancestor `base` and two derived versions `a` and `b`, it
 * produces the merged sequence when the two sides' changes don't overlap, or
 * reports the overlapping regions as conflicts. This is the classic diff3: the
 * elements common to all three (the LCS anchors) pin an alignment, and each
 * region between anchors is classified — only-a-changed, only-b-changed, both
 * changed the same way, or a true conflict.
 *
 * It works from three SNAPSHOTS (not operation histories), which is exactly
 * what the intra-doc transclusion sync has at a debounce tick: the content at
 * last sync (base) plus the current source and mirror. Callers pass an
 * equality fn, so elements can be compared by content hash / stable id.
 *
 * Cost is O(|base|·|a|) + O(|base|·|b|) (LCS DP) — fine for a document
 * section's worth of blocks; not meant for megabyte-scale inputs.
 */

/** One piece of a 3-way merge. `ok` pieces are resolved content; a conflict
 *  carries all three sides so the caller can prompt / fall back. */
export type Diff3Chunk<T> =
  | { ok: true; content: T[] }
  | { ok: false; base: T[]; a: T[]; b: T[] };

export type Diff3Result<T> =
  | { ok: true; merged: T[] }
  | { ok: false; chunks: Diff3Chunk<T>[] };

/** LCS of `x` and `y` as aligned `[xIndex, yIndex]` pairs, in order. */
function lcsPairs<T>(
  x: readonly T[],
  y: readonly T[],
  eq: (p: T, q: T) => boolean,
): [number, number][] {
  const m = x.length;
  const n = y.length;
  // dp[i][j] = LCS length of x[i:] and y[j:].
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = eq(x[i]!, y[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (eq(x[i]!, y[j]!)) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** Produce the merge chunks for `base` → (`a`, `b`). */
export function diff3<T>(
  base: readonly T[],
  a: readonly T[],
  b: readonly T[],
  eq: (p: T, q: T) => boolean,
): Diff3Chunk<T>[] {
  const aOf = new Map(lcsPairs(base, a, eq).map(([o, x]) => [o, x] as const));
  const bOf = new Map(lcsPairs(base, b, eq).map(([o, x]) => [o, x] as const));
  // Anchors: base indices matched in BOTH a and b — the shared alignment points.
  const anchors: number[] = [];
  for (let o = 0; o < base.length; o++) if (aOf.has(o) && bOf.has(o)) anchors.push(o);

  const chunks: Diff3Chunk<T>[] = [];
  const eqArr = (p: T[], q: T[]): boolean => p.length === q.length && p.every((v, k) => eq(v, q[k]!));
  const pushOk = (content: T[]): void => {
    if (content.length === 0) return;
    const last = chunks[chunks.length - 1];
    if (last && last.ok) last.content.push(...content);
    else chunks.push({ ok: true, content: [...content] });
  };
  const emitRegion = (baseSeg: T[], aSeg: T[], bSeg: T[]): void => {
    if (eqArr(aSeg, baseSeg) && eqArr(bSeg, baseSeg)) pushOk(baseSeg);
    else if (eqArr(aSeg, baseSeg)) pushOk(bSeg); // only b changed
    else if (eqArr(bSeg, baseSeg)) pushOk(aSeg); // only a changed
    else if (eqArr(aSeg, bSeg)) pushOk(aSeg); // both made the same change
    else chunks.push({ ok: false, base: baseSeg, a: aSeg, b: bSeg }); // true conflict
  };

  let ob = 0;
  let oa = 0;
  let obb = 0;
  for (const anchor of anchors) {
    const ai = aOf.get(anchor)!;
    const bi = bOf.get(anchor)!;
    emitRegion(base.slice(ob, anchor), a.slice(oa, ai), b.slice(obb, bi));
    pushOk([base[anchor]!]); // the shared anchor element
    ob = anchor + 1;
    oa = ai + 1;
    obb = bi + 1;
  }
  emitRegion(base.slice(ob), a.slice(oa), b.slice(obb));
  return chunks;
}

/** diff3, collapsed to a single result: the merged sequence, or the raw chunks
 *  when any region is a true conflict (caller resolves — e.g. prompt). */
export function diff3Merge<T>(
  base: readonly T[],
  a: readonly T[],
  b: readonly T[],
  eq: (p: T, q: T) => boolean,
): Diff3Result<T> {
  const chunks = diff3(base, a, b, eq);
  if (chunks.some((c) => !c.ok)) return { ok: false, chunks };
  const merged: T[] = [];
  for (const c of chunks) if (c.ok) merged.push(...c.content);
  return { ok: true, merged };
}
