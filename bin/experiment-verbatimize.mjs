#!/usr/bin/env node
/**
 * Verbatimize-recognition experiment generator.
 *
 * Takes a CardMirror-exported .docx and emits five test variants
 * to a sibling output directory. You open each in Word with
 * Verbatim installed and report which ones activate the Debate
 * ribbon. The result tells us the minimum addition to our export
 * pipeline that makes a CardMirror docx Verbatim-recognized.
 *
 *   Usage: node bin/experiment-verbatimize.mjs path/to/base.docx
 *
 * Output: five files next to base.docx:
 *   base.docx                              (control — untouched)
 *   base.v1-control.docx                   (= base, renamed for clarity)
 *   base.v2-version-match.docx             (VerbatimVersion="6.0.0")
 *   base.v3-version-lower.docx             (VerbatimVersion="1.0")
 *   base.v4-version-sentinel.docx          (VerbatimVersion="cardmirror")
 *   base.v5-full-docvar-set.docx           (all five docVars from
 *                                          Debate.dotm's settings.xml)
 *
 * All five variants add or modify only `word/settings.xml` (and the
 * settings.xml content-type + document.xml.rels relationship if
 * those don't already exist in the base). Everything else — the
 * style block, the document body, comments, media — is left exactly
 * as CardMirror exported it.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, basename, extname, join } from 'node:path';
import JSZip from 'jszip';

const [, , inputPath] = process.argv;
if (!inputPath) {
  console.error('Usage: node bin/experiment-verbatimize.mjs path/to/base.docx');
  process.exit(2);
}
if (!existsSync(inputPath)) {
  console.error(`Not found: ${inputPath}`);
  process.exit(2);
}

const baseBytes = readFileSync(inputPath);
const baseZip = await JSZip.loadAsync(baseBytes);
const outDir = dirname(inputPath);
const baseStem = basename(inputPath, extname(inputPath));

const SETTINGS_PART = 'word/settings.xml';
const CONTENT_TYPES_PART = '[Content_Types].xml';
const DOCUMENT_RELS_PART = 'word/_rels/document.xml.rels';

const SETTINGS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
const SETTINGS_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';

/** Build a complete word/settings.xml from a docVars map. */
function buildSettingsXml(docVars) {
  const docVarLines = Object.entries(docVars)
    .map(([name, val]) => `    <w:docVar w:name="${name}" w:val="${val}"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docVars>
${docVarLines}
  </w:docVars>
</w:settings>
`;
}

/** Inject a single Override into [Content_Types].xml if not present. */
function injectContentType(xml, partName, contentType) {
  if (xml.includes(`PartName="${partName}"`)) return xml;
  const override = `<Override PartName="${partName}" ContentType="${contentType}"/>`;
  return xml.replace('</Types>', `${override}</Types>`);
}

/** Inject a relationship into document.xml.rels if not present. */
function injectRelationship(xml, type, target) {
  if (xml.includes(`Target="${target}"`)) return xml;
  // Pick a fresh rId — scan existing IDs and use one past the max.
  const ids = [...xml.matchAll(/Id="rId(\d+)"/g)].map((m) => parseInt(m[1], 10));
  const next = (ids.length === 0 ? 0 : Math.max(...ids)) + 1;
  const rel = `<Relationship Id="rId${next}" Type="${type}" Target="${target}"/>`;
  return xml.replace('</Relationships>', `${rel}</Relationships>`);
}

/** Produce a variant: clone the base zip, write a new settings.xml,
 *  and ensure the content-type + relationship are declared. */
async function makeVariant(label, docVars) {
  const zip = await JSZip.loadAsync(baseBytes);
  zip.file(SETTINGS_PART, buildSettingsXml(docVars));

  const ct = await zip.file(CONTENT_TYPES_PART).async('string');
  zip.file(
    CONTENT_TYPES_PART,
    injectContentType(ct, `/${SETTINGS_PART}`, SETTINGS_CONTENT_TYPE),
  );

  const rels = await zip.file(DOCUMENT_RELS_PART).async('string');
  zip.file(
    DOCUMENT_RELS_PART,
    injectRelationship(rels, SETTINGS_REL_TYPE, 'settings.xml'),
  );

  // `compression: 'DEFLATE'` is required — JSZip defaults to STORE
  // (no compression) on generateAsync, so re-serializing a docx
  // round-trips a ~2 MB original up to ~20 MB. The standard docx
  // format uses DEFLATE on every part; match that.
  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const outPath = join(outDir, `${baseStem}.${label}.docx`);
  writeFileSync(outPath, out);
  return outPath;
}

// Variant 1: control (untouched copy, renamed for clarity).
const v1 = join(outDir, `${baseStem}.v1-control.docx`);
writeFileSync(v1, baseBytes);

// Variants 2-5.
const variants = [
  { label: 'v2-version-match', vars: { VerbatimVersion: '6.0.0' } },
  { label: 'v3-version-lower', vars: { VerbatimVersion: '1.0' } },
  { label: 'v4-version-sentinel', vars: { VerbatimVersion: 'cardmirror' } },
  {
    label: 'v5-full-docvar-set',
    vars: {
      OS: 'Windows NT',
      OSVersion: '10.0',
      VerbatimVersion: '6.0.0',
      WordVersion: '16.0',
      Profile: '',
    },
  },
];

console.log(`Wrote: ${v1}`);
for (const v of variants) {
  const out = await makeVariant(v.label, v.vars);
  console.log(`Wrote: ${out}`);
}

console.log(`
Done. Open each variant in Word (with Verbatim installed) and note
whether the Debate ribbon activates for that document.`);
