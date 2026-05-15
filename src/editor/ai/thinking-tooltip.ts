/**
 * Floating "Thinking…" pill pinned next to a viewport coordinate
 * while an AI request is in flight. Shared by every AI feature that
 * doesn't have its own side-panel placeholder — cite-creator,
 * generate-alt-text, generate-table-from-image, etc.
 *
 * When Clod mode is on, the pill cycles through the user's persona
 * activities; otherwise it just reads "Thinking…". Cycling is
 * driven by a setInterval that swaps the inner activity-stage text
 * — the same cycler the comments column uses.
 */

import { settings } from '../settings.js';
import {
  activitiesForNow,
  pickRandomActivity,
  personalizeActivity,
} from './clod.js';
import { getAiPersona } from '../comments-ui.js';
import { makeActivityStage, cycleActivityText } from './activity-cycler.js';

/** Cycle interval. Matches the cite-creator's prior local constant. */
const ACTIVITY_TICK_MS = 4000;

export interface TooltipAnchor {
  /** Viewport-space coords from `view.coordsAtPos` (or any other
   *  rect query). The tooltip is positioned page-absolute, so the
   *  show() impl adds the current scroll offsets. */
  left: number;
  top: number;
  bottom: number;
}

/** A single visible pill. Calling `show()` mounts; `hide()` cleans
 *  up. There's no anchor-tracking — if the user scrolls the doc
 *  while a request is in flight the pill stays at its original
 *  page-absolute position, which matches existing cite-creator
 *  behavior and is fine for the short-lived calls we make. */
export class ThinkingTooltip {
  private el: HTMLDivElement | null = null;
  private ticker: number | null = null;

  show(anchor: TooltipAnchor): void {
    if (this.el) return;
    const el = document.createElement('div');
    el.className = 'pmd-ai-cite-tooltip';
    const top = anchor.bottom + window.scrollY + 6;
    const left = anchor.left + window.scrollX;
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.appendChild(makeActivityStage(this.currentText()));
    document.body.appendChild(el);
    this.el = el;

    this.ticker = window.setInterval(() => {
      if (!this.el) return;
      const stage = this.el.querySelector<HTMLElement>('.pmd-activity-stage');
      if (stage) cycleActivityText(stage, this.currentText());
    }, ACTIVITY_TICK_MS);
  }

  hide(): void {
    if (this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }

  private currentText(): string {
    if (!settings.get('clodEnabled')) return 'Thinking…';
    const pool = activitiesForNow({
      customByTime: settings.get('clodActivitiesByTime'),
      ranges: settings.get('clodTimePeriods'),
    });
    return personalizeActivity(pickRandomActivity(pool), getAiPersona());
  }
}
