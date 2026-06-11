/**
 * Card-cutter PORT — the only place the app talks to the experimental
 * card-cutting engine. The engine itself lives in the separately-
 * versioned `@cardmirror/card-cutter` package and is NOT bundled. It
 * registers with us at runtime via `window.__registerCardCutter`; if
 * nothing registers (package absent), the feature stays inert.
 *
 * Responsibilities, all app-side:
 *  - hold whatever engine registered (registry),
 *  - inject an LlmCaller wrapping the app's browser-direct callAnthropic,
 *  - extract tag / cite / body text from the focused card,
 *  - translate the engine's returned mark spans into ONE ProseMirror
 *    transaction (underline / emphasis / highlight), with the highlight
 *    color resolved per the doc/ribbon rule.
 *
 * The engine is pure (no DOM, no PM, no network of its own), so the
 * boundary is: app gives it text + an llm, it returns spans.
 */

import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../schema/index.js';
import { settings } from './settings.js';
import { callAnthropic } from './ai/anthropic.js';
import { resolveAiModel } from './ai/anthropic.js';
import { showToast } from './toast.js';

// ─── Engine contract (structural — no import of the package) ──────

type Layer = 'u' | 'em' | 'hl';
interface MarkSpan {
  layer: Layer;
  p: number;
  start: number;
  end: number;
}
interface PlainCard {
  id: string;
  doc: string;
  section: string;
  tag: string;
  cite: string;
  paras: string[];
}
interface CutOptions {
  targetWords: number;
  emphasisStyle: 'voice' | 'independent' | 'minimal';
  role: 'shell' | 'block' | 'at' | 'ext' | 'impact';
  underlineGenerosity?: 'lean' | 'standard' | 'generous';
  model?: string;
  terminalImpact?: boolean;
}
interface CutResult {
  spans: MarkSpan[];
  stats: unknown;
  warnings: string[];
  raw: unknown;
}
type LlmCaller = (system: string, user: string, model: string) => Promise<string>;
export interface CutProposal {
  label: string;
  detail: string;
  readTimeSec: number;
  role: CutOptions['role'];
}
interface CardCutterApi {
  readonly version: string;
  cutCard(card: PlainCard, opts: CutOptions, llm: LlmCaller): Promise<CutResult>;
  highlightCard(
    card: PlainCard,
    seed: MarkSpan[],
    opts: CutOptions,
    llm: LlmCaller,
  ): Promise<CutResult>;
  proposeCuts(
    card: PlainCard,
    baseReadTimeSec: number,
    mode: 'when-ambiguous' | 'always',
    llm: LlmCaller,
    model?: string,
  ): Promise<CutProposal[] | null>;
  detectTerminalImpact(tag: string): boolean;
}

declare global {
  interface Window {
    __registerCardCutter?: (api: CardCutterApi) => void;
    /** Console entry point (see card-cutter-gate.ts). */
    __cardcutter?: (cmd: 'on' | 'off' | 'status') => string;
  }
}

let engine: CardCutterApi | null = null;

/** The engine package calls this on load (dev-only). Installed once. */
export function installCardCutterRegistry(): void {
  window.__registerCardCutter = (api) => {
    engine = api;
    console.log(`[cardcutter] engine registered (v${api.version})`);
  };
}

export function cardCutterEngineLoaded(): boolean {
  return engine !== null;
}

/** Dev convenience: pull the sibling package in so it can register.
 *  `@vite-ignore` keeps the bundler from resolving the specifier at
 *  build time, so production (where the sibling isn't present) builds
 *  fine and the import simply throws at runtime → caught, feature
 *  stays inert. The `@cardcutter` alias resolves only in dev. */
export async function tryLoadCardCutterEngine(): Promise<boolean> {
  if (engine) return true;
  try {
    // Resolved by the vite `@cardcutter/browser` alias: the sibling
    // package in dev, or the in-repo no-op stub when it's absent.
    // Side-effect import only — registration happens via the global.
    await import('@cardcutter/browser');
  } catch (err) {
    console.warn('[cardcutter] engine not available:', (err as Error).message);
  }
  return engine !== null;
}

// ─── LLM injection ────────────────────────────────────────────────

function makeLlm(): LlmCaller {
  return async (system, user, model) => {
    const reply = await callAnthropic({
      apiKey: settings.get('anthropicApiKey').trim(),
      model,
      system,
      maxTokens: 8000,
      temperature: model.includes('opus') ? undefined : 0,
      messages: [{ role: 'user', content: user }],
    });
    if (reply.stopReason === 'max_tokens') throw new Error('truncated at max_tokens');
    return reply.text;
  };
}

