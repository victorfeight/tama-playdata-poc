import { CharaFlags, ParsedGhost } from "@tama-breed-poc/tama-protocol";

export interface GhostPreview {
  label: string;
  charaId: number;
  eyeCharaId: number;
  stage: number;
  color: number;
  charaFlags: CharaFlags;
  validChecksum: boolean;
  source: "local" | "peer";
}

export function toGhostPreview(source: "local" | "peer", ghost: ParsedGhost): GhostPreview {
  return {
    label: source === "local" ? "Your ghost" : "Peer ghost",
    charaId: ghost.charaId,
    eyeCharaId: ghost.eyeCharaId,
    stage: ghost.stage,
    color: ghost.color,
    charaFlags: ghost.charaFlags,
    validChecksum: ghost.validChecksum,
    source
  };
}
