import { MSG_FLAG_SET_SESSION_ID, TcpObserver, type ObservedPacket } from "./tcp-observer";

/** Wire observations, deliberately no `completed` or `saved` state. */
export type PlaydateOutcome = "exchanging" | "result-observed" | "breeding" | "settling" | "interrupted";
export type PlaydateSide = 0 | 1;

/** One shared passive observer per attempt. Feed both directions in arrival order.
 * No deadlines, UART writes, inferred screen state, or decoder-error failures.
 */
export class PlaydateOutcomeObserver {
  private observers: [TcpObserver, TcpObserver];
  private queue = Promise.resolve();
  private queuedBytes = 0;
  private stopped = false;
  private phase: PlaydateOutcome = "exchanging";
  private pending = [false, false];
  private packetSeen = [false, false];
  private breedOffered = false;
  private breedAccepted = false;
  private sync2 = new Set<PlaydateSide>();

  constructor(private readonly changed: (phase: PlaydateOutcome) => void) {
    const make = (side: PlaydateSide) => new TcpObserver({
      framedCommand: line => {
        this.observers[side === 0 ? 1 : 0].peerCommand(line);
        this.command(side, line);
      },
      packet: packet => { this.packetSeen[side] = true; this.packet(packet); }
      // Decoder warnings never drive an outcome.
    }, true);
    this.observers = [make(0), make(1)];
  }

  get state(): PlaydateOutcome { return this.phase; }
  stop(): void { this.stopped = true; }
  settled(): Promise<void> { return this.queue; }

  push(side: PlaydateSide, bytes: Uint8Array): void {
    if (this.stopped) return;
    // Observation may be dropped under pressure; forwarding must never wait.
    if (this.queuedBytes + bytes.length > 1024 * 1024) { this.stop(); return; }
    const copy = Uint8Array.from(bytes);
    this.queuedBytes += copy.length;
    this.queue = this.queue.then(async () => {
      if (this.stopped) return;
      this.observers[side].push(copy);
      await this.observers[side].settled();
    }).catch(() => { this.stop(); }).finally(() => { this.queuedBytes -= copy.length; });
  }

  private set(phase: PlaydateOutcome): void {
    if (this.stopped || this.phase === "interrupted" || phase === this.phase) return;
    this.phase = phase;
    this.changed(phase);
  }

  private command(side: PlaydateSide, line: string): void {
    if (this.stopped) return;
    const peer = side === 0 ? 1 : 0;
    if (/^PKT /.test(line)) { this.pending[side] = true; this.packetSeen[side] = false; }
    if (/^ACK(?: 1)?$/.test(line) && this.packetSeen[peer]) this.pending[peer] = false;
    // CAN is an aborted transport, not proof of a user cancellation or save rollback.
    // An unsolicited CAN in an idle room is not an attempt failure.
    if (line === "CAN" && this.pending.some(Boolean)) this.set("interrupted");
    if (line === "BREED 1" && this.breedOffered) this.set("breeding");
    if (line === "BREED 0" && this.breedOffered) this.set("result-observed");
    if (line === "SYNC 2" && this.breedAccepted) {
      this.sync2.add(side);
      if (this.sync2.size === 2) this.set("settling");
    }
  }

  private packet(packet: ObservedPacket): void {
    if (packet.msgType !== 1 || (packet.rawMsgType & MSG_FLAG_SET_SESSION_ID) || packet.payload.length !== 4) return;
    const view = new DataView(packet.payload.buffer, packet.payload.byteOffset, 4);
    const result = view.getUint16(0, true), flags = view.getUint16(2, true);
    if (result > 4 || flags > 1) return;
    if (result === 4) {
      if (this.breedOffered) { this.breedAccepted = true; this.set("breeding"); }
    } else {
      this.breedOffered = !!flags;
      this.set("result-observed");
    }
  }
}
