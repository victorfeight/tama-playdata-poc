import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

// One pinned English word list and policy for browser and server.
const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

export function normalizeNickname(value: string): string {
  return value.normalize("NFKC").replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
}

/** Return user-facing advice without echoing the matched word. */
export function nicknameProblem(value: string): string | undefined {
  const name = normalizeNickname(value);
  if (!name || [...name].length > 20) return "Choose a nickname of 1–20 characters.";
  if (matcher.hasMatch(name)) return "Please choose a nickname without offensive words.";
  return undefined;
}
