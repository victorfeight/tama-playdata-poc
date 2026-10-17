/** Lobby metadata is JSON control traffic; it must never reach a toy's UART. */
export interface LobbyMember {
  id: string;
  nickname: string;
  slot: number;
  connected: boolean;
  /** null means an older client cannot report adapter state. */
  adapterConnected: boolean | null;
  /** Changes on socket replacement so observers reset even on a fast rejoin. */
  connection: number;
}

export interface LobbySnapshot {
  type: "lobby";
  code: string;
  activity: "playdate";
  visibility: "public" | "private";
  capacity: number;
  members: LobbyMember[];
  /** Instruction assignment only: never gates or rewrites UART traffic. */
  starterId?: string | undefined;
  /** Absent/false for older servers and rooms containing desktop clients. */
  canChooseStarter?: boolean;
  /** Player-reported menu readiness, never detected device readiness. */
  startPrompt?: "prepare" | "ready" | "started" | undefined;
  readyForMs?: number | undefined;
}

export interface LobbyListing {
  code: string;
  nickname: string;
  count: number;
  capacity: number;
}

export interface LobbyEntry {
  code: string;
  memberId: string;
  token: string;
  /** Presentation adapter for an existing code-only room, always the guest. */
  legacyNickname?: string;
}
