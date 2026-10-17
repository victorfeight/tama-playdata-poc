import { describe, expect, it } from "vitest";
import { Tet3Session } from "../../tama-protocol/src/tet3-session";
import { encodeTet3, Tet3Observer, type Tet3Packet } from "../../tama-protocol/src/tet3";

function endpoint() {
  const sent: Tet3Packet[] = [], messages: number[] = [], failures: string[] = [];
  const parser = new Tet3Observer();
  const session = new Tet3Session(4, 123, 0, bytes => sent.push(...parser.push(bytes)),
    message => messages.push(message.type), reason => failures.push(reason));
  const receive = (packet: Partial<Tet3Packet>, now = 1) => session.receive(encodeTet3({
    session: 123 ^ 456, sequence: 1, type: 3, round: 0, a: 0, b: 0, c: 0, ...packet
  }), now);
  receive({ session: 0, sequence: 0, type: 1, a: 456, b: 4 });
  return { session, sent, messages, failures, receive };
}

describe("draft hosted TET3 endpoint", () => {
  it("rejects unknown types without consuming sequence or acknowledging them", () => {
    // Captured CA64 rejects types outside 3..15 after HELLO/ACK handling;
    // SDK tet3_wire.c rejects these too. CRC-valid does not mean valid type.
    const e = endpoint();
    for (const type of [0, 16, 0xffffffff]) e.receive({ type });
    expect(e.messages).toEqual([]);
    e.session.poll(2);
    expect(e.sent.some(packet => packet.type === 2)).toBe(false);
    e.receive({ type: 3 }, 3);
    expect(e.messages).toEqual([3]);
    expect(e.session.ready).toBe(true);
  });

  it("isolates session IDs and preserves stop-and-wait ACK/retry behavior", () => {
    const e = endpoint();
    e.receive({ session: 999 }); e.receive({ sequence: 2 });
    expect(e.messages).toEqual([]);
    e.receive({}); e.session.poll(2); // ACK for incoming READY.
    expect(e.sent.at(-1)).toMatchObject({ type: 2, sequence: 0, a: 1 });
    e.session.poll(3); // Host READY, sequence 1.
    e.session.poll(4); // Still in flight; too early for a retry.
    const ready = e.sent.find(packet => packet.type === 3)!;
    expect(ready).toMatchObject({ session: 123 ^ 456, sequence: 1 });
    e.session.poll(154);
    expect(e.sent.at(-1)).toEqual(ready);
    e.receive({ type: 2, sequence: 0, a: 2 }, 155);
    expect(e.session.pending).toBe(1);
    e.receive({ type: 2, sequence: 0, a: 1 }, 156);
    expect(e.session.pending).toBe(0);
    e.receive({}, 157); // Duplicate READY is ACKed but never reapplied.
    expect(e.messages).toEqual([3]);
    e.session.poll(158);
    expect(e.sent.at(-1)).toMatchObject({ type: 2, a: 1 });
    e.session.poll(5157);
    expect(e.failures).toEqual(["Toy stopped responding"]);
  });
});
