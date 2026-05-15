/**
 * AI cite creator.
 *
 * User selects raw citation info (URL, byline, abstract, article
 * chunk — whatever they have). On invocation we send the selection
 * + today's date + the configurable system prompt to Anthropic.
 * The model returns JSON shaped like:
 *
 *   { "cite": "<formatted debate-style cite>",
 *     "tokens": ["Smith 24", ...] }
 *
 * We replace the user's selection with the cite text and apply the
 * named-style `cite_mark` to every substring listed in `tokens` —
 * those are the "Lastname ShortDate" pieces that get F8 cite
 * highlighting in the editor.
 *
 * While the request is in flight, a floating tooltip pinned near
 * the selection cycles through Clod activity text (or "Thinking…"
 * when Clod mode is off).
 */

import type { EditorView } from 'prosemirror-view';
import { schema } from '../../schema/index.js';
import { settings } from '../settings.js';
import { callAnthropic, AnthropicError } from './anthropic.js';
import { ThinkingTooltip } from './thinking-tooltip.js';
import { showToast } from '../toast.js';

/** Today's-date placeholder substituted into the prompt at run
 *  time. Putting it in the prompt rather than the user message
 *  keeps the user message tightly scoped to the raw citation
 *  text. */
const DATE_PLACEHOLDER = '{DATE}';

// Default prompt — ported verbatim from the user's prior Card
// Formatting Tools utility (cite-formatter prompt in
// reference-docs/Card Formatting Tools.py), with the JSON-wrapper
// instructions appended at the bottom. The wrapper is what
// distinguishes this from the clipboard-only utility: we need a
// machine-parsable shape so the editor can apply the cite_mark
// to the right tokens.
export const DEFAULT_AI_CITE_PROMPT = `Today's date is ${DATE_PLACEHOLDER}.

You are an expert in formatting academic citations. Your task is to reformat the given citation to match the following style:

1. Author names should be in the format: FirstName LastName Date, where Date is:
   - The publication date in mm/dd format (or m/dd, or m/d, respectively, if the month or day require just one digit) for publications within the last month of the current year
   - The publication year in y format (for single-digit years) or yy format (for double-digit years) or yyyy (for years prior to 1950) for all other publications
2. For multiple authors, use '&' for two authors and 'et al.' for three or more.
3. After the author names, list their qualifications or affiliations.
4. Include the full title of the work in quotes.
5. Include publication details such as journal name, volume, issue, date (mm/dd/yyyy), and page numbers when available.
6. Include URLs or DOIs at the end of the citation when provided.
7. If the title or publication or names or qualifications are in all caps, change the capitalization so that it is appropriate for a cite.

Examples of the desired format:

(if today's date is less than a month after 9/23/24)
Adrien Rose & Christian Wilson 9/23, Rose is a research assistant in the Oxford Sustainable Finance Group, specializing in transition finance; Wilson is a DPhil student at the Smith School of Enterprise and the Environment (SSEE) and a Research Assistant in the Oxford Sustainable Finance Group, "Assessing the Credibility of Climate Transition Plans in the Oil and Gas Sector," Discussion Paper, Oxford Sustainable Finance Group, 09/23/2024, https://sustainablefinance.ox.ac.uk/wp-content/uploads/2024/09/SSEE-Discussion-Paper-Oil-Gas_final_AR.pdf

(if today's date is more than a month after 9/23/24)
Adrien Rose & Christian Wilson 24, Rose is a research assistant in the Oxford Sustainable Finance Group, specializing in transition finance; Wilson is a DPhil student at the Smith School of Enterprise and the Environment (SSEE) and a Research Assistant in the Oxford Sustainable Finance Group, "Assessing the Credibility of Climate Transition Plans in the Oil and Gas Sector," Discussion Paper, Oxford Sustainable Finance Group, 09/23/2024, https://sustainablefinance.ox.ac.uk/wp-content/uploads/2024/09/SSEE-Discussion-Paper-Oil-Gas_final_AR.pdf

(if today's date is less than a month after 9/9/24)
Keeff Felty & Grace Yarrow 9/9, Felty is President of the National Association of Wheat Growers; Yarrow is Food and Agriculture Policy Reporter at POLITICO, Author of POLITICO Pro's Morning Agriculture newsletter, University of Maryland graduate, "Ag groups hit the Hill," Politico, 9/9/24, https://www.politico.com/newsletters/weekly-agriculture/2024/09/09/ag-groups-hit-the-hill-00177896

(if today's date is more than a month after 9/9/24)
Keeff Felty & Grace Yarrow 24, Felty is President of the National Association of Wheat Growers; Yarrow is Food and Agriculture Policy Reporter at POLITICO, Author of POLITICO Pro's Morning Agriculture newsletter, University of Maryland graduate, "Ag groups hit the Hill," Politico, 9/9/24, https://www.politico.com/newsletters/weekly-agriculture/2024/09/09/ag-groups-hit-the-hill-00177896

J. D. Tuccille 23, Contributing Editor at Reason.com, former Managing Editor at Reason.com, columnist for Arizona Republic, Denver Post, and Washington Times, author of High Desert Barbecue, "It's Government Shutdown Theater, Again," Reason, 9/25/23, https://reason.com/2023/09/25/its-government-shutdown-theater-again/

Robert N. Stavins 18, A.J. Meyer Professor of Energy and Economic Development, John F. Kennedy School of Government, Harvard University; University Fellow, Resources for the Future; and Research Associate, National Bureau of Economic Research, "Environmental Economics," The New Palgrave Dictionary of Economics, edited by Garett Jones, Third edition, Palgrave Macmillan, 2018, pp. 3782–3795

Yael Parag & Sarah Darby 9, Parag is the Vice Dean of Reichman University's School of Sustainability at Reichman University (IDC); Derby is BSc DPhil, Associate Professor, Energy Programme, Environmental Change Institute, University of Oxford, "Consumer–Supplier–Government Triangular Relations: Rethinking the UK Policy Path for Carbon Emissions Reduction from the UK Residential Sector," Energy Policy, vol. 37, no. 10, 10/01/2009, pp. 3984–3992

Jie Jiang et al. 23, Jie Jiang, School of Intellectual Property at Nanjing University of Science and Technology; Qihang Zhang, School of Intellectual Property at Nanjing University of Science and Technology; Yifan Hui, School of Mathematics and Statistics at University of Glasgow, "The Impact of Market and Non-Market-Based Environmental Policy Instruments on Firms' Sustainable Technological Innovation: Evidence from Chinese Firms," Sustainability, vol. 15, no. 5, 5, Multidisciplinary Digital Publishing Institute, 01/15/2023, p. 4425

Important:
- Do not remove any information from the citation that was included in the submission.
- Do not add any information to the citation that was not included in the submission.
- If the title or publication or names or qualifications are in another language, translate them to English.

Respond using the delimited block format below — no JSON, no quoting, no escaping. Quotes inside the cite (around the title, for instance) just appear literally; the parser splits on the markers, not the punctuation.

[[CITE]]
<the full reformatted citation, exactly as you'd otherwise have returned it>
[[TOKENS]]
<one token per line>
[[END]]

The TOKENS section lists every substring that should be highlighted with the F8 cite mark. The highlighted portion is the LASTNAME(s) + SHORTDATE of the leading author block; firstnames stay unmarked.

  - One author ("Michael Townsend 25"): TOKENS = "Townsend 25"
  - Two authors ("Laura Weiss & John Bresnahan 3/26"): TOKENS = "Weiss & " then "Bresnahan 3/26" on the next line
  - Three+ authors ("Carla Norrlöf et al. 24"): TOKENS = "Norrlöf et al. 24"

For the two-author case, the first token ends with "& " (ampersand + trailing space) and the second token starts with the second lastname — the firstname between them stays unmarked. For "et al." cases the whole "Lastname et al. Date" is one contiguous token. Each token MUST be a verbatim substring of the cite so the editor can locate it.`;

