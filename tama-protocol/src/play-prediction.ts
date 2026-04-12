// Pure-function predictor for Paradise playdate outcomes. All rules come from
// TAMA_NEW/tama-para-research/gameplay/playdate.md:
//
//   * Eat-or-be-eaten: "If either character's hunger level is not full, and
//     one has the is_consumer attribute and the other has the is_consumee
//     attribute, the consumer will eat the consumee."
//   * Fighting: "If both characters have hunger of 2 or less or happiness of
//     5 or less (either of those conditions on each side, does not have to
//     be the same low hunger or happiness on both sides)."
//   * Normal play otherwise, with four animations based on friendship level.
//   * Breeding offered after normal play if both adults (stage 5), friendship
//     already at 4, neither is_unbreedable.
//
// Post-playdate friendship:
//   * No change if friendship == 0 or normal play did not occur.
//   * Else +1 base, +1 per side with is_in_love, capped at 4.

import { CharaFlags } from "./ghost";

export type PlayTypeCode = 0 | 1 | 2 | 3;
// matches playdate_result_t.result from protocols/playdate.md §Phase 3:
//   0: played (normal play)
//   1: fought
//   2: ate (this side ate the peer)
//   3: eaten (this side was eaten)
// 4 means "breeding proceeded" post-play and is only sent in the final result
// packet; predictors never return 4 from the pre-play inputs alone.

/** Per-side inputs the prediction algorithm needs. */
export interface SideInputs {
  stage: number;
  charaFlags: CharaFlags;
  hunger: number;     // 0-6
  happiness: number;   // 0-20
  isInLove: boolean;
}

export interface PlayTypePrediction {
  /** Canonical result code for THIS side (local). 0..3 per §Phase 3. */
  code: PlayTypeCode;
  label: "played" | "fought" | "ate peer" | "eaten by peer";
  /** True if breeding will be offered after a normal play animation. */
  breedingOffered: boolean;
}

export function predictPlayType(local: SideInputs, peer: SideInputs): PlayTypePrediction {
  // 1. Eat-or-be-eaten (wins over fight / normal)
  const eitherNotFull = local.hunger < 6 || peer.hunger < 6;
  if (eitherNotFull) {
    if (local.charaFlags.isConsumer && peer.charaFlags.isConsumee) {
      return { code: 2, label: "ate peer", breedingOffered: false };
    }
    if (peer.charaFlags.isConsumer && local.charaFlags.isConsumee) {
      return { code: 3, label: "eaten by peer", breedingOffered: false };
    }
  }

  // 2. Fight: both sides must be in a "bad mood" (hunger <= 2 OR happiness <= 5 each)
  const bad = (s: SideInputs) => s.hunger <= 2 || s.happiness <= 5;
  if (bad(local) && bad(peer)) {
    return { code: 1, label: "fought", breedingOffered: false };
  }

  // 3. Normal play.
  const breedingOffered = (
    local.stage === 5 && peer.stage === 5 &&
    !local.charaFlags.isUnbreedable && !peer.charaFlags.isUnbreedable
    // friendship=4 check happens post-play (we don't yet have the post-update
    // friendship); surface "offered if friendship reaches 4" upstream.
  );
  return { code: 0, label: "played", breedingOffered };
}

/**
 * Project post-playdate friendship given the actual play_type code (from the
 * Phase 3 result packet) and both sides' is_in_love flags. Caps at 4.
 *
 * Caller passes the friendship value transmitted in Phase 2 (pre-update);
 * this function returns the new value each peer will record locally.
 */
export function projectFriendship(
  currentFriendship: number,
  playTypeCode: number,
  localInLove: boolean,
  peerInLove: boolean
): number {
  // Per doc: "If friendship level is at 0 or normal play did not occur, the
  // friendship level does not increase."
  if (currentFriendship <= 0) return currentFriendship;
  if (playTypeCode !== 0 /* played */) return currentFriendship;
  const increase = 1 + (localInLove ? 1 : 0) + (peerInLove ? 1 : 0);
  return Math.min(4, currentFriendship + increase);
}
