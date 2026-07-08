import { describe, it, expect } from 'vitest';
import { diff3, diff3Merge } from '../../src/editor/diff3.js';

const eq = (a: string, b: string) => a === b;
const merge = (o: string[], a: string[], b: string[]) => diff3Merge(o, a, b, eq);

describe('diff3Merge — clean merges', () => {
  it('no changes → base', () => {
    expect(merge(['1', '2', '3'], ['1', '2', '3'], ['1', '2', '3'])).toEqual({
      ok: true,
      merged: ['1', '2', '3'],
    });
  });

  it('only A changed → A', () => {
    expect(merge(['1', '2', '3'], ['1', '9', '3'], ['1', '2', '3'])).toEqual({
      ok: true,
      merged: ['1', '9', '3'],
    });
  });

  it('only B changed → B', () => {
    expect(merge(['1', '2', '3'], ['1', '2', '3'], ['1', '8', '3'])).toEqual({
      ok: true,
      merged: ['1', '8', '3'],
    });
  });

  it('A and B change different regions → both changes kept', () => {
    // A edits pos 1, B edits pos 3 — non-overlapping.
    expect(merge(['a', 'b', 'c', 'd', 'e'], ['a', 'B', 'c', 'd', 'e'], ['a', 'b', 'c', 'D', 'e'])).toEqual({
      ok: true,
      merged: ['a', 'B', 'c', 'D', 'e'],
    });
  });

  it('A and B make the SAME change → no conflict', () => {
    expect(merge(['1', '2', '3'], ['1', '9', '3'], ['1', '9', '3'])).toEqual({
      ok: true,
      merged: ['1', '9', '3'],
    });
  });

  it('A inserts, B untouched → insertion kept', () => {
    expect(merge(['a', 'b'], ['a', 'x', 'b'], ['a', 'b'])).toEqual({
      ok: true,
      merged: ['a', 'x', 'b'],
    });
  });

  it('A deletes, B untouched → deletion kept', () => {
    expect(merge(['a', 'b', 'c'], ['a', 'c'], ['a', 'b', 'c'])).toEqual({
      ok: true,
      merged: ['a', 'c'],
    });
  });

  it('A inserts at end, B inserts at start → both kept', () => {
    expect(merge(['m'], ['m', 'a'], ['b', 'm'])).toEqual({ ok: true, merged: ['b', 'm', 'a'] });
  });

  it('empty base, A and B both append the SAME thing', () => {
    expect(merge([], ['x'], ['x'])).toEqual({ ok: true, merged: ['x'] });
  });
});

describe('diff3Merge — conflicts', () => {
  it('A and B change the SAME region differently → conflict', () => {
    const r = merge(['1', '2', '3'], ['1', '9', '3'], ['1', '8', '3']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const conflict = r.chunks.find((c) => !c.ok);
      expect(conflict).toEqual({ ok: false, base: ['2'], a: ['9'], b: ['8'] });
    }
  });

  it('edit/delete on the same region → conflict', () => {
    // A edits 'b'→'B', B deletes 'b'.
    const r = merge(['a', 'b', 'c'], ['a', 'B', 'c'], ['a', 'c']);
    expect(r.ok).toBe(false);
  });

  it('conflict chunks still carry the unconflicted content around them', () => {
    const chunks = diff3(['a', 'b', 'c'], ['a', 'X', 'c'], ['a', 'Y', 'c'], eq);
    // leading 'a' + conflict(X/Y over b) + trailing 'c'
    expect(chunks.filter((c) => c.ok).flatMap((c) => (c.ok ? c.content : []))).toEqual(['a', 'c']);
    expect(chunks.some((c) => !c.ok)).toBe(true);
  });
});
