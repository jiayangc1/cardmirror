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

/** Build settings.xml with `<w:attachedTemplate>`. The
 *  relationship for the template MUST live in
 *  word/_rels/settings.xml.rels — NOT document.xml.rels — because
 *  the `<w:attachedTemplate>` element lives in the settings part
 *  and its r:id resolves against the settings part's own rels
 *  file. This was the bug in v6/v7. */
function buildSettingsWithAttachedTemplate(attachedTemplateRelId) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:attachedTemplate r:id="${attachedTemplateRelId}"/>
</w:settings>
`;
}

/** Build the settings part's own rels file with the
 *  attachedTemplate relationship. `TargetMode="External"` tells
 *  Word the Target is a file-system path. The Target can be:
 *   - a bare filename ("Debate.dotm") — Word resolves via its
 *     template search path
 *   - a full path ("file:///C:\\Users\\...\\Debate.dotm") — used
 *     by Verbatim's own Verbatimize macro
 *   - a URI ("file:///path") — both forms accepted */
function buildSettingsRels(attachedTemplateRelId, target) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${attachedTemplateRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="${target}" TargetMode="External"/></Relationships>
`;
}

async function makeTemplateVariant(label, templatePath) {
  const zip = await JSZip.loadAsync(baseBytes);
  const relId = 'rId1';
  zip.file(SETTINGS_PART, buildSettingsWithAttachedTemplate(relId));
  zip.file('word/_rels/settings.xml.rels', buildSettingsRels(relId, templatePath));

  // [Content_Types].xml override for the new settings part.
  const ct = await zip.file(CONTENT_TYPES_PART).async('string');
  zip.file(
    CONTENT_TYPES_PART,
    injectContentType(ct, `/${SETTINGS_PART}`, SETTINGS_CONTENT_TYPE),
  );

  // Relationship in document.xml.rels pointing at settings.xml
  // (separate from the attached-template rel above — this one is
  // the document → settings.xml link, the other is the settings
  // → template link).
  const docRels = await zip.file(DOCUMENT_RELS_PART).async('string');
  zip.file(
    DOCUMENT_RELS_PART,
    injectRelationship(docRels, SETTINGS_REL_TYPE, 'settings.xml'),
  );

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
console.log(`Wrote: ${v1}`);

// Variants 8 and 9 — attached-template variants with the rel in
// the correct place (word/_rels/settings.xml.rels, not
// document.xml.rels — bug in the v6/v7 attempt). v8 uses the
// bare filename so Word's template-search-path resolution can
// find Debate.dotm; v9 uses the full Windows path the
// Verbatimize macro itself wrote.
//
// (v2-v5 docVar-only variants and v6/v7 wrong-rel-file variants
// from earlier runs of this script are dropped — confirmed not
// the recognition trigger by the first experiment, and the
// gold-truth diff against a Verbatimize'd doc showed neither
// VerbatimVersion nor any docVar is set when Verbatim
// recognizes a doc.)
const templateVariants = [
  {
    label: 'v8-template-bare-filename',
    path: 'Debate.dotm',
  },
  {
    label: 'v9-template-full-path',
    path: 'file:///C:\\Users\\anthonytrufanov\\AppData\\Roaming\\Microsoft\\Templates\\Debate.dotm',
  },
  // Generic-path probes: confirmed v9 (a known-fake path on
  // installs other than the author's) activated the ribbon on
  // multiple machines, so Word isn't validating that the file
  // exists at the stored Target. The recognition check
  // `AttachedTemplate.Name = "Debate.dotm"` is reading the
  // basename of the URI as stored. These three test that
  // hypothesis with ever-more-generic Target shapes — the
  // simplest one that works is what we ship.
  {
    label: 'v10-template-uri-no-path',
    path: 'file:///Debate.dotm',
  },
  {
    label: 'v11-template-uri-fake-unix-path',
    path: 'file:///templates/Debate.dotm',
  },
  {
    label: 'v12-template-uri-fake-windows-path',
    path: 'file:///C:\\Debate.dotm',
  },
];

for (const v of templateVariants) {
  const out = await makeTemplateVariant(v.label, v.path);
  console.log(`Wrote: ${out}`);
}

console.log(`
Done. Open the variants in Word (Verbatim installed) and note
which ones activate the Debate ribbon.

  v8 — bare filename (failed previously, kept as reference)
  v9 — author's hardcoded full Windows path (known-good)
  v10 — file:///Debate.dotm (URI, no path)
  v11 — file:///templates/Debate.dotm (URI, fake Unix-style path)
  v12 — file:///C:\\Debate.dotm (URI, fake minimal Windows path)

If v10 / v11 / v12 activate, we ship the simplest of them as
the canonical Target — recognition is just basename-of-URI.`);
