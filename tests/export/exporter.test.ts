import { describe, expect, it } from 'vitest';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { exportDoc } from '../../src/export/index.js';
import { toDocx } from '../../src/export/index.js';
import { Docx } from '../../src/ooxml/docx.js';

describe('exporter — basic structure', () => {
  it('emits a valid docx envelope', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, schema.text('hello')),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).toContain('<w:document');
    expect(documentXml).toContain('<w:body>');
    expect(documentXml).toContain('</w:body>');
    expect(documentXml).toContain('</w:document>');
    expect(documentXml).toContain('<w:sectPr>');
  });

  it('emits a single paragraph with text content', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, schema.text('hello world')),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).toContain('<w:p>');
    expect(documentXml).toContain('<w:t xml:space="preserve">hello world</w:t>');
  });

  it('escapes XML special chars in text', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, schema.text('A & B < C > D')),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).toContain('A &amp; B &lt; C &gt; D');
    expect(documentXml).not.toContain('A & B');
  });
});

describe('exporter — paragraph styles', () => {
  it('emits Heading1 pStyle for pocket', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['pocket']!.create({ id: newHeadingId() }, schema.text('Pocket')),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).toContain('<w:pStyle w:val="Heading1"/>');
  });

  it('emits Heading2 pStyle for hat', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['hat']!.create({ id: newHeadingId() }, schema.text('Hat')),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).toContain('<w:pStyle w:val="Heading2"/>');
  });

  it('emits Heading3 pStyle for block', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['block']!.create({ id: newHeadingId() }, schema.text('Block')),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).toContain('<w:pStyle w:val="Heading3"/>');
  });

  it('emits Heading4 pStyle for tag (inside card)', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['card']!.create(null, [
        schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag')),
      ]),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).toContain('<w:pStyle w:val="Heading4"/>');
  });

  it('emits Analytic pStyle for analytic inside analytic_unit', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['analytic_unit']!.create(null, [
        schema.nodes['analytic']!.create({ id: newHeadingId() }, schema.text('Analytic')),
      ]),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).toContain('<w:pStyle w:val="Analytic"/>');
  });

  it('emits Undertag pStyle for undertag', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['undertag']!.create(null, schema.text('Undertag')),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).toContain('<w:pStyle w:val="Undertag"/>');
  });

  it('emits no pStyle for paragraph (implicit Normal)', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, schema.text('Body')),
    ]);
    const { documentXml } = exportDoc(doc);
    // Must not have a pStyle for Normal; should be a bare <w:p>...</w:p>
    expect(documentXml).not.toContain('<w:pStyle');
  });

  it('emits no pStyle for cite_paragraph (cite is run-styled, not paragraph-styled)', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['cite_paragraph']!.create(null, schema.text('Author 2024')),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).not.toContain('<w:pStyle');
  });

  it('emits no pStyle for card_body', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['card']!.create(null, [
        schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag')),
        schema.nodes['card_body']!.create(null, schema.text('Body')),
      ]),
    ]);
    const { documentXml } = exportDoc(doc);
    // The tag will have a pStyle, but the card_body should not.
    const headingMatches = (documentXml.match(/<w:pStyle/g) ?? []).length;
    expect(headingMatches).toBe(1);
  });
});

describe('exporter — heading bookmarks', () => {
  it('wraps headings in pmd-heading-<uuid> bookmarks', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['pocket']!.create({ id }, schema.text('Pocket')),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).toContain('<w:bookmarkStart w:id="0" w:name="pmd-heading-11111111-2222-3333-4444-555555555555"/>');
    expect(documentXml).toContain('<w:bookmarkEnd w:id="0"/>');
  });

  it('uses unique bookmark ids per heading', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['pocket']!.create({ id: newHeadingId() }, schema.text('First')),
      schema.nodes['hat']!.create({ id: newHeadingId() }, schema.text('Second')),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).toContain('w:id="0"');
    expect(documentXml).toContain('w:id="1"');
  });

  it('does not emit bookmarks on non-heading paragraphs', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, schema.text('Body text')),
    ]);
    const { documentXml } = exportDoc(doc);
    expect(documentXml).not.toContain('<w:bookmark');
  });
});

