import type { HostedMatch } from "./hosted-match";
export type HostedGameId = "blocks" | "pocket-puzzle";
export interface GameRoomEntry { code: string; memberId: string; token: string; game: HostedGameId; }
export interface GameRoomSnapshot {
  type: "game-room"; code: string; game: HostedGameId; owner: string;
  visibility: "public" | "private"; capacity: number; canStart: boolean;
  members: { id: string; nickname: string; connected: boolean; adapter: boolean; toyReady: boolean; ready: boolean; reason?: string | undefined }[];
  match?: ReturnType<HostedMatch["snapshot"]> | undefined;
  countdownMs?: number | undefined;
}
export interface GameRoomListing { code: string; game: HostedGameId; nickname: string; count: number; capacity: number; }
