/**
 * OOXML → schema importer.
 *
 * Reads `word/document.xml` (and rels for hyperlinks) and produces a
 * ProseMirror doc.
 *
 * Strategy:
 *   1. Parse document.xml with order preservation.
 *   2. Walk <w:body>'s children.
 *   3. For each paragraph: extract pStyle, walk runs (and hyperlinks),
 *      collect text + marks per run, classify the paragraph by pStyle.
 *   4. Group consecutive paragraphs into cards: a Tag-styled paragraph
 *      starts a card; following Normal-styled paragraphs (until the next
 *      heading-level paragraph) become its body.
 *   5. Wrap everything in a `doc` node.
 *
 * Per ARCHITECTURE.md §3 (round-trip contract / fungibility), aggressive
 * normalization on import is fine — we preserve only what Verbatim and
 * Advanced Verbatim treat as semantic.
 */

import type { Mark, Node as PMNode, NodeType } from 'prosemirror-model';
import { schema } from '../schema/index.js';
import { idFromBookmarkName, newHeadingId } from '../schema/ids.js';
import {
  attrs as attrsOf,
  children as childrenOf,
  findChild,
  parseXml,
  textContent,
  type XmlNode,
} from '../ooxml/parse.js';
import {
  PSTYLE_TO_NODE,
  RSTYLE_TO_MARK,
} from '../ooxml/styles.js';

interface ParaInfo {
  /** Schema node type to use for this paragraph (resolved from pStyle). */
  nodeType: string;
  /** Parsed inline content (text nodes + marks). */
  inlines: PMNode[];
  /** Heading id if pmd-heading-* bookmark detected. */
  headingId: string | null;
  /** Original pStyle, for diagnostics. */
  pStyle: string | null;
}

/** rId → URL map from word/_rels/document.xml.rels. */
type RelMap = Record<string, string>;

interface ImportContext {
  rels: RelMap;
  /** Track active hyperlink rId stack while walking inline content. */
  hyperlinkStack: string[];
  /**
   * Marks from the paragraph's default `<w:pPr><w:rPr>` that runs inherit
   * unless they specify a conflicting property. Real docs use this for
   * mass highlighting on tags (per NOTES-verbatim.md §6).
   */
  paragraphDefaultMarks: Mark[];
}

/** Public entry: parse document.xml + rels into a schema doc. */
export function importDoc(documentXml: string, relsXml: string | null = null): PMNode {
  const rels = relsXml ? parseRels(relsXml) : {};
  const ctx: ImportContext = { rels, hyperlinkStack: [], paragraphDefaultMarks: [] };

  const root = parseXml(documentXml);
  const docEl = findChild(root, 'w:document');
  if (!docEl) throw new Error('Missing <w:document> root');

  const body = findChild(childrenOf(docEl, 'w:document'), 'w:body');
  if (!body) throw new Error('Missing <w:body>');

  const bodyChildren = childrenOf(body, 'w:body');
  const paragraphs: ParaInfo[] = [];
  for (const node of bodyChildren) {
    if ('w:p' in node) {
      paragraphs.push(parseParagraph(node, ctx));
    }
    // <w:sectPr>, <w:tbl>, etc. — skip for v0.
  }

  return assembleDoc(paragraphs);
}

function parseRels(relsXml: string): RelMap {
  const root = parseXml(relsXml);
  const relsEl = findChild(root, 'Relationships');
  if (!relsEl) return {};
  const map: RelMap = {};
  for (const rel of childrenOf(relsEl, 'Relationships')) {
    if (!('Relationship' in rel)) continue;
    const a = attrsOf(rel);
    const id = a['Id'];
    const target = a['Target'];
    if (id && target) map[id] = target;
  }
  return map;
}

