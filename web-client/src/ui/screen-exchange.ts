import { GhostPreview } from "../ghost-preview";
import { HexLog } from "../utils/hex-log";

export class ExchangeScreen {
  private readonly log = new HexLog();
  private renderQueued = false;
  private readonly ghostLines = new Map<GhostPreview["source"], string>();
  private messageLine: string | undefined;

  constructor(
    private readonly logElement: HTMLElement,
    private readonly ghostElement: HTMLElement
  ) {}

  pushBytes(direction: "in" | "out", data: Uint8Array): void {
    this.log.push(direction, data);
    this.queueRender();
  }

  pushSystem(message: string): void {
    this.log.pushSystem(message);
    this.queueRender();
  }

  // Each source (local / peer) keeps its own line so both ghosts stack once
  // they arrive, instead of the later one clobbering the earlier one.
  showGhost(ghost: GhostPreview): void {
    const checksum = ghost.validChecksum ? "checksum ok" : "checksum changed";
    const flags: string[] = [];
    if (ghost.charaFlags.isConsumer) flags.push("consumer");
    if (ghost.charaFlags.isConsumee) flags.push("consumee");
    if (ghost.charaFlags.isUnbreedable) flags.push("unbreedable");
    const flagText = flags.length ? `, ${flags.join("+")}` : "";
    const line = `${ghost.label}: chara ${ghost.charaId}, eye ${ghost.eyeCharaId}, stage ${ghost.stage}, color ${ghost.color}${flagText}. ${checksum}.`;
    this.ghostLines.set(ghost.source, line);
    this.renderGhostElement();
  }

  showMessage(message: string): void {
    this.messageLine = message;
    this.renderGhostElement();
  }

  private renderGhostElement(): void {
    const lines: string[] = [];
    if (this.messageLine) lines.push(this.messageLine);
    const local = this.ghostLines.get("local");
    const peer = this.ghostLines.get("peer");
    if (local) lines.push(local);
    if (peer) lines.push(peer);
    this.ghostElement.textContent = lines.join("\n");
  }

  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.logElement.textContent = this.log.toString();
      this.logElement.scrollTop = this.logElement.scrollHeight;
    });
  }
}
