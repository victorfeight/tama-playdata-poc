import { PacketType } from "./packets";
import { Transport } from "./transport";
import { PlayType, TCPResult } from "./types";

export type PlaydatePhase =
  | "disconnected"
  | "dongle-open"
  | "ws-open"
  | "paired"
  | "exchanging"
  | "received-peer-ghost"
  | "sent-our-ghost"
  | "friendship"
  | "play-type"
  | "sync-1"
  | "breed-result"
  | "sync-2"
  | "done"
  | "error";

export interface PlaydateFlowEvents {
  phase?(phase: PlaydatePhase): void;
  bytes?(direction: "in" | "out", data: Uint8Array): void;
  customCommand?(command: string): void;
}

export interface PlaydateFlowOptions {
  transport: Transport;
  ourGhost: Uint8Array;
  playData: Uint8Array;
  acceptBreeding?: boolean;
  events?: PlaydateFlowEvents;
}

export interface PlaydateFlowResult {
  result: TCPResult;
  peerGhost?: Uint8Array | undefined;
  friendship?: number | undefined;
  playType?: PlayType | undefined;
  breedResult?: number | undefined;
}

// This state machine mirrors commands/playdate.py at the semantic level. The low-level TCPComm
// serial command dance still belongs in a packet transport adapter; do not invent missing frames here.
export class PlaydateFlow {
  constructor(private readonly options: PlaydateFlowOptions) {}

  async execute(): Promise<PlaydateFlowResult> {
    const { events, transport } = this.options;
    try {
      events?.phase?.("paired");
      const first = await transport.read();
      events?.bytes?.("in", first);

      events?.phase?.("exchanging");
      const peerGhost = await this.receiveTypedPayload(PacketType.PLAYDATE, first);
      events?.phase?.("received-peer-ghost");

      await this.writePayload(PacketType.PLAYDATE, concatBytes(this.options.ourGhost, this.options.playData));
      events?.phase?.("sent-our-ghost");

      const friendshipBytes = await transport.read();
      events?.bytes?.("in", friendshipBytes);
      const friendship = friendshipBytes.length >= 2 ? new DataView(friendshipBytes.buffer, friendshipBytes.byteOffset).getUint16(0, true) : undefined;
      events?.phase?.("friendship");

      const playTypeBytes = await transport.read();
      events?.bytes?.("in", playTypeBytes);
      const playTypeView = new DataView(playTypeBytes.buffer, playTypeBytes.byteOffset, playTypeBytes.byteLength);
      const playType = playTypeBytes.length >= 2 ? playTypeView.getUint16(0, true) : undefined;
      const flags = playTypeBytes.length >= 4 ? playTypeView.getUint16(2, true) : 0;
      events?.phase?.("play-type");

      let breedResult: number | undefined;
      if (flags && this.options.acceptBreeding) {
        await this.sendCustomCommand("BREED 1");
        events?.customCommand?.("BREED 1");
        events?.phase?.("sync-1");
        await this.sendCustomCommand("SYNC 1");
        breedResult = await this.receiveBreedResult();
        events?.phase?.("breed-result");
        await this.sendCustomCommand("SYNC 2");
        events?.phase?.("sync-2");
      }

      events?.phase?.("done");
      return {
        result: TCPResult.SUCCESS,
        peerGhost,
        friendship,
        playType,
        breedResult
      };
    } catch {
      events?.phase?.("error");
      return { result: TCPResult.FAILURE };
    }
  }

  private async receiveTypedPayload(_packetType: PacketType, initial: Uint8Array): Promise<Uint8Array> {
    // TODO: wire this to a TCPComm-compatible adapter after serial command framing is ported.
    return initial;
  }

  private async writePayload(_packetType: PacketType, payload: Uint8Array): Promise<void> {
    await this.options.transport.write(payload);
    this.options.events?.bytes?.("out", payload);
  }

  private async sendCustomCommand(command: string): Promise<void> {
    await this.options.transport.write(new TextEncoder().encode(`${command}\r\n`));
  }

  private async receiveBreedResult(): Promise<number | undefined> {
    const data = await this.options.transport.read();
    this.options.events?.bytes?.("in", data);
    if (data.length < 2) return undefined;
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(0, true);
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
