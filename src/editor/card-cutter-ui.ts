/**
 * Card-cutter launch sheet — the configuration flow.
 *
 * Asks only what the user knows up front: how long the read should be
 * (read-time) and what they're using the card for (intent). Then,
 * when enabled, runs the describe-then-generate clarifying step: the
 * engine proposes ≤3 candidate cuts (descriptions, not generations)
 * and the user picks one before anything is cut.
 *
 * Reuses the app's `pmd-route-overlay` / `pmd-route-dialog` chrome.
 */

import type { EditorView } from 'prosemirror-view';
import { settings } from './settings.js';
import { showToast } from './toast.js';
import {
  cutFocusedCard,
  focusedCardStatus,
  proposeFocusedCuts,
  ensureEngine,
  type CutProposal,
} from './card-cutter-port.js';

type Intent = 'build' | 'support' | 'answer';
const INTENT_ROLE: Record<Intent, 'block' | 'ext' | 'at'> = {
  build: 'block',
  support: 'ext',
  answer: 'at',
};

const READ_TIME_PRESETS = [8, 12, 20, 30];

export async function openCutLaunchSheet(view: EditorView): Promise<void> {
  if (!(await ensureEngine())) {
    showToast('Card-cutter engine not loaded.');
    return;
  }
  const status = focusedCardStatus(view);
  if (!status.cuttable) {
    showToast('Put the cursor in a card with body text first.');
    return;
  }
  if (status.hasHighlight) {
    showToast('This card is already highlighted.');
    return;
  }
  const highlightOnly = status.hasUnderline; // underlined → highlight only

  const overlay = document.createElement('div');
  overlay.className = 'pmd-route-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'pmd-route-dialog pmd-cardcutter-dialog';

  const header = document.createElement('div');
  header.className = 'pmd-route-header';
  header.textContent = highlightOnly ? 'Highlight card' : 'Cut card';
  dialog.appendChild(header);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };

  // ── Read-time ──
  let readTimeSec = settings.get('cardCutterReadTimeSec');
  const rtSection = document.createElement('div');
  rtSection.className = 'pmd-cardcutter-section';
  rtSection.appendChild(label('Read length'));
  const rtRow = document.createElement('div');
  rtRow.className = 'pmd-cardcutter-chips';
  const wpm = firstReaderWpm();
  const chipFor = (sec: number): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pmd-cardcutter-chip';
    b.textContent = `${sec}s · ~${Math.round((sec * wpm) / 60)}w`;
    b.setAttribute('aria-pressed', String(sec === readTimeSec));
    b.addEventListener('click', () => {
      readTimeSec = sec;
      rtRow.querySelectorAll('.pmd-cardcutter-chip').forEach((c) =>
        c.setAttribute('aria-pressed', String(c === b)),
      );
    });
    return b;
  };
  const presets = READ_TIME_PRESETS.includes(readTimeSec)
    ? READ_TIME_PRESETS
    : [...READ_TIME_PRESETS, readTimeSec].sort((a, b) => a - b);
  for (const sec of presets) rtRow.appendChild(chipFor(sec));
  rtSection.appendChild(rtRow);
  dialog.appendChild(rtSection);

  // ── Intent ──
  let intent: Intent = 'build';
  const intentSection = document.createElement('div');
  intentSection.className = 'pmd-cardcutter-section';
  intentSection.appendChild(label('Using this card to…'));
  const intents: [Intent, string][] = [
    ['build', 'Build a point — full read'],
    ['support', 'Add support — supplement a point already made'],
    ['answer', 'Answer — isolate the responsive line'],
  ];
  const grp = `pmd-cc-intent-${Math.random().toString(36).slice(2, 7)}`;
  for (const [val, text] of intents) {
    const lbl = document.createElement('label');
    lbl.className = 'pmd-cardcutter-radio';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = grp;
    input.checked = val === intent;
    input.addEventListener('change', () => {
      if (input.checked) intent = val;
    });
    lbl.appendChild(input);
    const span = document.createElement('span');
    span.textContent = text;
    lbl.appendChild(span);
    intentSection.appendChild(lbl);
  }
  dialog.appendChild(intentSection);

  // ── Ask-me ──
  const askDefault = settings.get('cardCutterClarifyingQuestions') !== 'never';
  let askMe = askDefault;
  const askRow = document.createElement('label');
  askRow.className = 'pmd-cardcutter-check';
  const askInput = document.createElement('input');
  askInput.type = 'checkbox';
  askInput.checked = askMe;
  askInput.disabled = settings.get('cardCutterClarifyingQuestions') === 'never';
  askInput.addEventListener('change', () => (askMe = askInput.checked));
  askRow.appendChild(askInput);
  const askSpan = document.createElement('span');
  askSpan.textContent = 'Ask me if this card cuts multiple ways';
  askRow.appendChild(askSpan);
  if (!highlightOnly) dialog.appendChild(askRow);

  // ── Buttons ──
  const buttons = document.createElement('div');
  buttons.className = 'pmd-text-prompt-buttons';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'pmd-route-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', close);
  buttons.appendChild(cancel);
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'pmd-text-prompt-ok';
  go.textContent = highlightOnly ? 'Highlight' : 'Cut';
  go.addEventListener('click', () => {
    void onGo();
  });
  buttons.appendChild(go);
  dialog.appendChild(buttons);

  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  async function onGo(): Promise<void> {
    const mode =
      settings.get('cardCutterClarifyingQuestions') === 'always' ? 'always' : 'when-ambiguous';
    // Describe-then-generate: only for a fresh full cut, when asked.
    if (!highlightOnly && askMe) {
      go.disabled = true;
      go.textContent = 'Thinking…';
      const proposals = await proposeFocusedCuts(view, readTimeSec, mode);
      go.disabled = false;
      go.textContent = 'Cut';
      if (proposals && proposals.length >= 2) {
        renderProposalStep(proposals);
        return;
      }
    }
    close();
    await cutFocusedCard(view, { role: INTENT_ROLE[intent], readTimeSec });
  }

  /** Second step: the engine's candidate cuts as a radio group. */
  function renderProposalStep(proposals: CutProposal[]): void {
    rtSection.hidden = true;
    intentSection.hidden = true;
    askRow.hidden = true;
    header.textContent = 'How are you using this card?';
    const sec = document.createElement('div');
    sec.className = 'pmd-cardcutter-section pmd-cardcutter-proposals';
    let chosen = proposals[0]!;
    const grp2 = `pmd-cc-prop-${Math.random().toString(36).slice(2, 7)}`;
    proposals.forEach((p, i) => {
      const lbl = document.createElement('label');
      lbl.className = 'pmd-cardcutter-radio pmd-cardcutter-proposal';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = grp2;
      input.checked = i === 0;
      input.addEventListener('change', () => {
        if (input.checked) chosen = p;
      });
      lbl.appendChild(input);
      const box = document.createElement('span');
      const t = document.createElement('strong');
      t.textContent = `${p.label} · ~${p.readTimeSec}s`;
      const d = document.createElement('span');
      d.className = 'pmd-cardcutter-proposal-detail';
      d.textContent = p.detail;
      box.appendChild(t);
      box.appendChild(d);
      lbl.appendChild(box);
      sec.appendChild(lbl);
    });
    dialog.insertBefore(sec, buttons);
    go.textContent = 'Cut';
    go.onclick = (): void => {
      close();
      void cutFocusedCard(view, { role: chosen.role, readTimeSec: chosen.readTimeSec });
    };
  }
}

function label(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pmd-cardcutter-label';
  el.textContent = text;
  return el;
}

function firstReaderWpm(): number {
  const r = settings.get('readers');
  return r[0]?.wpm && r[0].wpm > 0 ? r[0].wpm : 350;
}