export interface AiCiteResult {
  cite: string;
  tokens: string[];
}

/** Format today's date as M-D-YYYY, matching the cite convention. */
function formatToday(now: Date = new Date()): string {
  return `${now.getMonth() + 1}-${now.getDate()}-${now.getFullYear()}`;
}

/** Replace the prompt's {DATE} placeholders. */
export function resolveCitePrompt(template: string, now: Date = new Date()): string {
  const today = formatToday(now);
  return template.split(DATE_PLACEHOLDER).join(today);
}

/** Parse the model's delimited-block reply. The format dodges all
 *  the JSON escape edge cases — cites with embedded quotes,
 *  curly punctuation, etc. just appear literally between the
 *  section markers. Throws on missing sections or empty cite. */
export function parseCiteResponse(text: string): AiCiteResult {
  // Tolerate stray prose / code fences around the block by
  // anchoring on the marker words. Markers are case-insensitive
  // and a leading hash / dash / etc. before the section header
  // is ignored, in case the model decorates them slightly.
  const citeIdx = findMarker(text, 'CITE');
  const tokensIdx = findMarker(text, 'TOKENS');
  const endIdx = findMarker(text, 'END');
  if (citeIdx === -1 || tokensIdx === -1 || tokensIdx < citeIdx) {
    throw new Error("Cite response missing the [[CITE]] / [[TOKENS]] markers.");
  }
  const citeBody = text
    .slice(citeIdx, tokensIdx)
    .replace(/^[^\n]*\n/, '') // drop the [[CITE]] header line itself
    .trim();
  if (!citeBody) {
    throw new Error('Cite response had an empty cite section.');
  }
  const tokensSliceEnd = endIdx > tokensIdx ? endIdx : text.length;
  const tokensBody = text
    .slice(tokensIdx, tokensSliceEnd)
    .replace(/^[^\n]*\n/, '') // drop the [[TOKENS]] header line
    .trim();
  // One token per line. Skip blanks and any stray "[[END]]" line
  // that snuck into the tokens block. Do NOT trim trailing
  // whitespace — the two-author convention has the first token
  // end with "& " (trailing space) and the parser must preserve
  // it so the substring match in the editor still works.
  const tokens = tokensBody
    .split(/\r?\n/)
    .filter((s) => s.trim().length > 0 && !/\[\[\s*END\s*\]\]/i.test(s));
  return { cite: citeBody, tokens };
}

