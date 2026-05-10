import { describe, expect, it } from 'vitest';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { importDoc } from '../../src/import/index.js';
import { exportDoc } from '../../src/export/index.js';

function bodyXml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${inner}</w:body></w:document>`;
}

describe('importer — paragraph kinds', () => {
  it('imports a Heading1 paragraph as pocket', () => {
    const xml = bodyXml(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Pocket text</w:t></w:r></w:p>`);
    const doc = importDoc(xml);
    expect(doc.firstChild!.type.name).toBe('pocket');
    expect(doc.firstChild!.textContent).toBe('Pocket text');
  });

  it('imports a Heading2 paragraph as hat', () => {
    const xml = bodyXml(`<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Hat</w:t></w:r></w:p>`);
    const doc = importDoc(xml);
    expect(doc.firstChild!.type.name).toBe('hat');
  });

  it('imports a Heading3 paragraph as block', () => {
    const xml = bodyXml(`<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Block</w:t></w:r></w:p>`);
    const doc = importDoc(xml);
    expect(doc.firstChild!.type.name).toBe('block');
  });

  it('imports an Analytic paragraph as analytic_unit > analytic', () => {
    const xml = bodyXml(`<w:p><w:pPr><w:pStyle w:val="Analytic"/></w:pPr><w:r><w:t>An analytic</w:t></w:r></w:p>`);
    const doc = importDoc(xml);
    expect(doc.firstChild!.type.name).toBe('analytic_unit');
    expect(doc.firstChild!.firstChild!.type.name).toBe('analytic');
    expect(doc.firstChild!.firstChild!.textContent).toBe('An analytic');
  });

  it('absorbs body paragraphs after a standalone analytic into the unit', () => {
    const xml = bodyXml(`
      <w:p><w:pPr><w:pStyle w:val="Analytic"/></w:pPr><w:r><w:t>Header</w:t></w:r></w:p>
      <w:p><w:r><w:t>Body 1</w:t></w:r></w:p>
      <w:p><w:r><w:t>Body 2</w:t></w:r></w:p>
    `);
    const doc = importDoc(xml);
    const unit = doc.firstChild!;
    expect(unit.type.name).toBe('analytic_unit');
    expect(unit.childCount).toBe(3);
    expect(unit.child(0).type.name).toBe('analytic');
    expect(unit.child(1).type.name).toBe('card_body');
    expect(unit.child(2).type.name).toBe('card_body');
  });

  it('imports an Undertag paragraph as undertag', () => {
    const xml = bodyXml(`<w:p><w:pPr><w:pStyle w:val="Undertag"/></w:pPr><w:r><w:t>Undertag</w:t></w:r></w:p>`);
    const doc = importDoc(xml);
    expect(doc.firstChild!.type.name).toBe('undertag');
  });

  it('imports a Normal paragraph (no pStyle) as paragraph', () => {
    const xml = bodyXml(`<w:p><w:r><w:t>Plain</w:t></w:r></w:p>`);
    const doc = importDoc(xml);
    expect(doc.firstChild!.type.name).toBe('paragraph');
  });

  it('imports an unknown pStyle as paragraph (stylepox cleanup)', () => {
    const xml = bodyXml(`<w:p><w:pPr><w:pStyle w:val="AAAUNDERLINEKEYBOARD"/></w:pPr><w:r><w:t>Junk</w:t></w:r></w:p>`);
    const doc = importDoc(xml);
    expect(doc.firstChild!.type.name).toBe('paragraph');
  });
});