describe('exporter — marks → rPr', () => {
  function emitInline(marks: ReturnType<typeof schema.text>['marks'], text = 'foo'): string {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, schema.text(text, marks)),
    ]);
    return exportDoc(doc).documentXml;
  }

  it('emits rStyle for cite_mark', () => {
    const xml = emitInline([schema.marks['cite_mark']!.create()]);
    expect(xml).toContain('<w:rStyle w:val="Style13ptBold"/>');
  });

  it('emits rStyle + dual underline for underline_mark', () => {
    const xml = emitInline([schema.marks['underline_mark']!.create()]);
    expect(xml).toContain('<w:rStyle w:val="StyleUnderline"/>');
    expect(xml).toContain('<w:u w:val="single"/>');
  });

  it('emits rStyle for emphasis_mark', () => {
    const xml = emitInline([schema.marks['emphasis_mark']!.create()]);
    expect(xml).toContain('<w:rStyle w:val="Emphasis"/>');
  });

  it('emits rStyle + italic for undertag_mark', () => {
    const xml = emitInline([schema.marks['undertag_mark']!.create()]);
    expect(xml).toContain('<w:rStyle w:val="UndertagChar"/>');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:iCs/>');
  });

  it('emits rStyle for analytic_mark', () => {
    const xml = emitInline([schema.marks['analytic_mark']!.create()]);
    expect(xml).toContain('<w:rStyle w:val="AnalyticChar"/>');
  });

  it('emits <w:b/> for bold', () => {
    const xml = emitInline([schema.marks['bold']!.create()]);
    expect(xml).toContain('<w:b/>');
  });

  it('emits <w:strike/> for strikethrough', () => {
    const xml = emitInline([schema.marks['strikethrough']!.create()]);
    expect(xml).toContain('<w:strike/>');
  });

  it('emits <w:i/><w:iCs/> for italic', () => {
    const xml = emitInline([schema.marks['italic']!.create()]);
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:iCs/>');
  });

  it('emits highlight color', () => {
    const xml = emitInline([schema.marks['highlight']!.create({ color: 'yellow' })]);
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
  });

  it('emits font color (the #555555 reference sentinel)', () => {
    const xml = emitInline([schema.marks['font_color']!.create({ color: '555555' })]);
    expect(xml).toContain('<w:color w:val="555555"/>');
  });

  it('emits font size in half-points', () => {
    const xml = emitInline([schema.marks['font_size']!.create({ halfPoints: 26 })]);
    expect(xml).toContain('<w:sz w:val="26"/>');
    expect(xml).toContain('<w:szCs w:val="26"/>');
  });

  it('emits pilcrow_marker as a 6-pt size (matches Verbatim\'s encoding)', () => {
    const xml = emitInline([schema.marks['pilcrow_marker']!.create()], '¶');
    expect(xml).toContain('<w:sz w:val="12"/>');
    expect(xml).toContain('<w:szCs w:val="12"/>');
    expect(xml).toContain('¶');
  });

  it('emits shading (the protected-highlight #D2D2D2 sentinel)', () => {
    const xml = emitInline([schema.marks['shading']!.create({ color: 'D2D2D2' })]);
    expect(xml).toContain('<w:shd w:val="clear" w:color="auto" w:fill="D2D2D2"/>');
  });

  it('emits font_family as <w:rFonts> across ascii / hAnsi / cs', () => {
    const xml = emitInline([schema.marks['font_family']!.create({ name: 'Arial' })]);
    expect(xml).toContain('<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>');
  });

  it('emits font_family with multi-word fonts (e.g. "Times New Roman")', () => {
    const xml = emitInline([schema.marks['font_family']!.create({ name: 'Times New Roman' })]);
    expect(xml).toContain('<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>');
  });

  it('combines multiple marks correctly', () => {
    const xml = emitInline([
      schema.marks['underline_mark']!.create(),
      schema.marks['highlight']!.create({ color: 'yellow' }),
      schema.marks['bold']!.create(),
    ]);
    expect(xml).toContain('<w:rStyle w:val="StyleUnderline"/>');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:u w:val="single"/>');
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
  });
});

describe('exporter — hyperlinks', () => {
  it('wraps a linked run in <w:hyperlink> and registers a relationship', () => {
    const url = 'https://example.com/article';
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, [
        schema.text('plain '),
        schema.text('linked', [schema.marks['link']!.create({ href: url })]),
        schema.text(' more'),
      ]),
    ]);
    const { documentXml, relsXml } = exportDoc(doc);
    expect(documentXml).toContain('<w:hyperlink');
    expect(documentXml).toMatch(/<w:hyperlink r:id="rId\d+" w:history="1"><w:r>[^]*?<w:t xml:space="preserve">linked<\/w:t><\/w:r><\/w:hyperlink>/);
    expect(relsXml).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"');
    expect(relsXml).toContain(`Target="${url}"`);
    expect(relsXml).toContain('TargetMode="External"');
  });

  it('reuses rIds for repeated URLs', () => {
    const url = 'https://example.com';
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, [
        schema.text('a', [schema.marks['link']!.create({ href: url })]),
      ]),
      schema.nodes['paragraph']!.create(null, [
        schema.text('b', [schema.marks['link']!.create({ href: url })]),
      ]),
    ]);
    const { relsXml } = exportDoc(doc);
    const matches = relsXml.match(/Target="https:\/\/example\.com"/g);
    expect(matches).toHaveLength(1);
  });
});

describe('exporter — full docx', () => {
  it('produces a complete .docx with minimal structure', async () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['pocket']!.create({ id: newHeadingId() }, schema.text('Pocket')),
      schema.nodes['hat']!.create({ id: newHeadingId() }, schema.text('Hat')),
      schema.nodes['block']!.create({ id: newHeadingId() }, schema.text('Block')),
      schema.nodes['card']!.create(null, [
        schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag')),
        schema.nodes['cite_paragraph']!.create(null, schema.text('Author 2024, Source')),
        schema.nodes['card_body']!.create(null, [
          schema.text('regular '),
          schema.text('underlined', [schema.marks['underline_mark']!.create()]),
          schema.text(' '),
          schema.text('highlighted', [
            schema.marks['underline_mark']!.create(),
            schema.marks['highlight']!.create({ color: 'yellow' }),
          ]),
          schema.text(' end.'),
        ]),
      ]),
    ]);
    const bytes = await toDocx(doc);
    expect(bytes.length).toBeGreaterThan(1000);

    // Reload it and check that all the parts are there.
    const reloaded = await Docx.load(bytes);
    expect(await reloaded.readText('word/document.xml')).toBeDefined();
    expect(await reloaded.readText('word/styles.xml')).toBeDefined();
    expect(await reloaded.readText('[Content_Types].xml')).toBeDefined();
    expect(await reloaded.readText('_rels/.rels')).toBeDefined();
    expect(await reloaded.readText('word/_rels/document.xml.rels')).toBeDefined();

    const docContent = await reloaded.readText('word/document.xml');
    expect(docContent).toContain('Tag');
    expect(docContent).toContain('underlined');
  });
});
