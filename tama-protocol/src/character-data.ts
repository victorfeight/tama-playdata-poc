// Port of TamaParadiseApp_licenses/.../Data/CharacterDataEmbedded.cs.
// Per-character positioning data for compositing eyes/mouth onto body sprites.
// All coordinates are pixels relative to the body sprite's top-left origin.
//
// This is the canonical Tamagotchi Paradise character table. 96 entries total:
// babies (stage 2), kids (3), teens (4), adults + lab characters (5).

export interface CharacterEntry {
  id: number;
  name: string;
  stage: number;
  isJade: boolean;
  isExternal: boolean;
  eyeX: number;
  eyeY: number;
  mouthX: number;
  mouthY: number;
  fieldType: number;
}

export const CHARACTERS: ReadonlyArray<CharacterEntry> = [
  { id: 1001, name: "BABYMARUTCHI", stage: 2, isJade: false, isExternal: false, eyeX: 0, eyeY: 30, mouthX: 0, mouthY: 32, fieldType: 0 },
  { id: 2002, name: "LAND KID", stage: 3, isJade: false, isExternal: false, eyeX: 0, eyeY: 25, mouthX: 0, mouthY: 32, fieldType: 1 },
  { id: 2003, name: "WATER KID", stage: 3, isJade: false, isExternal: false, eyeX: 0, eyeY: 31, mouthX: 0, mouthY: 32, fieldType: 2 },
  { id: 2004, name: "SKY KID", stage: 3, isJade: false, isExternal: false, eyeX: 1, eyeY: 32, mouthX: 0, mouthY: 32, fieldType: 3 },
  { id: 2069, name: "FOREST KID", stage: 3, isJade: true, isExternal: false, eyeX: 1, eyeY: 32, mouthX: 0, mouthY: 32, fieldType: 4 },
  { id: 3005, name: "ROAR YOUNG", stage: 4, isJade: false, isExternal: false, eyeX: 0, eyeY: 17, mouthX: 0, mouthY: 16, fieldType: 1 },
  { id: 3006, name: "TODDLE YOUNG", stage: 4, isJade: false, isExternal: false, eyeX: 0, eyeY: 24, mouthX: 0, mouthY: 32, fieldType: 1 },
  { id: 3007, name: "LICK YOUNG", stage: 4, isJade: false, isExternal: false, eyeX: -1, eyeY: 18, mouthX: 1, mouthY: 24, fieldType: 1 },
  { id: 3008, name: "SPROUT YOUNG", stage: 4, isJade: false, isExternal: false, eyeX: 0, eyeY: 29, mouthX: 0, mouthY: 32, fieldType: 1 },
  { id: 3009, name: "GLIDE YOUNG", stage: 4, isJade: false, isExternal: false, eyeX: -3, eyeY: 30, mouthX: -3, mouthY: 32, fieldType: 2 },
  { id: 3010, name: "LEAP YOUNG", stage: 4, isJade: false, isExternal: false, eyeX: -3, eyeY: 26, mouthX: -3, mouthY: 28, fieldType: 2 },
  { id: 3011, name: "PADDLE YOUNG", stage: 4, isJade: false, isExternal: false, eyeX: -3, eyeY: 30, mouthX: -3, mouthY: 32, fieldType: 2 },
  { id: 3012, name: "FLOAT YOUNG", stage: 4, isJade: false, isExternal: false, eyeX: 0, eyeY: 17, mouthX: 0, mouthY: 19, fieldType: 2 },
  { id: 3013, name: "FLAP YOUNG", stage: 4, isJade: false, isExternal: false, eyeX: 0, eyeY: 17, mouthX: 0, mouthY: 19, fieldType: 3 },
  { id: 3014, name: "CHIRP  YOUNG", stage: 4, isJade: false, isExternal: false, eyeX: 0, eyeY: 15, mouthX: 0, mouthY: 17, fieldType: 3 },
  { id: 3015, name: "BUMBLE YOUNG", stage: 4, isJade: false, isExternal: false, eyeX: -1, eyeY: 28, mouthX: -1, mouthY: 30, fieldType: 3 },
  { id: 3016, name: "ROCKY YOUNG", stage: 4, isJade: false, isExternal: false, eyeX: 1, eyeY: 25, mouthX: 1, mouthY: 27, fieldType: 3 },
  { id: 3070, name: "FOREST ROAR YOUNG", stage: 4, isJade: true, isExternal: false, eyeX: 0, eyeY: 17, mouthX: 0, mouthY: 16, fieldType: 4 },
  { id: 3071, name: "FOREST TODDLE YOUNG", stage: 4, isJade: true, isExternal: false, eyeX: 0, eyeY: 24, mouthX: 0, mouthY: 32, fieldType: 4 },
  { id: 3072, name: "FOREST CHIRP YOUNG", stage: 4, isJade: true, isExternal: false, eyeX: 0, eyeY: 15, mouthX: 0, mouthY: 17, fieldType: 4 },
  { id: 3073, name: "FOREST SPROUT YOUNG", stage: 4, isJade: true, isExternal: false, eyeX: 0, eyeY: 29, mouthX: 0, mouthY: 32, fieldType: 4 },
  { id: 4017, name: "BBMARUTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 24, mouthX: 0, mouthY: 32, fieldType: 0 },
  { id: 4018, name: "MEOWTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 20, mouthX: 0, mouthY: 20, fieldType: 1 },
  { id: 4019, name: "POCHITCHI", stage: 5, isJade: false, isExternal: false, eyeX: -1, eyeY: 7, mouthX: 0, mouthY: 16, fieldType: 1 },
  { id: 4020, name: "GUMAX", stage: 5, isJade: false, isExternal: false, eyeX: 1, eyeY: 10, mouthX: 0, mouthY: 15, fieldType: 1 },
  { id: 4021, name: "RATCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 15, mouthX: 0, mouthY: 15, fieldType: 1 },
  { id: 4022, name: "MAMETCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 20, mouthX: 0, mouthY: 20, fieldType: 1 },
  { id: 4023, name: "MIMITCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 23, mouthX: 0, mouthY: 24, fieldType: 1 },
  { id: 4024, name: "MOLMOTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 1, eyeY: 8, mouthX: 0, mouthY: 12, fieldType: 1 },
  { id: 4025, name: "SHEEPTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 19, mouthX: 0, mouthY: 25, fieldType: 1 },
  { id: 4026, name: "SEBIRETCHI", stage: 5, isJade: false, isExternal: false, eyeX: -3, eyeY: 12, mouthX: 0, mouthY: 23, fieldType: 1 },
  { id: 4027, name: "LEOPATCHI", stage: 5, isJade: false, isExternal: false, eyeX: -5, eyeY: 9, mouthX: 0, mouthY: 18, fieldType: 1 },
  { id: 4028, name: "ELIZARDOTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 20, mouthX: 0, mouthY: 25, fieldType: 1 },
  { id: 4029, name: "HEAVYTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 18, mouthX: 0, mouthY: 25, fieldType: 1 },
  { id: 4030, name: "FURAWATCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 18, mouthX: 0, mouthY: 19, fieldType: 1 },
  { id: 4031, name: "TUSTUSTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 1, eyeY: 12, mouthX: 0, mouthY: 16, fieldType: 1 },
  { id: 4032, name: "POTSUNENTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 27, mouthX: 0, mouthY: 28, fieldType: 1 },
  { id: 4033, name: "SHIGEMI-SAN", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 35, mouthX: 0, mouthY: 36, fieldType: 1 },
  { id: 4034, name: "IRUKATCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 13, mouthX: 0, mouthY: 14, fieldType: 2 },
  { id: 4035, name: "KAMETCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 26, mouthX: 0, mouthY: 30, fieldType: 2 },
  { id: 4036, name: "BEAVERTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 1, eyeY: 11, mouthX: 0, mouthY: 12, fieldType: 2 },
  { id: 4037, name: "KUJIRATCHI", stage: 5, isJade: false, isExternal: false, eyeX: 1, eyeY: 24, mouthX: 0, mouthY: 32, fieldType: 2 },
  { id: 4038, name: "AXOLOPATCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 22, mouthX: 0, mouthY: 23, fieldType: 2 },
  { id: 4039, name: "IMORITCHI", stage: 5, isJade: false, isExternal: false, eyeX: -5, eyeY: 11, mouthX: -5, mouthY: 13, fieldType: 2 },
  { id: 4040, name: "KAWAZUTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 10, mouthX: 0, mouthY: 13, fieldType: 2 },
  { id: 4041, name: "URUOTCHI", stage: 5, isJade: false, isExternal: false, eyeX: -2, eyeY: 26, mouthX: 0, mouthY: 34, fieldType: 2 },
  { id: 4042, name: "TACHUTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 14, mouthX: 0, mouthY: 15, fieldType: 2 },
  { id: 4043, name: "SHARKTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 14, mouthX: 0, mouthY: 19, fieldType: 2 },
  { id: 4044, name: "ANKOTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 23, mouthX: 0, mouthY: 33, fieldType: 2 },
  { id: 4045, name: "OTOTOTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 19, mouthX: 0, mouthY: 21, fieldType: 2 },
  { id: 4046, name: "KURARATCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 3, mouthX: 0, mouthY: 3, fieldType: 2 },
  { id: 4047, name: "MENDAKOTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 26, mouthX: 0, mouthY: 25, fieldType: 2 },
  { id: 4048, name: "AMEFURATCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 12, mouthX: 0, mouthY: 18, fieldType: 2 },
  { id: 4049, name: "GUSOKUTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 34, mouthX: 0, mouthY: 35, fieldType: 2 },
  { id: 4050, name: "HORHOTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 15, mouthX: 0, mouthY: 15, fieldType: 3 },
  { id: 4051, name: "MONGATCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 13, mouthX: 0, mouthY: 15, fieldType: 3 },
  { id: 4052, name: "EAGLETCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 12, mouthX: 0, mouthY: 21, fieldType: 3 },
  { id: 4053, name: "BATCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 26, mouthX: 0, mouthY: 29, fieldType: 3 },
  { id: 4054, name: "PAPILLOTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 20, mouthX: 0, mouthY: 23, fieldType: 3 },
  { id: 4055, name: "KABUTOTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 15, mouthX: 0, mouthY: 15, fieldType: 3 },
  { id: 4056, name: "TENTOTCHI", stage: 5, isJade: false, isExternal: false, eyeX: -1, eyeY: 15, mouthX: 0, mouthY: 23, fieldType: 3 },
  { id: 4057, name: "HATCHITCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 11, mouthX: 0, mouthY: 16, fieldType: 3 },
  { id: 4058, name: "KUCHIPATCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 9, mouthX: 0, mouthY: 11, fieldType: 3 },
  { id: 4059, name: "BATATCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 14, mouthX: 0, mouthY: 18, fieldType: 3 },
  { id: 4060, name: "PEACOTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 21, mouthX: 0, mouthY: 27, fieldType: 3 },
  { id: 4061, name: "KIWITCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 7, mouthX: 0, mouthY: 13, fieldType: 3 },
  { id: 4062, name: "GEMTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 24, mouthX: 0, mouthY: 25, fieldType: 3 },
  { id: 4063, name: "ORETATCHI", stage: 5, isJade: false, isExternal: false, eyeX: -9, eyeY: 13, mouthX: 0, mouthY: 18, fieldType: 3 },
  { id: 4064, name: "ISHIKOROTCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 19, mouthX: 0, mouthY: 22, fieldType: 3 },
  { id: 4065, name: "MAGMATCHI", stage: 5, isJade: false, isExternal: false, eyeX: 0, eyeY: 21, mouthX: 0, mouthY: 24, fieldType: 3 },
  { id: 4066, name: "CHODRACOTCHI", stage: 5, isJade: false, isExternal: false, eyeX: -1, eyeY: 15, mouthX: 0, mouthY: 18, fieldType: 1 },
  { id: 4067, name: "MERMARINTCHI", stage: 5, isJade: false, isExternal: false, eyeX: -1, eyeY: 5, mouthX: 0, mouthY: 8, fieldType: 2 },
  { id: 4068, name: "YAYACORNTCHI", stage: 5, isJade: false, isExternal: false, eyeX: -1, eyeY: 26, mouthX: 0, mouthY: 29, fieldType: 3 },
  { id: 4074, name: "FOREST HORHOTCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 15, mouthX: 0, mouthY: 15, fieldType: 4 },
  { id: 4075, name: "KONKOTCHI", stage: 5, isJade: true, isExternal: false, eyeX: -3, eyeY: 8, mouthX: 0, mouthY: 16, fieldType: 4 },
  { id: 4076, name: "TIGAOTCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 26, mouthX: 0, mouthY: 29, fieldType: 4 },
  { id: 4077, name: "TANOONTCHI", stage: 5, isJade: true, isExternal: false, eyeX: -4, eyeY: 14, mouthX: 0, mouthY: 16, fieldType: 4 },
  { id: 4078, name: "LESSAPANTCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 20, mouthX: 0, mouthY: 20, fieldType: 4 },
  { id: 4079, name: "KANOKOTCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 20, mouthX: 0, mouthY: 25, fieldType: 4 },
  { id: 4080, name: "SUIGYUTCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 16, mouthX: 0, mouthY: 23, fieldType: 4 },
  { id: 4081, name: "PANBOOTCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 19, mouthX: 0, mouthY: 24, fieldType: 4 },
  { id: 4082, name: "KACHITCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 13, mouthX: 0, mouthY: 12, fieldType: 4 },
  { id: 4083, name: "TOKIPATCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 10, mouthX: 0, mouthY: 12, fieldType: 4 },
  { id: 4084, name: "KUCHIPATCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 9, mouthX: 0, mouthY: 11, fieldType: 4 },
  { id: 4085, name: "SPARROTCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 12, mouthX: 0, mouthY: 13, fieldType: 4 },
  { id: 4086, name: "SHIITAKETCHI", stage: 5, isJade: true, isExternal: false, eyeX: 1, eyeY: 25, mouthX: 0, mouthY: 24, fieldType: 4 },
  { id: 4087, name: "PEATCHI", stage: 5, isJade: true, isExternal: false, eyeX: 1, eyeY: 24, mouthX: 0, mouthY: 24, fieldType: 4 },
  { id: 4088, name: "NAPPATCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 27, mouthX: 0, mouthY: 32, fieldType: 4 },
  { id: 4089, name: "RUSHRADITCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 19, mouthX: 0, mouthY: 22, fieldType: 4 },
  { id: 4090, name: "TATSUTCHI", stage: 5, isJade: true, isExternal: false, eyeX: 0, eyeY: 9, mouthX: 0, mouthY: 11, fieldType: 4 },
  { id: 60100, name: "MEERTCHI", stage: 5, isJade: false, isExternal: true, eyeX: -3, eyeY: 11, mouthX: -3, mouthY: 13, fieldType: 0 },
  { id: 60101, name: "SHYONTCHI", stage: 5, isJade: false, isExternal: true, eyeX: -3, eyeY: 14, mouthX: -3, mouthY: 17, fieldType: 0 },
  { id: 60102, name: "POOPTCHI", stage: 5, isJade: false, isExternal: true, eyeX: 0, eyeY: 18, mouthX: 0, mouthY: 19, fieldType: 0 },
  { id: 60103, name: "OMARUTCHI", stage: 5, isJade: false, isExternal: true, eyeX: -5, eyeY: 19, mouthX: -5, mouthY: 19, fieldType: 0 },
  { id: 60104, name: "KOALABUTCHI", stage: 5, isJade: false, isExternal: true, eyeX: -1, eyeY: 19, mouthX: 0, mouthY: 17, fieldType: 0 },
  { id: 60105, name: "PLATYPUTCHI", stage: 5, isJade: false, isExternal: true, eyeX: -2, eyeY: 9, mouthX: 0, mouthY: 17, fieldType: 0 },
];

const BY_ID: ReadonlyMap<number, CharacterEntry> = new Map(
  CHARACTERS.map((c) => [c.id, c])
);

const BY_NAME: ReadonlyMap<string, CharacterEntry> = new Map(
  CHARACTERS.map((c) => [c.name.toUpperCase(), c])
);

/** Look up a character by its Paradise ID (0 if unknown returns undefined). */
export function getCharacter(id: number): CharacterEntry | undefined {
  return BY_ID.get(id);
}

/** Look up a character by its name (case-insensitive). */
export function getCharacterByName(name: string): CharacterEntry | undefined {
  return BY_NAME.get(name.toUpperCase());
}

/** Convenience: the eye/mouth offsets in pixels, or (0,0) if the id is unknown. */
export function getEyeOffset(id: number): { x: number; y: number } {
  const c = BY_ID.get(id);
  return c ? { x: c.eyeX, y: c.eyeY } : { x: 0, y: 0 };
}

export function getMouthOffset(id: number): { x: number; y: number } {
  const c = BY_ID.get(id);
  return c ? { x: c.mouthX, y: c.mouthY } : { x: 0, y: 0 };
}
