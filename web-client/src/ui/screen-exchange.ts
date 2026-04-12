import { GhostPreview } from "../ghost-preview";
import { HexLog } from "../utils/hex-log";

export class ExchangeScreen {
  private readonly log = new HexLog();
  private renderQueued = false;

  constructor(
    private readonly logElement: HTMLElement,
    private readonly ghostElement: HTMLElement
  ) {}

  pushBytes(direction: "in" | "out", data: Uint8Array): void {
    this.log.push(direction, data);
    this.queueRender();
  }

  showGhost(ghost: GhostPreview): void {
    const checksum = ghost.validChecksum ? "checksum ok" : "checksum changed";
    this.ghostElement.textContent = `${ghost.label}: chara ${ghost.charaId}, eye ${ghost.eyeCharaId}, stage ${ghost.stage}, gender ${ghost.gender}, color ${ghost.color}. ${checksum}.`;
  }

  showMessage(message: string): void {
    this.ghostElement.textContent = message;
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