// ─── Card extraction from the editor ──────────────────────────────

interface FocusedCard {
  card: PlainCard;
  cardFrom: number;
  /** Doc positions of each body paragraph's content start (= text
   *  offset 0), parallel to card.paras, for span → doc-pos mapping. */
  paraStarts: number[];
  /** The card body's EXISTING marks as engine-shaped spans (char
   *  ranges per body paragraph). Lets the port tell a plain card
   *  (full cut) from an underlined one (highlight only). */
  existing: MarkSpan[];
}

/** Whether the card already has any underline/emphasis, and any
 *  highlight — drives cut vs highlight vs done routing. */
function cardState(f: FocusedCard): { hasUnderline: boolean; hasHighlight: boolean } {
  let hasUnderline = false;
  let hasHighlight = false;
  for (const s of f.existing) {
    if (s.layer === 'hl') hasHighlight = true;
    else hasUnderline = true;
  }
  return { hasUnderline, hasHighlight };
}

/** Find the card containing the cursor and pull its tag / cite / plain
 *  body text. Returns null if the cursor isn't in a card or the body
 *  is empty. */
export function focusedPlainCard(view: EditorView): FocusedCard | null {
  const { $from } = view.state.selection;
  let cardPos = -1;
  let cardNode: PMNode | null = null;
  for (let d = $from.depth; d >= 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'card' || n.type.name === 'analytic_unit') {
      cardPos = $from.before(d);
      cardNode = n;
      break;
    }
  }
  if (!cardNode || cardPos < 0) return null;

  let tag = '';
  let cite = '';
  const paras: string[] = [];
  const paraStarts: number[] = [];
  const existing: MarkSpan[] = [];
  cardNode.forEach((child, offset) => {
    const t = child.type.name;
    const childPos = cardPos + 1 + offset; // position of child node
    if (t === 'tag' || t === 'analytic') {
      tag += child.textContent;
    } else if (t === 'cite_paragraph') {
      cite += (cite ? '\n' : '') + child.textContent;
    } else if (child.isTextblock) {
      const p = paras.length;
      // Read existing body marks into char-range spans, tracking the
      // text offset as we walk the inline runs.
      let textOff = 0;
      child.forEach((inline) => {
        if (!inline.isText || !inline.text) return;
        const start = textOff;
        const end = textOff + inline.text.length;
        for (const m of inline.marks) {
          const name = m.type.name;
          if (name === 'underline_mark' || name === 'underline_direct')
            existing.push({ layer: 'u', p, start, end });
          else if (name === 'emphasis_mark') existing.push({ layer: 'em', p, start, end });
          else if (name === 'highlight') existing.push({ layer: 'hl', p, start, end });
        }
        textOff = end;
      });
      paras.push(child.textContent);
      paraStarts.push(childPos + 1); // +1 into the textblock's content
    }
  });
  if (paras.length === 0) return null;

  return {
    card: {
      id: 'live',
      doc: '',
      section: '',
      tag: tag.trim(),
      cite: cite.trim(),
      paras,
    },
    cardFrom: cardPos,
    paraStarts,
    existing,
  };
}

// ─── Highlight color resolution (doc convention, else ribbon) ─────

/** If every highlighted run in the document uses the same color, that
 *  is the doc convention; if the doc mixes colors or has none, fall
 *  back to the ribbon-selected highlight color. */
function resolveHighlightColor(view: EditorView): string {
  const seen = new Set<string>();
  view.state.doc.descendants((node) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name === 'highlight') seen.add(String(m.attrs['color'] ?? 'yellow'));
    }
    return true;
  });
  if (seen.size === 1) return [...seen][0]!;
  return settings.get('lastHighlightColor') || 'yellow';
}

// ─── Apply: MarkSpan[] → one transaction ──────────────────────────

const LAYER_MARK: Record<Layer, string> = {
  u: 'underline_mark',
  em: 'emphasis_mark',
  hl: 'highlight',
};

