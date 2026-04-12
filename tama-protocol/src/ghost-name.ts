// Port of CharacterNameEncoder.cs (decode only).
// The character name lives at offset 0x12 of a ghost bin as:
//   9 languages x 13 chars x 2 bytes = 234 bytes
// Each language slot is an independent Paradise-encoded string.

import { decodeString } from "./paradise-chars";

const NAME_OFFSET = 0x12;
const NAME_LANG_SIZE = 26; // 13 chars * 2 bytes
const NAME_TOTAL_SIZE = 9 * NAME_LANG_SIZE; // 234 bytes

export const GHOST_NAME_LANGUAGES = [
  "Japanese",
  "English",
  "French",
  "German",
  "Portuguese",
  "Spanish",
  "Italian",
  "Chinese",
  "Korean"
] as const;

export function decodeGhostName(ghost: Uint8Array, languageIndex: number): string {
  if (ghost.byteLength < NAME_OFFSET + NAME_TOTAL_SIZE) return "";
  if (languageIndex < 0 || languageIndex >= GHOST_NAME_LANGUAGES.length) return "";
  const start = NAME_OFFSET + languageIndex * NAME_LANG_SIZE;
  return decodeString(ghost.subarray(start, start + NAME_LANG_SIZE), 0);
}

export function decodeAllGhostNames(ghost: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  GHOST_NAME_LANGUAGES.forEach((lang, i) => {
    out[lang] = decodeGhostName(ghost, i);
  });
  return out;
}

export function getEnglishGhostName(ghost: Uint8Array): string {
  return decodeGhostName(ghost, 1);
}

export function getJapaneseGhostName(ghost: Uint8Array): string {
  return decodeGhostName(ghost, 0);
}
