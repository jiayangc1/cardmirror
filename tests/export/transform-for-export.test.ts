/**
 * Tests for the Save-As pre-export transforms: include-* gates and
 * the read-mode visibility filter.
 */

import { describe, expect, it } from 'vitest';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { transformForExport } from '../../src/export/transform-for-export.js';

// ---- Doc builders ----------------------------------------------

function txt(s: string, ...markNames: string[]) {
  const marks = markNames.map((m) => {
    const t = schema.marks[m];
    if (!t) throw new Error(`unknown mark ${m}`);
    return m === 'highlight' ? t.create({ color: 'yellow' }) : t.create();
  });
  return schema.text(s, marks);
}
function paragraph(...inlines: ReturnType<typeof txt>[]) {
  return schema.nodes['paragraph']!.create(null, inlines);
}
function pocket(t: string) {
  return schema.nodes['pocket']!.create({ id: newHeadingId() }, schema.text(t));
}
function hat(t: string) {
  return schema.nodes['hat']!.create({ id: newHeadingId() }, schema.text(t));
}
function tag(t: string) {
  return schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(t));
}
function analytic(t: string) {
  return schema.nodes['analytic']!.create({ id: newHeadingId() }, schema.text(t));
}
function cardBody(...inlines: ReturnType<typeof txt>[]) {
  return schema.nodes['card_body']!.create(null, inlines);
}
function citeParagraph(...inlines: ReturnType<typeof txt>[]) {
  return schema.nodes['cite_paragraph']!.create(null, inlines);
}
function undertag(t: string) {
  return schema.nodes['undertag']!.create(null, schema.text(t));
}
function card(...children: any[]) {
  return schema.nodes['card']!.createChecked(null, children);
}
function analyticUnit(...children: any[]) {
  return schema.nodes['analytic_unit']!.createChecked(null, children);
}
function makeDoc(...children: any[]) {
  return schema.nodes['doc']!.createChecked(null, children);
}

const ALL_ON = {
  includeComments: true,
  includeAnalytics: true,
  includeUndertags: true,
  readMode: false,
};

// ---- Tests ------------------------------------------------------

describe('transformForExport — no-op when all include-* flags are set', () => {
  it('returns an equivalent doc when nothing is filtered', () => {
    const doc = makeDoc(
      pocket('P'),
      card(tag('T'), cardBody(txt('body'))),
      analyticUnit(analytic('A'), cardBody(txt('body'))),
      undertag('UT'),
    );
    const out = transformForExport(doc, ALL_ON);
    expect(out.eq(doc)).toBe(true);
  });
});

describe('transformForExport — strip analytics', () => {
  it('drops doc-level analytic_units entirely', () => {
    const doc = makeDoc(
      card(tag('T'), cardBody(txt('body'))),
      analyticUnit(analytic('A'), cardBody(txt('au body'))),
    );
    const out = transformForExport(doc, { ...ALL_ON, includeAnalytics: false });
    expect(out.childCount).toBe(1);
    expect(out.firstChild!.type.name).toBe('card');
  });

  it('drops in-card analytic paragraphs but keeps the card', () => {
    const doc = makeDoc(
      card(tag('T'), analytic('A in card'), cardBody(txt('body'))),
    );
    const out = transformForExport(doc, { ...ALL_ON, includeAnalytics: false });
    const c = out.firstChild!;
    expect(c.type.name).toBe('card');
    expect(c.childCount).toBe(2);
    expect(c.child(0).type.name).toBe('tag');
    expect(c.child(1).type.name).toBe('card_body');
  });
});

