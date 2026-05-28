/**
 * Learn — the local annotation store (per-user; the layer that never enters
 * the document, SPEC-learn-system §3.3). Holds flashcard content + schedule,
 * AI threads, anchors, custom decks, and the doc registry.
 *
 * Identity is split so file-copies share one logical card + one schedule
 * while each file keeps its own grounding:
 *   - per `cardId`:            CardDef (content) + ScheduleEntry (schedule)
 *   - per (`cardId`,`docId`):  CardAnchor (how a card is grounded in a file)
 *   - per (`threadId`,`docId`): AiThread
 *
 * Persistence is injected (`persist`) so the model is host-agnostic and
 * unit-testable; the renderer wires it to a host KV. Review reads entirely
 * from here — no file I/O.
 */

import type { ScheduleEntry, Grade } from './learn-scheduler.js';
import { newSchedule, gradeCard, buildQueue, dueCount } from './learn-scheduler.js';
import type { AnchorDescriptor } from './learn-anchor.js';

export interface CardDef {
  id: string; // cardId — stable, local
  type: 'qa' | 'cloze';
  front: string;
  back: string;
}

export interface CardAnchor {
  cardId: string;
  docId: string;
  anchor: AnchorDescriptor | null; // null ⇒ currently unanchored
}

export interface LocalComment {
  author: string;
  text: string;
  at: string; // ISO
  /** Distinguishes AI turns from the user's in an AI thread. */
  ai?: boolean;
}

export interface AiThread {
  threadId: string;
  docId: string;
  comments: LocalComment[];
  anchor: AnchorDescriptor | null;
  createdAt: string;
}

export interface ReviewLogEntry {
  cardId: string;
  at: string; // ISO
  grade: Grade;
  intervalBefore: number;
  intervalAfter: number;
}

export interface CustomDeck {
  deckId: string;
  name: string;
  cardIds: string[];
  createdAt: string;
}

export interface DocRegistryEntry {
  docId: string;
  knownPaths: string[]; // newest first
  lastName: string;
  format: 'cmir' | 'docx' | null;
}

/** Review scope. */
export type Scope = { kind: 'all' } | { kind: 'file'; docId: string } | { kind: 'deck'; deckId: string };

interface Blob {
  version: number;
  cards: CardDef[];
  schedules: ScheduleEntry[];
  anchors: CardAnchor[];
  aiThreads: AiThread[];
  log: ReviewLogEntry[];
  decks: CustomDeck[];
  docs: DocRegistryEntry[];
}

const VERSION = 1;
const EMPTY: Blob = { version: VERSION, cards: [], schedules: [], anchors: [], aiThreads: [], log: [], decks: [], docs: [] };

export class LearnStore {
  private cards = new Map<string, CardDef>();
  private schedules = new Map<string, ScheduleEntry>();
  private anchors: CardAnchor[] = [];
  private aiThreads: AiThread[] = [];
  private log: ReviewLogEntry[] = [];
  private decks: CustomDeck[] = [];
  private docs = new Map<string, DocRegistryEntry>();
  private listeners = new Set<() => void>();

  /** `persist` is called (debounced by the caller) with the serialized blob. */
  constructor(private persist: (json: string) => void = () => {}) {}

  // ── (de)serialization ─────────────────────────────────────────────
  loadJson(json: string | null): void {
    let b: Partial<Blob> = {};
    if (json) {
      try {
        b = JSON.parse(json);
      } catch {
        b = {};
      }
    }
    this.cards = new Map((b.cards ?? []).map((c) => [c.id, c]));
    this.schedules = new Map((b.schedules ?? []).map((s) => [s.cardId, s]));
    this.anchors = b.anchors ?? [];
    this.aiThreads = b.aiThreads ?? [];
    this.log = b.log ?? [];
    this.decks = b.decks ?? [];
    this.docs = new Map((b.docs ?? []).map((d) => [d.docId, d]));
  }

  toJson(): string {
    const b: Blob = {
      version: VERSION,
      cards: [...this.cards.values()],
      schedules: [...this.schedules.values()],
      anchors: this.anchors,
      aiThreads: this.aiThreads,
      log: this.log,
      decks: this.decks,
      docs: [...this.docs.values()],
    };
    return JSON.stringify(b);
  }