/** Locate the FIRST occurrence of a section marker like `[[CITE]]`.
 *  Tolerates single brackets and surrounding whitespace just in
 *  case the model wobbles on the exact punctuation. Returns -1
 *  when not found. */
function findMarker(text: string, name: string): number {
  const re = new RegExp(`\\[\\[\\s*${name}\\s*\\]\\]`, 'i');
  const m = re.exec(text);
  return m ? m.index : -1;
}

/** Apply the cite to the editor: replace [from, to] with `cite`
 *  text, then add `cite_mark` to each token substring that
 *  appears within the inserted range. Returns false when the
 *  cite_mark type isn't in the schema (defensive — it always is). */
export function applyCiteToSelection(
  view: EditorView,
  from: number,
  to: number,
  result: AiCiteResult,
): boolean {
  const citeType = schema.marks['cite_mark'];
  if (!citeType) return false;

  // Replace the selection with the cite text. `insertText` keeps
  // any existing block boundaries intact and produces plain text
  // nodes. The inserted span runs from `from` to `from + cite.length`
  // — positions inside a single textblock are 1:1 with character
  // offsets, which is what we use to find token substrings below.
  const tr = view.state.tr;
  tr.insertText(result.cite, from, to);

  const start = from;
  const end = from + result.cite.length;
  // Strip every mark the inserted text picked up from the boundary
  // (PM `insertText` inherits the start position's marks). Without
  // this, a selection that started inside an existing cite_mark
  // span — or any other mark — leaves the whole replacement
  // wearing that mark, and the per-token application below ends up
  // redundant. The cite text should come out clean and only the
  // tokens should pick up cite_mark afterward.
  tr.removeMark(start, end);
  for (const token of result.tokens) {
    if (!token) continue;
    let searchOffset = 0;
    while (searchOffset <= result.cite.length - token.length) {
      const idx = result.cite.indexOf(token, searchOffset);
      if (idx < 0) break;
      const matchStart = start + idx;
      const matchEnd = matchStart + token.length;
      if (matchEnd > end) break;
      tr.addMark(matchStart, matchEnd, citeType.create());
      searchOffset = idx + token.length;
    }
  }
  view.dispatch(tr);
  return true;
}

let activeTooltip: ThinkingTooltip | null = null;

// --------------------------- command ----------------------------

/** Entry point — fires on `aiCreateCite` ribbon command. Reads
 *  the current selection, kicks off the API call, shows the
 *  in-flight tooltip, and on resolve replaces the selection
 *  with the formatted + marked cite. No-op when AI features are
 *  off, the key isn't set, or the selection is empty. */
export function runAiCreateCite(view: EditorView): void {
  if (!settings.get('aiFeaturesEnabled')) {
    showToast('AI features are disabled — enable them in Settings.');
    return;
  }
  const apiKey = settings.get('anthropicApiKey').trim();
  if (!apiKey) {
    showToast('Set an Anthropic API key in Settings to use AI features.');
    return;
  }
  const { state } = view;
  const sel = state.selection;
  if (sel.empty) {
    showToast('Select some citation info first.');
    return;
  }
  const raw = state.doc.textBetween(sel.from, sel.to, '\n', '\n').trim();
  if (!raw) {
    showToast('Selection has no text to format.');
    return;
  }

  const promptTemplate = settings.get('aiCitePrompt').trim() || DEFAULT_AI_CITE_PROMPT;
  const systemPrompt = resolveCitePrompt(promptTemplate);

  // Pin the tooltip below the selection's start coords.
  if (activeTooltip) activeTooltip.hide();
  activeTooltip = new ThinkingTooltip();
  try {
    const coords = view.coordsAtPos(sel.from);
    activeTooltip.show({ left: coords.left, top: coords.top, bottom: coords.bottom });
  } catch {
    // Fall back to top-of-viewport if coordsAtPos fails.
    activeTooltip.show({ left: 16, top: 16, bottom: 32 });
  }

  // Capture the bounds NOW; if the user edits during the request
  // the original selection might shift, but we want to replace
  // what they originally selected.
  const fromAtRequest = sel.from;
  const toAtRequest = sel.to;

  void (async () => {
    try {
      const reply = await callAnthropic({
        apiKey,
        system: systemPrompt,
        messages: [{ role: 'user', content: raw }],
      });
      const parsed = parseCiteResponse(reply.text);
      // Apply against the live view. If the user has somehow
      // deleted the range while the request was in flight, the
      // mark application step inside applyCiteToSelection will
      // throw — the catch below surfaces it as a toast.
      applyCiteToSelection(view, fromAtRequest, toAtRequest, parsed);
    } catch (e) {
      if (e instanceof AnthropicError) {
        showToast(`Cite: ${e.message}`);
      } else {
        showToast(`Cite: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (activeTooltip) {
        activeTooltip.hide();
        activeTooltip = null;
      }
    }
  })();
}