function parseParagraph(pNode: XmlNode, ctx: ImportContext): ParaInfo {
  const pChildren = childrenOf(pNode, 'w:p');

  // Look for <w:pPr>/<w:pStyle> for the paragraph style.
  const pPr = findChild(pChildren, 'w:pPr');
  let pStyle: string | null = null;
  let defaultRPrMarks: Mark[] = [];
  if (pPr) {
    const pPrChildren = childrenOf(pPr, 'w:pPr');
    const pStyleEl = findChild(pPrChildren, 'w:pStyle');
    if (pStyleEl) {
      pStyle = attrsOf(pStyleEl)['w:val'] ?? null;
    }
    // Paragraph-default run properties: runs inherit these unless they
    // explicitly override. Real docs use this for mass-highlighted Tags.
    const defaultRPr = findChild(pPrChildren, 'w:rPr');
    if (defaultRPr) {
      defaultRPrMarks = parseMarks(defaultRPr);
    }
  }

  // Heading id from pmd-heading-* bookmark (if present).
  let headingId: string | null = null;
  for (const c of pChildren) {
    if ('w:bookmarkStart' in c) {
      const name = attrsOf(c)['w:name'];
      if (name) {
        const id = idFromBookmarkName(name);
        if (id) {
          headingId = id;
          break;
        }
      }
    }
  }

  // Walk inline content: <w:r>, <w:hyperlink>, etc., with paragraph-default
  // marks merged into runs.
  const prevDefaults = ctx.paragraphDefaultMarks;
  ctx.paragraphDefaultMarks = defaultRPrMarks;
  const inlines: PMNode[] = [];
  for (const c of pChildren) {
    collectInlines(c, ctx, inlines);
  }
  ctx.paragraphDefaultMarks = prevDefaults;

  const nodeType = resolveNodeType(pStyle, inlines);

  return { nodeType, inlines, headingId, pStyle };
}

function collectInlines(node: XmlNode, ctx: ImportContext, out: PMNode[]): void {
  if ('w:r' in node) {
    parseRun(node, ctx, out);
  } else if ('w:hyperlink' in node) {
    const a = attrsOf(node);
    const rId = a['r:id'] ?? a['rId'] ?? '';
    if (rId) ctx.hyperlinkStack.push(rId);
    for (const c of childrenOf(node, 'w:hyperlink')) {
      collectInlines(c, ctx, out);
    }
    if (rId) ctx.hyperlinkStack.pop();
  }
  // Other inline-ish nodes (w:bookmarkStart, w:bookmarkEnd, etc.) — skip.
}

function parseRun(rNode: XmlNode, ctx: ImportContext, out: PMNode[]): void {
  const rChildren = childrenOf(rNode, 'w:r');
  const rPrEl = findChild(rChildren, 'w:rPr');
  const parsed: ParsedRPr = rPrEl
    ? parseRPr(rPrEl)
    : { marks: [], disabled: new Set(), clearedRStyle: false };

  // Merge paragraph-default rPr marks: defaults come first, run-specific
  // marks override conflicts; named-style marks share an OOXML rStyle
  // slot; explicit disables in the run remove the type from defaults.
  const marks = mergeMarks(ctx.paragraphDefaultMarks, parsed);

  // Apply hyperlink mark from active stack.
  if (ctx.hyperlinkStack.length > 0) {
    const top = ctx.hyperlinkStack[ctx.hyperlinkStack.length - 1]!;
    const href = ctx.rels[top];
    if (href) {
      marks.push(schema.marks['link']!.create({ href }));
    }
  }

  // Collect text from <w:t> children (and <w:tab>, <w:br> if needed).
  for (const c of rChildren) {
    if ('w:t' in c) {
      const text = textContent(c);
      if (text.length > 0) {
        try {
          out.push(schema.text(text, marks));
        } catch (_) {
          // Empty text or invalid characters; skip.
        }
      }
    } else if ('w:tab' in c) {
      try {
        out.push(schema.text('\t', marks));
      } catch (_) { /* ignore */ }
    }
    // <w:br/> with type=page is a hard page break; for now just newline.
    // <w:br/> without type is line break.
    else if ('w:br' in c) {
      try {
        out.push(schema.text('\n', marks));
      } catch (_) { /* ignore */ }
    }
  }
}

/** Named-style marks (correspond to OOXML w:rStyle — only one per run). */
const NAMED_STYLE_MARKS = new Set([
  'cite_mark',
  'underline_mark',
  'emphasis_mark',
  'undertag_mark',
  'analytic_mark',
]);

interface ParsedRPr {
  marks: Mark[];
  /**
   * Mark types the rPr explicitly disables (e.g., <w:b w:val="0"/>).
   * When this rPr is being merged with paragraph-default marks, types
   * in this set are excluded from the inherited defaults.
   */
  disabled: Set<string>;
  /**
   * Whether this rPr explicitly clears the rStyle slot (`<w:rStyle w:val=""/>`).
   * Rare, but a run can in principle override a paragraph-default named-style
   * by providing an empty rStyle.
   */
  clearedRStyle: boolean;
}