describe('importer — card grouping', () => {
  it('groups Tag + Normal into a card with cite_paragraph', () => {
    const xml = bodyXml(`
      <w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:r><w:t>Tag text</w:t></w:r></w:p>
      <w:p><w:r><w:t>Author 2024, Source</w:t></w:r></w:p>
      <w:p><w:r><w:t>Body text.</w:t></w:r></w:p>
    `);
    const doc = importDoc(xml);
    expect(doc.firstChild!.type.name).toBe('card');
    const card = doc.firstChild!;
    expect(card.child(0).type.name).toBe('tag');
    expect(card.child(0).textContent).toBe('Tag text');
    expect(card.child(1).type.name).toBe('cite_paragraph');
    expect(card.child(1).textContent).toBe('Author 2024, Source');
    expect(card.child(2).type.name).toBe('card_body');
    expect(card.child(2).textContent).toBe('Body text.');
  });

  it('handles a card with just a tag (no body)', () => {
    const xml = bodyXml(`
      <w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:r><w:t>Lonely</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Next block</w:t></w:r></w:p>
    `);
    const doc = importDoc(xml);
    expect(doc.firstChild!.type.name).toBe('card');
    expect(doc.firstChild!.childCount).toBe(1);
    expect(doc.child(1).type.name).toBe('block');
  });

  it('handles two consecutive Tags as two cards', () => {
    const xml = bodyXml(`
      <w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:r><w:t>Tag 1</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:r><w:t>Tag 2</w:t></w:r></w:p>
    `);
    const doc = importDoc(xml);
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe('card');
    expect(doc.child(1).type.name).toBe('card');
  });

  it('absorbs undertags after a tag into the same card', () => {
    const xml = bodyXml(`
      <w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:r><w:t>Tag text</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Undertag"/></w:pPr><w:r><w:t>Sub-tag note</w:t></w:r></w:p>
      <w:p><w:r><w:t>Author 2024</w:t></w:r></w:p>
      <w:p><w:r><w:t>Body</w:t></w:r></w:p>
    `);
    const doc = importDoc(xml);
    expect(doc.firstChild!.type.name).toBe('card');
    const card = doc.firstChild!;
    expect(card.child(0).type.name).toBe('tag');
    expect(card.child(1).type.name).toBe('undertag');
    expect(card.child(1).textContent).toBe('Sub-tag note');
    expect(card.child(2).type.name).toBe('cite_paragraph');
    expect(card.child(3).type.name).toBe('card_body');
  });

  it('absorbs multiple undertags after a single tag', () => {
    const xml = bodyXml(`
      <w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:r><w:t>Tag</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Undertag"/></w:pPr><w:r><w:t>Note 1</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Undertag"/></w:pPr><w:r><w:t>Note 2</w:t></w:r></w:p>
      <w:p><w:r><w:t>Body</w:t></w:r></w:p>
    `);
    const doc = importDoc(xml);
    const card = doc.firstChild!;
    expect(card.child(0).type.name).toBe('tag');
    expect(card.child(1).type.name).toBe('undertag');
    expect(card.child(2).type.name).toBe('undertag');
    expect(card.child(3).type.name).toBe('cite_paragraph');
  });

  it('handles in-card analytic between tag and body', () => {
    const xml = bodyXml(`
      <w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:r><w:t>Tag</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Analytic"/></w:pPr><w:r><w:t>An analytic</w:t></w:r></w:p>
      <w:p><w:r><w:t>Body</w:t></w:r></w:p>
    `);
    const doc = importDoc(xml);
    expect(doc.firstChild!.type.name).toBe('card');
    const card = doc.firstChild!;
    expect(card.child(0).type.name).toBe('tag');
    expect(card.child(1).type.name).toBe('analytic');
    expect(card.child(2).type.name).toBe('card_body');
  });
});

