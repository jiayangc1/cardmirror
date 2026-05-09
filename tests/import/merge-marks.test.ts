/**
 * Unit tests for the paragraph-default rPr inheritance behavior.
 * These exercise a subtle merging rule: named-style marks share an
 * OOXML slot, so a run with any named-style mark overrides ALL
 * named-style marks from defaults.
 */

import { describe, expect, it } from 'vitest';
import { importDoc } from '../../src/import/index.js';

function bodyXml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${inner}</w:body></w:document>`;
}

describe('paragraph-default rPr inheritance', () => {
  it('inherits highlight from paragraph default to run with no rPr', () => {
    const xml = bodyXml(`
      <w:p>
        <w:pPr>
          <w:pStyle w:val="Heading4"/>
          <w:rPr><w:highlight w:val="yellow"/></w:rPr>
        </w:pPr>
        <w:r><w:t>tag text</w:t></w:r>
      </w:p>
    `);
    const doc = importDoc(xml);
    const card = doc.firstChild!;
    const tag = card.firstChild!;
    const text = tag.firstChild!;
    expect(text.text).toBe('tag text');
    const hl = text.marks.find((m) => m.type.name === 'highlight');
    expect(hl).toBeDefined();
    expect(hl!.attrs['color']).toBe('yellow');
  });

  it('inherits underline_mark from paragraph default rStyle', () => {
    const xml = bodyXml(`
      <w:p>
        <w:pPr>
          <w:pStyle w:val="Heading4"/>
          <w:rPr><w:rStyle w:val="StyleUnderline"/></w:rPr>
        </w:pPr>
        <w:r><w:t>tag</w:t></w:r>
      </w:p>
    `);
    const doc = importDoc(xml);
    const text = doc.firstChild!.firstChild!.firstChild!;
    expect(text.marks.some((m) => m.type.name === 'underline_mark')).toBe(true);
  });

  it('run-specific named-style mark overrides paragraph-default named-style mark (single rStyle slot)', () => {
    // Paragraph default: StyleUnderline; run: Style13ptBold (Cite).
    // Result: only cite_mark (the run wins; underline_mark from default is dropped
    // because both are named-style marks sharing the same OOXML rStyle slot).
    const xml = bodyXml(`
      <w:p>
        <w:pPr>
          <w:pStyle w:val="Heading4"/>
          <w:rPr><w:rStyle w:val="StyleUnderline"/></w:rPr>
        </w:pPr>
        <w:r><w:rPr><w:rStyle w:val="Style13ptBold"/></w:rPr><w:t>cited</w:t></w:r>
      </w:p>
    `);
    const doc = importDoc(xml);
    const text = doc.firstChild!.firstChild!.firstChild!;
    const namedMarks = text.marks.filter((m) =>
      ['cite_mark', 'underline_mark', 'emphasis_mark', 'undertag_mark', 'analytic_mark'].includes(m.type.name),
    );
    expect(namedMarks).toHaveLength(1);
    expect(namedMarks[0]!.type.name).toBe('cite_mark');
  });

  it('non-named-style marks from default still inherit even when run has a named-style', () => {
    // Default: highlight=yellow + StyleUnderline; run: Style13ptBold.
    // Highlight inherits (different slot from rStyle); named-style replaces.
    const xml = bodyXml(`
      <w:p>
        <w:pPr>
          <w:pStyle w:val="Heading4"/>
          <w:rPr>
            <w:rStyle w:val="StyleUnderline"/>
            <w:highlight w:val="yellow"/>
          </w:rPr>
        </w:pPr>
        <w:r><w:rPr><w:rStyle w:val="Style13ptBold"/></w:rPr><w:t>cited</w:t></w:r>
      </w:p>
    `);
    const doc = importDoc(xml);
    const text = doc.firstChild!.firstChild!.firstChild!;
    expect(text.marks.some((m) => m.type.name === 'cite_mark')).toBe(true);
    expect(text.marks.some((m) => m.type.name === 'underline_mark')).toBe(false);
    expect(text.marks.some((m) => m.type.name === 'highlight')).toBe(true);
  });

  it('run-specific bold overrides paragraph-default bold (same slot)', () => {
    // Default: bold; run: <w:b w:val="0"/> (explicit no-bold).
    const xml = bodyXml(`
      <w:p>
        <w:pPr>
          <w:rPr><w:b/></w:rPr>
        </w:pPr>
        <w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>not bold</w:t></w:r>
      </w:p>
    `);
    const doc = importDoc(xml);
    const text = doc.firstChild!.firstChild!;
    expect(text.marks.some((m) => m.type.name === 'bold')).toBe(false);
  });

  it('paragraph-default does not leak across paragraphs', () => {
    const xml = bodyXml(`
      <w:p>
        <w:pPr><w:rPr><w:highlight w:val="yellow"/></w:rPr></w:pPr>
        <w:r><w:t>highlighted</w:t></w:r>
      </w:p>
      <w:p>
        <w:r><w:t>not highlighted</w:t></w:r>
      </w:p>
    `);
    const doc = importDoc(xml);
    const para1 = doc.child(0).firstChild!;
    const para2 = doc.child(1).firstChild!;
    expect(para1.marks.some((m) => m.type.name === 'highlight')).toBe(true);
    expect(para2.marks.some((m) => m.type.name === 'highlight')).toBe(false);
  });
});