/**
 * Merge paragraph-default marks with run-specific parsed rPr.
 * Run wins on type conflicts; explicit disables in the run remove the
 * type from inherited defaults; named-style marks share a single slot.
 */
function mergeMarks(defaults: Mark[], run: ParsedRPr): Mark[] {
  const runTypeNames = new Set(run.marks.map((m) => m.type.name));
  const runHasNamedStyle = run.marks.some((m) => NAMED_STYLE_MARKS.has(m.type.name)) || run.clearedRStyle;

  const inherited = defaults.filter((m) => {
    if (runTypeNames.has(m.type.name)) return false;
    if (run.disabled.has(m.type.name)) return false;
    if (runHasNamedStyle && NAMED_STYLE_MARKS.has(m.type.name)) return false;
    return true;
  });

  return [...inherited, ...run.marks];
}

function parseRPr(rPr: XmlNode): ParsedRPr {
  const marks: Mark[] = [];
  const disabled = new Set<string>();
  let clearedRStyle = false;
  const props = childrenOf(rPr, 'w:rPr');

  for (const prop of props) {
    const tag = Object.keys(prop).find((k) => k !== ':@');
    if (!tag) continue;
    const a = attrsOf(prop);

    switch (tag) {
      case 'w:rStyle': {
        const styleId = a['w:val'];
        if (!styleId) {
          clearedRStyle = true;
        } else if (styleId in RSTYLE_TO_MARK) {
          const markName = RSTYLE_TO_MARK[styleId]!;
          marks.push(schema.marks[markName]!.create());
        }
        // Unknown rStyles are dropped (stylepox cleanup).
        break;
      }
      case 'w:b': {
        if (a['w:val'] === '0' || a['w:val'] === 'false') {
          disabled.add('bold');
        } else {
          marks.push(schema.marks['bold']!.create());
        }
        break;
      }
      case 'w:i': {
        if (a['w:val'] === '0' || a['w:val'] === 'false') {
          disabled.add('italic');
        } else {
          marks.push(schema.marks['italic']!.create());
        }
        break;
      }
      case 'w:u': {
        const val = a['w:val'];
        if (val === 'none' || val === '0') {
          disabled.add('underline_mark');
        } else if (val) {
          if (!marks.some((m) => m.type.name === 'underline_mark')) {
            marks.push(schema.marks['underline_mark']!.create());
          }
        }
        break;
      }
      case 'w:color': {
        const c = a['w:val'];
        if (c && /^[0-9a-fA-F]{6}$/.test(c)) {
          marks.push(schema.marks['font_color']!.create({ color: c }));
        }
        break;
      }
      case 'w:sz': {
        const v = a['w:val'];
        const hp = v ? parseInt(v, 10) : NaN;
        if (Number.isFinite(hp) && hp > 0) {
          marks.push(schema.marks['font_size']!.create({ halfPoints: hp }));
        }
        break;
      }
      case 'w:highlight': {
        const c = a['w:val'];
        if (!c || c === 'none') {
          disabled.add('highlight');
        } else {
          marks.push(schema.marks['highlight']!.create({ color: c }));
        }
        break;
      }
      case 'w:shd': {
        const c = a['w:fill'];
        if (c && /^[0-9a-fA-F]{6}$/.test(c) && c.toLowerCase() !== 'auto') {
          marks.push(schema.marks['shading']!.create({ color: c }));
        }
        break;
      }
      // Other rPr props (rFonts, lang, vertAlign, etc.) — drop.
    }
  }

  return { marks, disabled, clearedRStyle };
}

/** Convenience: just the marks, no disable info. Used where merging isn't needed. */
function parseMarks(rPr: XmlNode): Mark[] {
  return parseRPr(rPr).marks;
}

function resolveNodeType(pStyle: string | null, _inlines: PMNode[]): string {
  if (pStyle && pStyle in PSTYLE_TO_NODE) {
    return PSTYLE_TO_NODE[pStyle]!;
  }
  // No pStyle (or unknown) → treat as plain Normal paragraph.
  // The card-grouping pass below will reclassify Normals after a Tag
  // into card_body / cite_paragraph as appropriate.
  return 'paragraph';
}