describe('importer — heading IDs from bookmarks', () => {
  it('extracts pmd-heading-<uuid> bookmark to id attr', () => {
    const xml = bodyXml(`
      <w:p>
        <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
        <w:bookmarkStart w:id="0" w:name="pmd-heading-deadbeef-1234-5678-9abc-def012345678"/>
        <w:r><w:t>Pocket</w:t></w:r>
        <w:bookmarkEnd w:id="0"/>
      </w:p>
    `);
    const doc = importDoc(xml);
    expect(doc.firstChild!.attrs['id']).toBe('deadbeef-1234-5678-9abc-def012345678');
  });

  it('generates a fresh id when no bookmark is present', () => {
    const xml = bodyXml(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Pocket</w:t></w:r></w:p>`);
    const doc = importDoc(xml);
    const id = doc.firstChild!.attrs['id'];
    expect(id).toMatch(/^[0-9a-f]{8}-/i);
  });

  it('ignores non-pmd bookmark names', () => {
    const xml = bodyXml(`
      <w:p>
        <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
        <w:bookmarkStart w:id="0" w:name="_GoBack"/>
        <w:r><w:t>Pocket</w:t></w:r>
        <w:bookmarkEnd w:id="0"/>
      </w:p>
    `);
    const doc = importDoc(xml);
    const id = doc.firstChild!.attrs['id'];
    // Should be a fresh UUID, not _GoBack.
    expect(id).toMatch(/^[0-9a-f]{8}-/i);
  });
});

describe('importer — marks from rPr', () => {
  function importInline(rPr: string): readonly _Mark[] {
    const xml = bodyXml(`<w:p><w:r><w:rPr>${rPr}</w:rPr><w:t>foo</w:t></w:r></w:p>`);
    const doc = importDoc(xml);
    const para = doc.firstChild!;
    return para.firstChild!.marks;
  }

  it('extracts cite_mark from rStyle="Style13ptBold"', () => {
    const marks = importInline('<w:rStyle w:val="Style13ptBold"/>');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.type.name).toBe('cite_mark');
  });

  it('extracts underline_mark from rStyle="StyleUnderline"', () => {
    const marks = importInline('<w:rStyle w:val="StyleUnderline"/>');
    expect(marks.some((m) => m.type.name === 'underline_mark')).toBe(true);
  });

  it('extracts emphasis_mark from rStyle="Emphasis"', () => {
    const marks = importInline('<w:rStyle w:val="Emphasis"/>');
    expect(marks.some((m) => m.type.name === 'emphasis_mark')).toBe(true);
  });

  it('extracts undertag_mark from rStyle="UndertagChar"', () => {
    const marks = importInline('<w:rStyle w:val="UndertagChar"/>');
    expect(marks.some((m) => m.type.name === 'undertag_mark')).toBe(true);
  });

  it('extracts analytic_mark from rStyle="AnalyticChar"', () => {
    const marks = importInline('<w:rStyle w:val="AnalyticChar"/>');
    expect(marks.some((m) => m.type.name === 'analytic_mark')).toBe(true);
  });

  it('extracts bold from <w:b/>', () => {
    const marks = importInline('<w:b/>');
    expect(marks.some((m) => m.type.name === 'bold')).toBe(true);
  });

  it('does not extract bold when explicitly disabled (<w:b w:val="0"/>)', () => {
    const marks = importInline('<w:b w:val="0"/>');
    expect(marks.some((m) => m.type.name === 'bold')).toBe(false);
  });

  it('extracts italic from <w:i/>', () => {
    const marks = importInline('<w:i/>');
    expect(marks.some((m) => m.type.name === 'italic')).toBe(true);
  });

  it('extracts highlight color', () => {
    const marks = importInline('<w:highlight w:val="yellow"/>');
    const hl = marks.find((m) => m.type.name === 'highlight');
    expect(hl).toBeDefined();
    expect(hl!.attrs['color']).toBe('yellow');
  });

  it('extracts font_color (the #555555 reference sentinel)', () => {
    const marks = importInline('<w:color w:val="555555"/>');
    const fc = marks.find((m) => m.type.name === 'font_color');
    expect(fc).toBeDefined();
    expect(fc!.attrs['color']).toBe('555555');
  });

  it('extracts font_size in half-points', () => {
    const marks = importInline('<w:sz w:val="26"/>');
    const fs = marks.find((m) => m.type.name === 'font_size');
    expect(fs).toBeDefined();
    expect(fs!.attrs['halfPoints']).toBe(26);
  });

  it('extracts shading (the #D2D2D2 protected-highlight sentinel)', () => {
    const marks = importInline('<w:shd w:val="clear" w:color="auto" w:fill="D2D2D2"/>');
    const sh = marks.find((m) => m.type.name === 'shading');
    expect(sh).toBeDefined();
    expect(sh!.attrs['color']).toBe('D2D2D2');
  });

  it('extracts font_family from <w:rFonts> (prefers w:ascii)', () => {
    const marks = importInline('<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>');
    const ff = marks.find((m) => m.type.name === 'font_family');
    expect(ff).toBeDefined();
    expect(ff!.attrs['name']).toBe('Arial');
  });

  it('font_family falls back to w:hAnsi when w:ascii is missing', () => {
    const marks = importInline('<w:rFonts w:hAnsi="Times New Roman"/>');
    const ff = marks.find((m) => m.type.name === 'font_family');
    expect(ff).toBeDefined();
    expect(ff!.attrs['name']).toBe('Times New Roman');
  });

  it('font_family is dropped when no font name is present', () => {
    const marks = importInline('<w:rFonts/>');
    const ff = marks.find((m) => m.type.name === 'font_family');
    expect(ff).toBeUndefined();
  });

  it('does not double-count underline when both rStyle="StyleUnderline" and <w:u/> are present', () => {
    const marks = importInline('<w:rStyle w:val="StyleUnderline"/><w:u w:val="single"/>');
    const count = marks.filter((m) => m.type.name === 'underline_mark').length;
    expect(count).toBe(1);
  });
});

describe('importer — hyperlinks', () => {
  it('attaches a link mark from a w:hyperlink element', () => {
    const docXml = bodyXml(`
      <w:p>
        <w:hyperlink r:id="rId2" w:history="1">
          <w:r><w:t>click</w:t></w:r>
        </w:hyperlink>
      </w:p>
    `);
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>`;
    const doc = importDoc(docXml, relsXml);
    const para = doc.firstChild!;
    const text = para.firstChild!;
    const linkMark = text.marks.find((m) => m.type.name === 'link');
    expect(linkMark).toBeDefined();
    expect(linkMark!.attrs['href']).toBe('https://example.com');
  });
});

describe('importer — multi-paragraph patterns', () => {
  it('imports a doc with the multi-file pattern (Pocket → empty Pocket → Pocket)', () => {
    const xml = bodyXml(`
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>File A</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>File B</w:t></w:r></w:p>
    `);
    const doc = importDoc(xml);
    expect(doc.childCount).toBe(3);
    expect(doc.child(0).type.name).toBe('pocket');
    expect(doc.child(1).type.name).toBe('pocket');
    expect(doc.child(1).childCount).toBe(0);
    expect(doc.child(2).type.name).toBe('pocket');
  });

  it('imports a CP-style doc (no Heading1 at all)', () => {
    const xml = bodyXml(`
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Hat</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Block</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:r><w:t>Tag</w:t></w:r></w:p>
    `);
    const doc = importDoc(xml);
    expect(doc.child(0).type.name).toBe('hat');
    expect(doc.child(1).type.name).toBe('block');
    expect(doc.child(2).type.name).toBe('card');
  });
});

describe('round-trip: import → export → import', () => {
  it('preserves a simple structure', () => {
    const original = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['pocket']!.create({ id: '11111111-1111-1111-1111-111111111111' }, schema.text('Pocket')),
      schema.nodes['hat']!.create({ id: '22222222-2222-2222-2222-222222222222' }, schema.text('Hat')),
      schema.nodes['block']!.create({ id: '33333333-3333-3333-3333-333333333333' }, schema.text('Block')),
      schema.nodes['card']!.create(null, [
        schema.nodes['tag']!.create({ id: '44444444-4444-4444-4444-444444444444' }, schema.text('Tag')),
        schema.nodes['cite_paragraph']!.create(null, schema.text('Author 2024')),
        schema.nodes['card_body']!.create(null, schema.text('Body')),
      ]),
    ]);

    const { documentXml, relsXml } = exportDoc(original);
    const reimported = importDoc(documentXml, relsXml);

    expect(reimported.childCount).toBe(4);
    expect(reimported.child(0).type.name).toBe('pocket');
    expect(reimported.child(0).textContent).toBe('Pocket');
    expect(reimported.child(0).attrs['id']).toBe('11111111-1111-1111-1111-111111111111');
    expect(reimported.child(1).type.name).toBe('hat');
    expect(reimported.child(2).type.name).toBe('block');
    expect(reimported.child(3).type.name).toBe('card');
    const card = reimported.child(3);
    expect(card.child(0).type.name).toBe('tag');
    expect(card.child(0).attrs['id']).toBe('44444444-4444-4444-4444-444444444444');
    expect(card.child(1).type.name).toBe('cite_paragraph');
    expect(card.child(2).type.name).toBe('card_body');
  });

  it('preserves marks through round-trip', () => {
    const original = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, [
        schema.text('plain '),
        schema.text('underlined', [schema.marks['underline_mark']!.create()]),
        schema.text(' '),
        schema.text('highlighted', [
          schema.marks['underline_mark']!.create(),
          schema.marks['highlight']!.create({ color: 'yellow' }),
        ]),
      ]),
    ]);

    const { documentXml, relsXml } = exportDoc(original);
    const reimported = importDoc(documentXml, relsXml);

    const para = reimported.firstChild!;
    expect(para.textContent).toBe('plain underlined highlighted');

    // Find the highlighted text node and verify its marks.
    let foundHighlighted = false;
    para.descendants((node) => {
      if (node.isText && node.text === 'highlighted') {
        foundHighlighted = true;
        expect(node.marks.some((m) => m.type.name === 'underline_mark')).toBe(true);
        expect(node.marks.some((m) => m.type.name === 'highlight')).toBe(true);
      }
    });
    expect(foundHighlighted).toBe(true);
  });

  it('preserves hyperlinks through round-trip', () => {
    const original = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, [
        schema.text('see '),
        schema.text('this article', [schema.marks['link']!.create({ href: 'https://example.com/article' })]),
      ]),
    ]);

    const { documentXml, relsXml } = exportDoc(original);
    const reimported = importDoc(documentXml, relsXml);

    const para = reimported.firstChild!;
    let found = false;
    para.descendants((node) => {
      if (node.isText && node.text === 'this article') {
        found = true;
        const link = node.marks.find((m) => m.type.name === 'link');
        expect(link).toBeDefined();
        expect(link!.attrs['href']).toBe('https://example.com/article');
      }
    });
    expect(found).toBe(true);
  });
});

// Type alias used by the importInline helper above (declared here so it's
// hoisted via TypeScript type-only ordering rules).
type _Mark = ReturnType<typeof schema.marks['bold']['create']>;