describe('transformForExport — strip undertags', () => {
  it('drops doc-level undertags', () => {
    const doc = makeDoc(
      paragraph(txt('hi')),
      undertag('UT'),
      paragraph(txt('there')),
    );
    const out = transformForExport(doc, { ...ALL_ON, includeUndertags: false });
    expect(out.childCount).toBe(2);
    expect(out.child(0).textContent).toBe('hi');
    expect(out.child(1).textContent).toBe('there');
  });

  it('drops undertags inside cards', () => {
    const doc = makeDoc(card(tag('T'), undertag('UT'), cardBody(txt('body'))));
    const out = transformForExport(doc, { ...ALL_ON, includeUndertags: false });
    const c = out.firstChild!;
    expect(c.childCount).toBe(2);
    expect(c.child(0).type.name).toBe('tag');
    expect(c.child(1).type.name).toBe('card_body');
  });

  it('drops undertags inside analytic_units', () => {
    const doc = makeDoc(analyticUnit(analytic('A'), undertag('UT'), cardBody(txt('body'))));
    const out = transformForExport(doc, { ...ALL_ON, includeUndertags: false });
    const au = out.firstChild!;
    expect(au.childCount).toBe(2);
    expect(au.child(0).type.name).toBe('analytic');
    expect(au.child(1).type.name).toBe('card_body');
  });
});