/**
 * Card-grouping pass.
 *
 * Walks the flat paragraph list and groups Tag-rooted sequences into
 * card nodes. Other paragraphs become flat siblings.
 *
 * Conventions:
 *   - A Tag starts a card.
 *   - The card consumes:
 *     - Optionally one cite_paragraph (heuristic: first Normal after a
 *       Tag is treated as cite_paragraph for v0 always; cleaner heuristic
 *       can replace this later).
 *     - Zero or more card_body paragraphs (subsequent Normals).
 *     - An in-card `analytic` (if it appears between tag and body).
 *   - The card ends at the next heading-level paragraph (Tag, Pocket,
 *     Hat, Block, Analytic, Undertag) or end of document.
 *
 * This mirrors the way real Verbatim docs are structured — the card
 * boundary is implicit in the paragraph sequence; we promote it to a
 * schema node for editor-side ergonomics.
 */
function assembleDoc(paragraphs: ParaInfo[]): PMNode {
  const docNodes: PMNode[] = [];
  let i = 0;
  while (i < paragraphs.length) {
    const para = paragraphs[i]!;

    if (para.nodeType === 'tag') {
      // Start a card: consume tag + (optional cite_paragraph) + body*
      const tagNode = schema.nodes['tag']!.create(
        attrsForHeading(para.headingId),
        para.inlines,
      );
      const cardChildren: PMNode[] = [tagNode];
      let j = i + 1;

      // Optional cite_paragraph: first Normal-shaped paragraph after Tag
      // is classified as cite for v0. Skip if next paragraph is a
      // heading-level node.
      if (j < paragraphs.length) {
        const next = paragraphs[j]!;
        if (next.nodeType === 'paragraph') {
          // Reclassify as cite_paragraph for v0 import.
          cardChildren.push(
            schema.nodes['cite_paragraph']!.create(null, next.inlines),
          );
          j++;
        } else if (next.nodeType === 'analytic') {
          // In-card analytic immediately after tag.
          cardChildren.push(
            schema.nodes['analytic']!.create(
              attrsForHeading(next.headingId),
              next.inlines,
            ),
          );
          j++;
        }
      }

      // Body paragraphs: continue while we see Normal paragraphs.
      while (j < paragraphs.length && paragraphs[j]!.nodeType === 'paragraph') {
        cardChildren.push(
          schema.nodes['card_body']!.create(null, paragraphs[j]!.inlines),
        );
        j++;
      }

      // Construct the card.
      try {
        const cardNode = schema.nodes['card']!.createChecked(null, cardChildren);
        docNodes.push(cardNode);
      } catch (_e) {
        // Schema rejected the card construction — fall back to scratchpad.
        // Should be rare since our content expression is permissive.
        const scratch = schema.nodes['scratchpad']!.createChecked(
          null,
          cardChildren.map((n) => coerceToScratchpadChild(n)),
        );
        docNodes.push(scratch);
      }
      i = j;
    } else {
      // Standalone paragraph kind.
      const node = paragraphToNode(para);
      if (node) docNodes.push(node);
      i++;
    }
  }

  // Wrap in doc node. If schema rejects (which would be surprising given
  // our permissive content expression), fall back to a single scratchpad.
  try {
    return schema.nodes['doc']!.createChecked(null, docNodes);
  } catch (_e) {
    const scratch = schema.nodes['scratchpad']!.createChecked(
      null,
      docNodes.map((n) => coerceToScratchpadChild(n)),
    );
    return schema.nodes['doc']!.createChecked(null, [scratch]);
  }
}

function attrsForHeading(id: string | null): { id: string } {
  return { id: id ?? newHeadingId() };
}

function paragraphToNode(para: ParaInfo): PMNode | null {
  const t = para.nodeType;
  const nodeType = schema.nodes[t] as NodeType | undefined;
  if (!nodeType) return null;
  const isHeading = ['pocket', 'hat', 'block', 'analytic'].includes(t);
  const attrs = isHeading ? attrsForHeading(para.headingId) : null;
  try {
    return nodeType.createChecked(attrs, para.inlines);
  } catch (_e) {
    return null;
  }
}

function coerceToScratchpadChild(node: PMNode): PMNode {
  // If it's already valid in scratchpad's content expression, return as-is.
  // Tags can't appear at scratchpad-level; wrap in a card if so.
  if (node.type.name === 'tag') {
    return schema.nodes['card']!.createChecked(null, [node]);
  }
  return node;
}