export function applyCutToCard(
  view: EditorView,
  focused: FocusedCard,
  spans: MarkSpan[],
  layers?: Layer[],
): void {
  const tr = view.state.tr;
  const color = resolveHighlightColor(view);
  for (const s of spans) {
    if (layers && !layers.includes(s.layer)) continue;
    const base = focused.paraStarts[s.p];
    if (base === undefined) continue;
    const from = base + s.start;
    const to = base + s.end;
    if (to <= from) continue;
    const markName = LAYER_MARK[s.layer];
    const type = schema.marks[markName];
    if (!type) continue;
    tr.addMark(from, to, s.layer === 'hl' ? type.create({ color }) : type.create());
  }
  if (!tr.docChanged && tr.steps.length === 0) return;
  // Park the selection at the top of the card so the result is visible.
  tr.setSelection(TextSelection.create(tr.doc, focused.cardFrom + 1));
  view.dispatch(tr.scrollIntoView());
}

// ─── The one public entry the command layer calls ─────────────────

export interface CutInvocation {
  role: CutOptions['role'];
  /** Read-time seconds; words derived from the reader WPM. */
  readTimeSec: number;
}

export async function cutFocusedCard(view: EditorView, inv: CutInvocation): Promise<void> {
  if (!engine) {
    const ok = await tryLoadCardCutterEngine();
    if (!ok) {
      showToast('Card-cutter engine not loaded.');
      return;
    }
  }
  const api = engine!;
  if (!settings.get('anthropicApiKey').trim()) {
    showToast('Set an Anthropic API key in Settings to use the card cutter.');
    return;
  }
  const focused = focusedPlainCard(view);
  if (!focused) {
    showToast('Put the cursor in a card with body text first.');
    return;
  }
  const { hasUnderline, hasHighlight } = cardState(focused);
  // Already highlighted → done; don't clobber a finished cut. (A
  // future Highlight Down command shrinks it.)
  if (hasHighlight) {
    showToast('This card is already highlighted.');
    return;
  }
  const opts: CutOptions = {
    targetWords: Math.max(15, Math.round((inv.readTimeSec * readerWpm()) / 60)),
    emphasisStyle: settings.get('cardCutterEmphasisStyle'),
    role: inv.role,
    model: resolveAiModel(),
    terminalImpact: api.detectTerminalImpact(focused.card.tag),
  };
  const llm = makeLlm();
  try {
    // Underlined-but-not-highlighted → Highlight Card (trust the
    // existing underlines, add only highlights). Plain → full Cut.
    if (hasUnderline) {
      showToast('Highlighting card…');
      const result = await api.highlightCard(focused.card, focused.existing, opts, llm);
      applyCutToCard(view, focused, result.spans, ['hl']);
      for (const w of result.warnings) console.log(`[cardcutter] ${w}`);
      showToast('Card highlighted — ↶ to undo');
    } else {
      showToast('Cutting card…');
      const result = await api.cutCard(focused.card, opts, llm);
      applyCutToCard(view, focused, result.spans);
      for (const w of result.warnings) console.log(`[cardcutter] ${w}`);
      showToast('Card cut — ↶ to undo');
    }
  } catch (err) {
    console.error('[cardcutter] cut failed:', err);
    showToast(`Card cut failed: ${(err as Error).message}`);
  }
}

/** First reader's WPM, or a sane default. */
function readerWpm(): number {
  const readers = settings.get('readers');
  return readers[0]?.wpm && readers[0].wpm > 0 ? readers[0].wpm : 350;
}

/** Whether the cursor is in a cuttable card, and its mark state — for
 *  the launch sheet to label cut vs highlight vs already-done. */
export function focusedCardStatus(
  view: EditorView,
): { cuttable: boolean; hasUnderline: boolean; hasHighlight: boolean } {
  const f = focusedPlainCard(view);
  if (!f) return { cuttable: false, hasUnderline: false, hasHighlight: false };
  return { cuttable: true, ...cardState(f) };
}

/** Pass 0 (describe-then-generate): ask the engine whether the focused
 *  card cuts multiple ways, returning the option descriptions or null.
 *  Returns null on any failure (caller proceeds without a question). */
export async function proposeFocusedCuts(
  view: EditorView,
  baseReadTimeSec: number,
  mode: 'when-ambiguous' | 'always',
): Promise<CutProposal[] | null> {
  if (!engine) return null;
  const f = focusedPlainCard(view);
  if (!f) return null;
  try {
    return await engine.proposeCuts(f.card, baseReadTimeSec, mode, makeLlm(), resolveAiModel());
  } catch (err) {
    console.warn('[cardcutter] proposeCuts failed:', (err as Error).message);
    return null;
  }
}

export async function ensureEngine(): Promise<boolean> {
  if (engine) return true;
  return tryLoadCardCutterEngine();
}