describe('transformForExport — read mode', () => {
  const RM = { includeComments: false, includeAnalytics: false, includeUndertags: false, readMode: true };

  it('keeps headings and drops doc-level paragraphs with no highlights', () => {
    const doc = makeDoc(pocket('P'), paragraph(txt('no highlight here')));
    const out = transformForExport(doc, RM);
    expect(out.childCount).toBe(1);
    expect(out.firstChild!.type.name).toBe('pocket');
  });

  it('drops doc-level loose paragraphs entirely (display: none in read mode)', () => {
    const doc = makeDoc(
      paragraph(txt('before '), txt('keep me', 'highlight'), txt(' after')),
    );
    const out = transformForExport(doc, RM);
    // Doc-level body paragraphs aren't in the read-mode visible-
    // children allowlist (.ProseMirror > .pmd-paragraph etc. are
    // display:none), so they drop regardless of inner highlights.
    expect(out.childCount).toBe(0);
  });

  it('keeps tag + cite-mark text in cite_paragraph + highlighted card body', () => {
    const doc = makeDoc(
      card(
        tag('My Tag'),
        citeParagraph(txt('Author 2024', 'cite_mark'), txt(' — extra metadata')),
        cardBody(txt('lorem '), txt('important', 'highlight'), txt(' ipsum')),
      ),
    );
    const out = transformForExport(doc, RM);
    const c = out.firstChild!;
    expect(c.type.name).toBe('card');
    expect(c.childCount).toBe(3);
    expect(c.child(0).type.name).toBe('tag');
    expect(c.child(1).type.name).toBe('cite_paragraph');
    expect(c.child(1).textContent).toBe('Author 2024');
    expect(c.child(2).type.name).toBe('card_body');
    expect(c.child(2).textContent).toBe('important');
  });

  it('drops a card_body entirely when nothing inside it is highlighted', () => {
    const doc = makeDoc(card(tag('T'), cardBody(txt('plain body — no highlight'))));
    const out = transformForExport(doc, RM);
    const c = out.firstChild!;
    expect(c.childCount).toBe(1);
    expect(c.child(0).type.name).toBe('tag');
  });

  it('keeps in-card analytics whole even when they have no highlight', () => {
    const doc = makeDoc(card(tag('T'), analytic('analytic copy'), cardBody(txt('plain'))));
    const out = transformForExport(doc, RM);
    const c = out.firstChild!;
    expect(c.childCount).toBe(2);
    expect(c.child(0).type.name).toBe('tag');
    expect(c.child(1).type.name).toBe('analytic');
    expect(c.child(1).textContent).toBe('analytic copy');
  });

  it('keeps standalone analytic_units; their bodies filter to highlighted text', () => {
    const doc = makeDoc(
      analyticUnit(
        analytic('A'),
        cardBody(txt('plain '), txt('mark', 'highlight'), txt(' plain')),
      ),
    );
    const out = transformForExport(doc, RM);
    const au = out.firstChild!;
    expect(au.type.name).toBe('analytic_unit');
    expect(au.childCount).toBe(2);
    expect(au.child(1).textContent).toBe('mark');
  });

  it('drops undertags in read mode (hidden by the read-mode CSS regardless of inner highlights)', () => {
    const undertagWithHighlight = schema.nodes['undertag']!.create(null, [
      txt('before '),
      txt('mark', 'highlight'),
      txt(' after'),
    ]);
    const doc = makeDoc(
      card(tag('T1'), undertag('plain undertag')),
      card(tag('T2'), undertagWithHighlight),
    );
    const out = transformForExport(doc, RM);
    const c1 = out.child(0);
    const c2 = out.child(1);
    // Undertags aren't in the read-mode visible-children allowlist
    // (.pmd-card > .pmd-undertag stays display:none), so they drop
    // wholesale — even when they contain highlighted text.
    expect(c1.childCount).toBe(1);
    expect(c2.childCount).toBe(1);
    expect(c2.child(0).type.name).toBe('tag');
  });

  it('merges adjacent card_bodies into a single flowing paragraph', () => {
    const doc = makeDoc(card(
      tag('T'),
      cardBody(txt('first ', 'highlight')),
      cardBody(txt('second ', 'highlight')),
      cardBody(txt('third', 'highlight')),
    ));
    const out = transformForExport(doc, RM);
    const c = out.firstChild!;
    expect(c.childCount).toBe(2);
    expect(c.child(0).type.name).toBe('tag');
    expect(c.child(1).type.name).toBe('card_body');
    expect(c.child(1).textContent).toBe('first second third');
  });

  it('inserts a separator space between consecutive kept inlines that lack natural whitespace', () => {
    const doc = makeDoc(card(
      tag('T'),
      cardBody(
        txt('before '),
        txt('Author', 'highlight'),
        txt(' some plain '),
        txt('2024', 'highlight'),
        txt(' after'),
      ),
    ));
    const out = transformForExport(doc, RM);
    const body = out.firstChild!.child(1);
    expect(body.type.name).toBe('card_body');
    expect(body.textContent).toBe('Author 2024');
  });

  it('does not insert a double space when the boundary already has whitespace', () => {
    const doc = makeDoc(card(
      tag('T'),
      cardBody(
        txt('first ', 'highlight'),  // trailing space already present
        txt(' plain text '),
        txt(' second', 'highlight'), // leading space already present
      ),
    ));
    const out = transformForExport(doc, RM);
    const body = out.firstChild!.child(1);
    // Both natural whitespace boundaries kept; no synthetic space.
    expect(body.textContent).toBe('first  second');
  });

  it('cite_paragraph between bodies breaks the merge (cite is its own block)', () => {
    const doc = makeDoc(card(
      tag('T'),
      cardBody(txt('body1', 'highlight')),
      citeParagraph(txt('Author 2024', 'cite_mark'), txt(' rest of cite')),
      cardBody(txt('body2', 'highlight')),
    ));
    const out = transformForExport(doc, RM);
    const c = out.firstChild!;
    expect(c.childCount).toBe(4);
    expect(c.child(0).type.name).toBe('tag');
    expect(c.child(1).type.name).toBe('card_body');
    expect(c.child(1).textContent).toBe('body1');
    expect(c.child(2).type.name).toBe('cite_paragraph');
    expect(c.child(2).textContent).toBe('Author 2024');
    expect(c.child(3).type.name).toBe('card_body');
    expect(c.child(3).textContent).toBe('body2');
  });

  it('undertag between bodies does NOT break the merge (undertag is invisible in read mode)', () => {
    const doc = makeDoc(card(
      tag('T'),
      cardBody(txt('body1', 'highlight')),
      undertag('plain'),
      cardBody(txt('body2', 'highlight')),
    ));
    const out = transformForExport(doc, RM);
    const c = out.firstChild!;
    expect(c.childCount).toBe(2);
    expect(c.child(1).textContent).toBe('body1 body2');
  });

  it('drops tables in read mode', () => {
    const cellPara = schema.nodes['paragraph']!.create(null, schema.text('cell'));
    const tableCell = schema.nodes['table_cell']!.create(null, [cellPara]);
    const tableRow = schema.nodes['table_row']!.create(null, [tableCell]);
    const table = schema.nodes['table']!.create(null, [tableRow]);
    const doc = makeDoc(pocket('P'), table);
    const out = transformForExport(doc, RM);
    expect(out.childCount).toBe(1);
    expect(out.firstChild!.type.name).toBe('pocket');
  });
});
