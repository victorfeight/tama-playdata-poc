import { encodeTet3, Tet3Observer, type Tet3Packet } from "./tet3";

export type Tet3Message = Pick<Tet3Packet, "type" | "round" | "a" | "b" | "c">;

/** DRAFT: not exported or used by either live activity page. Needs SDK C
 * differential qualification before the 2–16-player coordinator is connected.
 * Host-side counterpart of SDK net/tet3_session.c. One endpoint per toy.
 * Stop-and-wait, bounded queue, ACK priority; no sockets or clocks owned here.
 */
export class Tet3Session {
  readonly parser = new Tet3Observer();
  session = 0;
  ready = false;
  error: string | undefined;
  retries = 0;
  private readonly queue: Tet3Message[] = [];
  private sequence = 0;
  private received = 0;
  private ack = 0;
  private inFlight = false;
  private lastRx: number;
  private lastByte: number;
  private lastHello: number;
  private lastTx = 0;
  private lastBeat = 0;

  constructor(readonly mode: number, readonly nonce: number, now: number,
    private readonly send: (bytes: Uint8Array) => void,
    private readonly message: (message: Tet3Message) => void,
    private readonly failed: (reason: string) => void) {
    if (!nonce || nonce !== (nonce >>> 0)) throw new Error("A nonzero uint32 nonce is required");
    this.lastRx = this.lastByte = now; this.lastHello = now - 500;
  }

  get pending(): number { return this.queue.length; }

  enqueue(type: number, round = 0, a = 0, b = 0, c = 0): boolean {
    if (this.error || this.queue.length >= 8) return false;
    this.queue.push({ type, round, a: a >>> 0, b: b >>> 0, c: c >>> 0 });
    return true;
  }

  stop(reason: string): void {
    if (this.error) return;
    this.error = reason; this.queue.length = 0; this.failed(reason);
  }

  receive(bytes: Uint8Array, now: number): void {
    if (this.error) return;
    if (now - this.lastByte > 250) this.parser.reset();
    this.lastByte = now;
    for (const packet of this.parser.push(bytes)) {
      if (this.error) break;
      if (packet.type === 1) {
        if (!packet.session && !packet.sequence && !packet.round && packet.a && packet.b === this.mode && !this.session) {
          if (packet.a === this.nonce) { this.stop("Toy and host used the same nonce; reconnect"); break; }
          this.session = (packet.a ^ this.nonce) >>> 0; this.lastRx = now;
          this.enqueue(3);
        }
        continue;
      }
      if (!this.session || packet.session !== this.session) continue;
      if (packet.type === 2) {
        if (packet.sequence || packet.round || packet.b || packet.c || !this.inFlight || packet.a !== this.sequence) continue;
        this.inFlight = false; this.queue.shift();
      } else {
        if (!packet.sequence || packet.type < 3 || packet.type > 15) continue;
        if (packet.sequence <= this.received) { this.ack = packet.sequence; continue; }
        if (packet.sequence !== this.received + 1) continue;
        if (packet.type === 3 && !packet.round) this.ready = true;
        this.message(packet); this.received = packet.sequence; this.ack = packet.sequence;
      }
      this.lastRx = now;
    }
  }

  poll(now: number): void {
    if (this.error) return;
    if (this.session && now - this.lastRx > 5000) { this.stop("Toy stopped responding"); return; }
    if (this.ready && now - this.lastBeat >= 1000 && !this.queue.length) {
      this.lastBeat = now; this.enqueue(11);
    }
    let message: Tet3Message, session = this.session, sequence = 0;
    if (this.ack) { message = { type: 2, round: 0, a: this.ack, b: 0, c: 0 }; this.ack = 0; }
    else if (!this.ready && now - this.lastHello >= 500) {
      message = { type: 1, round: 0, a: this.nonce, b: this.mode, c: 0 }; session = 0; this.lastHello = now;
    } else {
      if (!session || !this.queue.length) return;
      if (this.inFlight) { if (now - this.lastTx < 150) return; this.retries++; }
      else {
        if (this.sequence === 0xffffffff) { this.stop("Session sequence exhausted"); return; }
        this.sequence++; this.inFlight = true;
      }
      sequence = this.sequence; message = this.queue[0]!; this.lastTx = now;
    }
    this.send(encodeTet3({ session, sequence, ...message }));
  }
}