  private changed(): void {
    this.persist(this.toJson());
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── reads ─────────────────────────────────────────────────────────
  getCard(cardId: string): CardDef | undefined {
    return this.cards.get(cardId);
  }
  getSchedule(cardId: string): ScheduleEntry | undefined {
    return this.schedules.get(cardId);
  }
  listDecks(): CustomDeck[] {
    return [...this.decks];
  }
  listDocs(): DocRegistryEntry[] {
    return [...this.docs.values()];
  }
  /** Anchors (card↔file grounding) for a doc. */
  anchorsForDoc(docId: string): CardAnchor[] {
    return this.anchors.filter((a) => a.docId === docId);
  }
  aiThreadsForDoc(docId: string): AiThread[] {
    return this.aiThreads.filter((t) => t.docId === docId);
  }

  /** The cardIds belonging to a scope. */
  private cardIdsForScope(scope: Scope): Set<string> {
    if (scope.kind === 'all') return new Set(this.cards.keys());
    if (scope.kind === 'file') return new Set(this.anchorsForDoc(scope.docId).map((a) => a.cardId));
    const deck = this.decks.find((d) => d.deckId === scope.deckId);
    return new Set(deck?.cardIds ?? []);
  }

  private schedulesForScope(scope: Scope): ScheduleEntry[] {
    const ids = this.cardIdsForScope(scope);
    return [...this.schedules.values()].filter((s) => ids.has(s.cardId));
  }

  /** Distinct cards due in a scope (home-screen badges). */
  dueCount(scope: Scope, today: string): number {
    return dueCount(this.schedulesForScope(scope), today);
  }

  totalCount(scope: Scope): number {
    return this.cardIdsForScope(scope).size;
  }

  /** Ordered review queue of cardIds for a scope (deduped by card). */
  queue(scope: Scope, today: string): string[] {
    return buildQueue(this.schedulesForScope(scope), today).map((s) => s.cardId);
  }

  // ── mutations ─────────────────────────────────────────────────────
  /** Create or replace a card's content; ensure a schedule exists. */
  upsertCard(card: CardDef, today: string): void {
    this.cards.set(card.id, card);
    if (!this.schedules.has(card.id)) this.schedules.set(card.id, newSchedule(card.id, today));
    this.changed();
  }

  /** Set/replace a card's grounding in a file (one per cardId × docId). */
  setAnchor(cardId: string, docId: string, anchor: AnchorDescriptor | null): void {
    const existing = this.anchors.find((a) => a.cardId === cardId && a.docId === docId);
    if (existing) existing.anchor = anchor;
    else this.anchors.push({ cardId, docId, anchor });
    this.changed();
  }

  addAiThread(thread: AiThread): void {
    this.aiThreads.push(thread);
    this.changed();
  }

  /** AI thread anchor update (or null to unanchor). */
  setAiThreadAnchor(threadId: string, anchor: AnchorDescriptor | null): void {
    const t = this.aiThreads.find((x) => x.threadId === threadId);
    if (t) {
      t.anchor = anchor;
      this.changed();
    }
  }

  removeAiThread(threadId: string): void {
    this.aiThreads = this.aiThreads.filter((t) => t.threadId !== threadId);
    this.changed();
  }

  /** Apply a grade to a card: update schedule + append to the log. Returns
   *  whether to retry the card within the session. */
  grade(cardId: string, g: Grade, today: string, now: string): boolean {
    const cur = this.schedules.get(cardId);
    if (!cur) return false;
    const { entry, retryInSession } = gradeCard(cur, g, today, now);
    this.schedules.set(cardId, entry);
    this.log.push({ cardId, at: now, grade: g, intervalBefore: cur.intervalDays, intervalAfter: entry.intervalDays });
    this.changed();
    return retryInSession;
  }

  suspend(cardId: string): void {
    const s = this.schedules.get(cardId);
    if (s) {
      this.schedules.set(cardId, { ...s, state: 'suspended' });
      this.changed();
    }
  }

  /** Archive (suspend) or delete all of a file's cards/threads — culls stale
   *  copies (§3.3, §10). Delete drops the file's anchors + AI threads and
   *  prunes any card with no anchor left in any file. */
  forgetDoc(docId: string, mode: 'archive' | 'delete'): void {
    const docCardIds = new Set(this.anchorsForDoc(docId).map((a) => a.cardId));
    if (mode === 'archive') {
      for (const id of docCardIds) {
        const s = this.schedules.get(id);
        if (s) this.schedules.set(id, { ...s, state: 'suspended' });
      }
      this.changed();
      return;
    }
    // delete
    this.anchors = this.anchors.filter((a) => a.docId !== docId);
    this.aiThreads = this.aiThreads.filter((t) => t.docId !== docId);
    const stillAnchored = new Set(this.anchors.map((a) => a.cardId));
    for (const id of docCardIds) {
      if (!stillAnchored.has(id)) {
        this.cards.delete(id);
        this.schedules.delete(id);
        for (const d of this.decks) d.cardIds = d.cardIds.filter((c) => c !== id);
      }
    }
    this.changed();
  }

  // decks
  createDeck(name: string, deckId: string, now: string): void {
    this.decks.push({ deckId, name, cardIds: [], createdAt: now });
    this.changed();
  }
  renameDeck(deckId: string, name: string): void {
    const d = this.decks.find((x) => x.deckId === deckId);
    if (d) {
      d.name = name;
      this.changed();
    }
  }
  deleteDeck(deckId: string): void {
    this.decks = this.decks.filter((d) => d.deckId !== deckId);
    this.changed();
  }
  setDeckMembership(deckId: string, cardId: string, member: boolean): void {
    const d = this.decks.find((x) => x.deckId === deckId);
    if (!d) return;
    const has = d.cardIds.includes(cardId);
    if (member && !has) d.cardIds.push(cardId);
    else if (!member && has) d.cardIds = d.cardIds.filter((c) => c !== cardId);
    this.changed();
  }

  // doc registry
  registerDoc(entry: { docId: string; path?: string | null; name: string; format: 'cmir' | 'docx' | null }): void {
    const cur = this.docs.get(entry.docId) ?? { docId: entry.docId, knownPaths: [], lastName: entry.name, format: entry.format };
    cur.lastName = entry.name;
    cur.format = entry.format;
    if (entry.path) cur.knownPaths = [entry.path, ...cur.knownPaths.filter((p) => p !== entry.path)].slice(0, 8);
    this.docs.set(entry.docId, cur);
    this.changed();
  }

  /** Reassign annotations from a temporary session id to the real docId
   *  (first save of a previously-unsaved doc). */
  rekeyDoc(fromId: string, toId: string): void {
    for (const a of this.anchors) if (a.docId === fromId) a.docId = toId;
    for (const t of this.aiThreads) if (t.docId === fromId) t.docId = toId;
    const reg = this.docs.get(fromId);
    if (reg) {
      this.docs.delete(fromId);
      this.docs.set(toId, { ...reg, docId: toId });
    }
    this.changed();
  }
}
