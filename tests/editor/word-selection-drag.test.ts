// @vitest-environment jsdom
/**
 * Single-click drag dynamic granularity — the head-trim escape hatch
 * (field request 2026-07-15): a word-snapped sweep un-snaps to
 * character precision when the pointer reverses into the furthest word
 * of the CURRENT advancing run, so a long excerpt can terminate
 * mid-word in one gesture. Retreating past that word resumes word
 * snapping, and turning forward again starts a fresh run — precision
 * follows where you stop now, not where the drag once reached.
 *
 * Drives `extendActiveEndTo` directly with synthetic doc positions
 * (the drag listeners only translate mouse coords into exactly these
 * calls), asserting on the live view selection after each move.
 */
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  wordSelectionPlugin,
  createPointAnchor,
  extendActiveEndTo,
} from '../../src/editor/word-selection-plugin.js';

// One card body: "alpha bravo charlie delta echo"
//                 ^1    ^7    ^13     ^21   ^27   (positions of word starts)
const TEXT = 'alpha bravo charlie delta echo';

function makeView(): EditorView {
  const doc = schema.nodes['doc']!.create(null, [
    schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('T')),
      schema.nodes['card_body']!.create(null, schema.text(TEXT)),
    ]),
  ]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new EditorView(container, {
    state: EditorState.create({ doc, plugins: [wordSelectionPlugin] }),
  });
}

/** Doc position of `offset` within the body text. */
function bodyPos(view: EditorView, offset: number): number {
  let base = -1;
  view.state.doc.descendants((n, pos) => {
    if (base < 0 && n.type.name === 'card_body') base = pos + 1;
    return base < 0;
  });
  return base + offset;
}

const sel = (view: EditorView): [number, number] => [
  view.state.selection.from,
  view.state.selection.to,
];

// Word offsets within TEXT: alpha 0-5, bravo 6-11, charlie 12-19,
// delta 20-25, echo 26-30 (bareUnit excludes the space).
const ALPHA = { from: 0, to: 5 };
const CHARLIE = { from: 12, to: 19 };
const DELTA = { from: 20, to: 25 };

describe('head-trim during single-click word-snapped drags', () => {
  it('advancing snaps; reversing inside the furthest word is character-precise', () => {
    const view = makeView();
    const p = (o: number): number => bodyPos(view, o);
    const anchor = createPointAnchor(view, p(2)); // mid-"alpha"
    extendActiveEndTo(view, anchor, p(15)); // mid-"charlie" → snap
    expect(sel(view)).toEqual([p(ALPHA.from), p(CHARLIE.to)]);
    extendActiveEndTo(view, anchor, p(14)); // one char BACK, still in charlie
    expect(sel(view)).toEqual([p(ALPHA.from), p(14)]); // precise
    extendActiveEndTo(view, anchor, p(15)); // micro forward, still below max
    expect(sel(view)).toEqual([p(ALPHA.from), p(15)]); // still precise
    view.destroy();
  });

  it('crossing the furthest point again resumes snapping', () => {
    const view = makeView();
    const p = (o: number): number => bodyPos(view, o);
    const anchor = createPointAnchor(view, p(2));
    extendActiveEndTo(view, anchor, p(15)); // snap in charlie
    extendActiveEndTo(view, anchor, p(13)); // precise
    extendActiveEndTo(view, anchor, p(22)); // past the max, into delta → snap
    expect(sel(view)).toEqual([p(ALPHA.from), p(DELTA.to)]);
    view.destroy();
  });

  it('retreating past the furthest word snaps word-by-word', () => {
    const view = makeView();
    const p = (o: number): number => bodyPos(view, o);
    const anchor = createPointAnchor(view, p(2));
    extendActiveEndTo(view, anchor, p(22)); // sweep to delta
    extendActiveEndTo(view, anchor, p(15)); // retreat PAST delta into charlie
    expect(sel(view)).toEqual([p(ALPHA.from), p(CHARLIE.to)]); // snapped, not precise
    view.destroy();
  });

  it("the user's scenario: forward, back, forward again but not as far — precision follows the NEW stop", () => {
    const view = makeView();
    const p = (o: number): number => bodyPos(view, o);
    const anchor = createPointAnchor(view, p(2));
    extendActiveEndTo(view, anchor, p(27)); // sweep out to echo
    extendActiveEndTo(view, anchor, p(8)); // long retreat into bravo (snapped)
    extendActiveEndTo(view, anchor, p(15)); // forward again, stop mid-charlie
    expect(sel(view)).toEqual([p(ALPHA.from), p(CHARLIE.to)]); // snapped on arrival
    extendActiveEndTo(view, anchor, p(14)); // nudge back inside charlie
    expect(sel(view)).toEqual([p(ALPHA.from), p(14)]); // precise HERE, old echo max forgotten
    view.destroy();
  });

  it('mirrors for leftward drags', () => {
    const view = makeView();
    const p = (o: number): number => bodyPos(view, o);
    const anchor = createPointAnchor(view, p(28)); // mid-"echo"
    extendActiveEndTo(view, anchor, p(14)); // sweep left into charlie → snap
    expect(sel(view)).toEqual([p(CHARLIE.from), p(30)]); // echo fully in, head at charlie.from
    extendActiveEndTo(view, anchor, p(16)); // reverse (rightward) inside charlie
    expect(sel(view)).toEqual([p(16), p(30)]); // precise head
    view.destroy();
  });

  it('re-entering W0 still resets to exact point selection (existing rule intact)', () => {
    const view = makeView();
    const p = (o: number): number => bodyPos(view, o);
    const anchor = createPointAnchor(view, p(2));
    extendActiveEndTo(view, anchor, p(15));
    extendActiveEndTo(view, anchor, p(4)); // back inside alpha (W0)
    expect(sel(view)).toEqual([p(2), p(4)]); // exact point→pos
    view.destroy();
  });
});
