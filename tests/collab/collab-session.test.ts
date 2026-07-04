// @vitest-environment jsdom
/**
 * End-to-end session test: two full editor peers (real schema, real
 * LoroSyncPlugin, real encrypted transport) syncing through the
 * in-process rooms relay — seed propagation, live convergence, the
 * offline→reconnect travel-day cycle, the P1 highlight-union regression
 * through the whole stack, and session end.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { schema } from '../../src/schema/index.js';
import { RoomsClient } from '../../src/editor/collab/room-client.js';
import { CollabSession } from '../../src/editor/collab/collab-session.js';
import { decodeShareCode } from '../../src/editor/collab/collab-crypto.js';
import { startRoomsMock, type RoomsMock } from './_rooms-mock.js';
import {
  mkView,
  settle,
  sleep,
  simpleDoc,
  mixedDoc,
  docText,
  findText,
  rangeFullyMarked,
  addMarkOn,
  typeAfter,
} from './_loro-helpers.js';

let mock: RoomsMock;
let client: RoomsClient;

beforeAll(async () => {
  mock = await startRoomsMock();
  client = new RoomsClient({ baseUrl: () => mock.url, token: () => mock.token });
});
afterAll(async () => {
  await mock.close();
});

const FAST = { flushMs: 25, minBackoffMs: 20, maxBackoffMs: 60, catchUpMs: 60_000 };

async function hostAndJoin(seedDoc = mixedDoc()) {
  const { session: host, shareCode } = await CollabSession.host({
    pmDoc: seedDoc,
    client,
    ...FAST,
  });
  const hostView = mkView(host.plugins());
  await settle();
  host.start();

  const decoded = decodeShareCode(shareCode)!;
  const joiner = await CollabSession.join({ ...decoded, client, ...FAST });
  const joinView = mkView(joiner.plugins());
  await settle();
  joiner.start();
  await sleep(80);
  return { host, hostView, joiner, joinView };
}

describe('collab session end-to-end', () => {
  it('propagates the seed to a joiner', async () => {
    const seed = mixedDoc();
    const { host, hostView, joiner, joinView } = await hostAndJoin(seed);
    expect(joinView.state.doc.eq(seed)).toBe(true);
    expect(hostView.state.doc.eq(seed)).toBe(true);
    await joiner.stop();
    await host.stop();
  });

  it('converges live concurrent edits in both directions', async () => {
    const { host, hostView, joiner, joinView } = await hostAndJoin();
    typeAfter(hostView, 'quick fox', ' swiftly');
    typeAfter(joinView, 'lazy dog', ' sleeping');
    await sleep(250);
    expect(joinView.state.doc.eq(hostView.state.doc)).toBe(true);
    const t = docText(hostView.state.doc);
    expect(t).toContain('quick fox swiftly');
    expect(t).toContain('lazy dog sleeping');
    await joiner.stop();
    await host.stop();
  });

  it('survives the travel-day cycle: offline queue, edits both sides, reconnect merge', async () => {
    const { host, hostView, joiner, joinView } = await hostAndJoin();

    mock.pause();
    host.restart(); // sever live sockets so the outage is total
    joiner.restart();
    await sleep(60);

    typeAfter(hostView, 'riverbank', ' upstream');
    typeAfter(joinView, 'evidence text', ' and warrants');
    await sleep(120); // flush timers run; posts fail; queues hold
    expect(host.queuedUpdates + joiner.queuedUpdates).toBeGreaterThan(0);
    expect(docText(hostView.state.doc)).not.toBe(docText(joinView.state.doc));

    mock.resume();
    await sleep(500); // reconnect (backoff ≤60ms) + hello catch-up + drain
    expect(joinView.state.doc.eq(hostView.state.doc)).toBe(true);
    const t = docText(hostView.state.doc);
    expect(t).toContain('riverbank upstream');
    expect(t).toContain('evidence text and warrants');
    await joiner.stop();
    await host.stop();
  });

  it('preserves the highlight union through the full stack (P1 regression)', async () => {
    const { host, hostView, joiner, joinView } = await hostAndJoin(
      simpleDoc('The quick fox jumped over the lazy dog tonight.'),
    );
    mock.pause();
    host.restart();
    joiner.restart();
    await sleep(60);
    const green = schema.marks['highlight']!.create({ color: 'green' });
    addMarkOn(hostView, 'The quick fox', green);
    addMarkOn(joinView, 'fox jumped over', green);
    await sleep(120);
    mock.resume();
    await sleep(500);
    expect(joinView.state.doc.eq(hostView.state.doc)).toBe(true);
    const union = findText(hostView.state.doc, 'The quick fox jumped over');
    expect(
      rangeFullyMarked(hostView.state.doc, union.from, union.to, schema.marks['highlight']!, {
        color: 'green',
      }),
    ).toBe(true);
    await joiner.stop();
    await host.stop();
  });

  it('ends the session for everyone (host end → participant onEnded)', async () => {
    let joinerEnded = false;
    const { session: host, shareCode } = await CollabSession.host({
      pmDoc: simpleDoc('to end'),
      client,
      ...FAST,
    });
    const hostView = mkView(host.plugins());
    await settle();
    host.start();
    const joiner = await CollabSession.join({
      ...decodeShareCode(shareCode)!,
      client,
      ...FAST,
      callbacks: { onEnded: () => (joinerEnded = true) },
    });
    const jView = mkView(joiner.plugins());
    await settle();
    joiner.start();
    await sleep(80);
    await host.end();
    await sleep(100);
    expect(joinerEnded).toBe(true);
    hostView.destroy();
    jView.destroy();
  });
});

describe('room-history integrity (compaction-loss self-heal)', () => {
  it('P14: a compaction that destroyed a peer\'s ops is detected and repaired by the audit', async () => {
    const mock = await startRoomsMock();
    const client = new RoomsClient({ baseUrl: () => mock.url, token: () => mock.token });
    try {
      // Host + joiner, both online; joiner contributes edits.
      const { session: host, shareCode } = await CollabSession.host({
        pmDoc: simpleDoc('the shared travel-day doc'),
        client,
        flushMs: 40,
        minBackoffMs: 30,
        maxBackoffMs: 60,
      });
      const hostView = mkView(host.plugins());
      await settle();
      host.start();
      const decoded = decodeShareCode(shareCode)!;
      const joiner = await CollabSession.join({
        ...decoded,
        client,
        flushMs: 40,
        minBackoffMs: 30,
        maxBackoffMs: 60,
      });
      const joinerView = mkView(joiner.plugins());
      await settle();
      joiner.start();
      await sleep(300);
      typeAfter(joinerView, 'shared', ' JOINER-EDIT');
      await sleep(300);
      expect(docText(hostView.state.doc)).toContain('JOINER-EDIT');

      // SIMULATED FIELD CORRUPTION: a compaction snapshot exported from
      // a doc that LACKS the joiner's ops, covering their stored seqs —
      // the relay truncates the log and the joiner's history is gone
      // from the room (pre-guard hosts could do this while imports were
      // pending). The bogus snapshot comes from a doc holding ONLY the
      // room's first blob (the host-only seed).
      const { importRoomKey, encryptBlob: seal, bytesToBase64: b64 } = await import(
        '../../src/editor/collab/collab-crypto.js'
      );
      const key = await importRoomKey(decoded.keyBytes);
      const hostOnly = new (await import('loro-crdt')).LoroDoc();
      // First room update = the seed snapshot (host-only history).
      const firstPage = await client.fetchUpdates(host.roomId, 0);
      // find the earliest blob (the seed) and import just that
      const { decryptBlob: open_ } = await import('../../src/editor/collab/collab-crypto.js');
      const earliest = firstPage.snapshot
        ? firstPage.snapshot.blob
        : firstPage.updates[0]!.blob;
      hostOnly.import(await open_(key, earliest));
      const lastSeq = (await client.fetchUpdates(host.roomId, 0)).lastSeq;
      const bogus = hostOnly.export({ mode: 'snapshot' });
      await client.postSnapshot(host.roomId, b64(await seal(key, bogus)), lastSeq);

      // The room's stored history now lacks the joiner's ops. A FRESH
      // participant (like a resumed host after cache loss) can't see them:
      const fresh = await CollabSession.join({ ...decoded, client, flushMs: 40 });
      const freshView = mkView(fresh.plugins());
      await settle();
      expect(docText(freshView.state.doc)).not.toContain('JOINER-EDIT');

      // THE HEAL: the joiner's audit sees the room missing its acked ops
      // and reposts full history.
      await joiner.auditRoomHistory();
      await fresh.catchUp();
      await settle();
      expect(docText(freshView.state.doc)).toContain('JOINER-EDIT');

      await fresh.stop();
      await joiner.stop();
      await host.stop();
      hostView.destroy();
      joinerView.destroy();
      freshView.destroy();
    } finally {
      await mock.close();
    }
  }, 25_000);
});
