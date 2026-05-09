/**
 * Smoke tests confirming exported .docx files have structural validity:
 * the zip parses, the expected parts exist, and the XML is well-formed.
 */

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { fromDocx } from '../../src/import/index.js';
import { toDocx } from '../../src/export/index.js';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { parseXml } from '../../src/ooxml/parse.js';

const DOCS_DIR = path.resolve(process.cwd(), 'reference-docs/example docs');

describe('exported docx structural validity', () => {
  it('produces a valid zip with all required parts', async () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['pocket']!.create({ id: newHeadingId() }, schema.text('Pocket')),
    ]);
    const bytes = await toDocx(doc);
    const zip = await JSZip.loadAsync(bytes);

    const requiredParts = [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/styles.xml',
      'word/_rels/document.xml.rels',
    ];
    for (const part of requiredParts) {
      expect(zip.file(part), `missing required part ${part}`).toBeDefined();
    }
  });

  it('produces well-formed XML in document.xml', async () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['pocket']!.create({ id: newHeadingId() }, schema.text('Pocket')),
      schema.nodes['card']!.create(null, [
        schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag')),
        schema.nodes['card_body']!.create(null, [
          schema.text('plain '),
          schema.text('marked', [
            schema.marks['underline_mark']!.create(),
            schema.marks['highlight']!.create({ color: 'yellow' }),
          ]),
        ]),
      ]),
    ]);
    const bytes = await toDocx(doc);
    const zip = await JSZip.loadAsync(bytes);
    const docXml = await zip.file('word/document.xml')!.async('string');

    // If the XML is malformed, parseXml will throw.
    expect(() => parseXml(docXml)).not.toThrow();
  });

  it('round-tripping a real doc still produces well-formed XML', async () => {
    const buf = await readFile(path.join(DOCS_DIR, 'CP - Bifurcation PIC vs Fed Workers.docx'));
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const imported = await fromDocx(bytes);
    const reExported = await toDocx(imported);
    const zip = await JSZip.loadAsync(reExported);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(() => parseXml(docXml)).not.toThrow();

    const stylesXml = await zip.file('word/styles.xml')!.async('string');
    expect(() => parseXml(stylesXml)).not.toThrow();

    const relsXml = await zip.file('word/_rels/document.xml.rels')!.async('string');
    expect(() => parseXml(relsXml)).not.toThrow();
  });

  it('exported styles.xml contains all canonical style ids', async () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, schema.text('hi')),
    ]);
    const bytes = await toDocx(doc);
    const zip = await JSZip.loadAsync(bytes);
    const stylesXml = await zip.file('word/styles.xml')!.async('string');

    const requiredStyleIds = [
      'Heading1', 'Heading2', 'Heading3', 'Heading4',
      'Heading1Char', 'Heading2Char', 'Heading3Char', 'Heading4Char',
      'Style13ptBold', 'StyleUnderline', 'Emphasis',
      'Analytic', 'AnalyticChar', 'Undertag', 'UndertagChar',
      'Normal', 'DefaultParagraphFont',
    ];
    for (const id of requiredStyleIds) {
      expect(
        stylesXml.includes(`w:styleId="${id}"`),
        `expected styleId "${id}" in styles.xml`,
      ).toBe(true);
    }
  });

  it('Heading1 in exported styles.xml has Pocket alias and pBdr (boxes)', async () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, schema.text('hi')),
    ]);
    const bytes = await toDocx(doc);
    const zip = await JSZip.loadAsync(bytes);
    const stylesXml = await zip.file('word/styles.xml')!.async('string');

    expect(stylesXml).toContain('<w:aliases w:val="Pocket"/>');
    expect(stylesXml).toContain('<w:aliases w:val="Hat"/>');
    expect(stylesXml).toContain('<w:aliases w:val="Block"/>');
    expect(stylesXml).toContain('<w:aliases w:val="Tag"/>');
    expect(stylesXml).toContain('<w:aliases w:val="Cite"/>');
    expect(stylesXml).toContain('<w:aliases w:val="Underline"/>');
    // Pocket box: paragraph borders all four sides.
    expect(stylesXml).toContain('<w:pBdr>');
    // Emphasis box: character border.
    expect(stylesXml).toContain('<w:bdr');
  });
});
