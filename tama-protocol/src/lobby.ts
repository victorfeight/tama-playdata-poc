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
