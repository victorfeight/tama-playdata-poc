// Port of TAMA_NEW/TamaParadiseApp_licenses/.../Parsers/SpriteParser.cs (decoder only).
// Reads a Paradise sprite package (pointed to by the sprites[][] table in a ghost bin),
// decrypts/decompresses as needed, parses palettes (RGB565 -> RGBA), and renders each
// sprite to a plain RGBA Uint8ClampedArray. No DOM, no Canvas -- pure bytes in, pixels out.

export enum CompressionType {
  None = 0,
  Bytewise = 1,
  Wordwise = 2
}

export interface SpriteHeader {
  dataLength: number;
  hasTransparency: boolean;
  isEncrypted: boolean;
  compression: CompressionType;
  bpp: number;
  numSprites: number;
  spriteWidthPx: number;
  spriteHeightPx: number;
  offsetX: number; // signed
  offsetY: number;
  imageWidth: number; // sprites per row in a subimage
  imageHeight: number; // sprites per column
  numPalettes: number;
  transparentColorIndex: number;
  paletteOffset: number;
  pixelDataOffset: number;
  numSubimages: number;
}

export interface RgbaImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray; // RGBA, length = width * height * 4
}

export interface SpriteImage {
  header: SpriteHeader;
  // One RGBA image per palette, sized (numSubimages * imageWidth * spriteWidthPx) ×
  // (imageHeight * spriteHeightPx) -- a horizontal spritesheet of subimages.
  spritesheets: RgbaImage[];
  // First-frame convenience: renders only subimage 0 with palette 0.
  firstFrame: RgbaImage | undefined;
}

export function parseSpriteHeader(data: Uint8Array, offset = 0): SpriteHeader {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dataLength = view.getUint32(offset, true);
  const flags = view.getUint8(offset + 4);
  const bppEnum = view.getUint8(offset + 5);

  const hasTransparency = (flags & 0x04) !== 0;
  const isEncrypted = (flags & 0x80) !== 0;
  let compression = CompressionType.None;
  if ((flags & 0x20) !== 0) compression = CompressionType.Bytewise;
  else if ((flags & 0x40) !== 0) compression = CompressionType.Wordwise;

  const bppMap = [1, 2, 4, 8];
  const bpp = bppEnum < 4 ? bppMap[bppEnum]! : 16;

  const numSprites = view.getUint16(offset + 6, true);
  const spriteWidthPx = view.getUint8(offset + 8);
  const spriteHeightPx = view.getUint8(offset + 9);
  const offsetX = view.getInt8(offset + 10);
  const offsetY = view.getInt8(offset + 11);
  const imageWidth = view.getUint8(offset + 12);
  const imageHeight = view.getUint8(offset + 13);
  const numPalettes = view.getUint8(offset + 15);
  const transparentColorIndex = view.getUint16(offset + 16, true);
  const paletteOffset = view.getUint16(offset + 18, true);
  const pixelDataOffset = view.getUint16(offset + 20, true);

  const spritesPerSubimage = imageWidth * imageHeight;
  const numSubimages = spritesPerSubimage > 0 ? Math.floor(numSprites / spritesPerSubimage) : 0;

  return {
    dataLength,
    hasTransparency,
    isEncrypted,
    compression,
    bpp,
    numSprites,
    spriteWidthPx,
    spriteHeightPx,
    offsetX,
    offsetY,
    imageWidth,
    imageHeight,
    numPalettes,
    transparentColorIndex,
    paletteOffset,
    pixelDataOffset,
    numSubimages
  };
}

/**
 * Parse a sprite package that contains exactly ONE sprite image at offset 0
 * (the format embedded inside ghost bins -- each entry in the ghost's sprite
 * table points to a single SpriteHeader+data pair). This is the normal path
 * for playdate ghost rendering.
 */
export function parseSingleSpriteImage(spriteData: Uint8Array): SpriteImage {
  if (spriteData.length < 24) throw new Error("sprite data too small for header");
  return parseSpriteImageAt(spriteData, 0);
}

/**
 * Parse a Lab-item-format sprite package with a leading offset table followed
 * by multiple sprite images. Not used for ghost rendering; kept for completeness.
 */
export function parseSpritePackage(spriteData: Uint8Array): SpriteImage[] {
  if (spriteData.length < 4) throw new Error("sprite package too small");
  const view = new DataView(spriteData.buffer, spriteData.byteOffset, spriteData.byteLength);
  const firstImageOffset = view.getInt32(0, true);
  if (firstImageOffset < 4 || firstImageOffset > spriteData.length) {
    throw new Error(`invalid first image offset: ${firstImageOffset}`);
  }

  const imageOffsets: number[] = [firstImageOffset];
  for (let p = 4; p < firstImageOffset; p += 4) {
    imageOffsets.push(view.getInt32(p, true));
  }

  const images: SpriteImage[] = [];
  for (const imgOffset of imageOffsets) {
    if (imgOffset < 0 || imgOffset >= spriteData.length) continue;
    images.push(parseSpriteImageAt(spriteData, imgOffset));
  }
  return images;
}

function parseSpriteImageAt(spriteData: Uint8Array, imgOffset: number): SpriteImage {
  const header = parseSpriteHeader(spriteData, imgOffset);
  const paletteStart = imgOffset + header.paletteOffset;
  const pixelStart = imgOffset + header.pixelDataOffset;
  const dataEnd = Math.min(imgOffset + header.dataLength, spriteData.length);

  let palettes: Uint32Array[];
  if (header.bpp < 16) {
    const colorsPerPalette = 1 << header.bpp;
    const paletteData = spriteData.subarray(paletteStart, pixelStart);
    palettes = parsePalettes(paletteData, colorsPerPalette, header.numPalettes);
  } else {
    palettes = [new Uint32Array(0)];
  }

  const pixelData = spriteData.subarray(pixelStart, dataEnd);
  const pixelDataPerSprite = getPixelDataPerSprite(pixelData, header);

  const spritesheets: RgbaImage[] = palettes.map((palette) =>
    renderSpritesheet(pixelDataPerSprite, header, palette)
  );
  const firstFrame = spritesheets.length
    ? renderFirstFrame(pixelDataPerSprite, header, palettes[0]!)
    : undefined;
  return { header, spritesheets, firstFrame };
}

function parseRGB565(value: number): number {
  // Packed RGBA: r | g<<8 | b<<16 | a<<24 (little-endian-friendly Uint32).
  const r = Math.round(((value >> 11) & 0x1f) * 255 / 31);
  const g = Math.round(((value >> 5) & 0x3f) * 255 / 63);
  const b = Math.round((value & 0x1f) * 255 / 31);
  return (r | (g << 8) | (b << 16) | (0xff << 24)) >>> 0;
}

function parsePalettes(data: Uint8Array, colorsPerPalette: number, numPalettes: number): Uint32Array[] {
  const palettes: Uint32Array[] = [];
  for (let i = 0; i < numPalettes; i += 1) palettes.push(new Uint32Array(colorsPerPalette));

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let colorIndex = 0;
  for (let i = 0; i + 2 <= data.length; i += 2) {
    const value = view.getUint16(i, true);
    const rgba = parseRGB565(value);
    const paletteIndex = Math.floor(colorIndex / colorsPerPalette);
    const indexInPalette = colorIndex % colorsPerPalette;
    if (paletteIndex < numPalettes) {
      palettes[paletteIndex]![indexInPalette] = rgba;
    }
    colorIndex += 1;
  }
  return palettes;
}

function decrypt(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) out[i] = (data[i]! ^ 0x53) & 0xff;
  return out;
}

// Hard cap on decompressed output. Every Paradise sprite fits well under this;
// any control word demanding more is corrupt or we are parsing non-sprite data.
const MAX_DECOMPRESSED = 0x10000;

function decompressBytewise(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(MAX_DECOMPRESSED);
  let o = 0;
  let i = 0;
  while (i < data.length && o < MAX_DECOMPRESSED) {
    const control = data[i++]!;
    const topBit = control >> 7;
    const n = control & 0x7f;
    if (topBit === 1) {
      const end = Math.min(o + n, MAX_DECOMPRESSED);
      for (; o < end && i < data.length; o += 1) out[o] = data[i++]!;
    } else {
      if (i >= data.length) break;
      const value = data[i++]!;
      const end = Math.min(o + n, MAX_DECOMPRESSED);
      for (; o < end; o += 1) out[o] = value;
    }
  }
  return out.subarray(0, o);
}

function decompressWordwise(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(MAX_DECOMPRESSED);
  let o = 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let i = 0;
  while (i + 4 <= data.length && o + 4 <= MAX_DECOMPRESSED) {
    const control = view.getUint32(i, true);
    i += 4;
    const topBit = control >>> 31;
    const n = control & 0x0fffffff; // Bandai's mask
    if (n === 0) continue; // avoid stuck loops on zero-count control words
    if (topBit > 0) {
      const words = Math.min(n, Math.floor((data.length - i) / 4), Math.floor((MAX_DECOMPRESSED - o) / 4));
      for (let j = 0; j < words; j += 1) {
        out[o++] = data[i++]!;
        out[o++] = data[i++]!;
        out[o++] = data[i++]!;
        out[o++] = data[i++]!;
      }
    } else {
      if (i + 4 > data.length) break;
      const b0 = data[i++]!, b1 = data[i++]!, b2 = data[i++]!, b3 = data[i++]!;
      const words = Math.min(n, Math.floor((MAX_DECOMPRESSED - o) / 4));
      for (let j = 0; j < words; j += 1) {
        out[o++] = b0;
        out[o++] = b1;
        out[o++] = b2;
        out[o++] = b3;
      }
    }
  }
  return out.subarray(0, o);
}

function getPixelDataPerSprite(data: Uint8Array, header: SpriteHeader): Uint8Array[] {
  return header.compression === CompressionType.None
    ? getUncompressedPixelData(data, header)
    : getCompressedPixelData(data, header);
}

function getUncompressedPixelData(data: Uint8Array, header: SpriteHeader): Uint8Array[] {
  const result: Uint8Array[] = [];
  const bitsPerSprite = header.spriteWidthPx * header.spriteHeightPx * header.bpp;
  const bytesPerSprite = Math.ceil(bitsPerSprite / 8);

  for (let j = 0; j < header.numSprites; j += 1) {
    const start = bytesPerSprite * j;
    const end = Math.min(start + bytesPerSprite, data.length);
    const sprite = new Uint8Array(bytesPerSprite);
    sprite.set(data.subarray(start, end), 0);
    result.push(header.isEncrypted ? decrypt(sprite) : sprite);
  }
  return result;
}

function getCompressedPixelData(data: Uint8Array, header: SpriteHeader): Uint8Array[] {
  const result: Uint8Array[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  for (let i = 0; i < header.numSprites && offset + 8 <= data.length; i += 1) {
    const spriteOffset = view.getInt32(offset, true);
    const spriteLen = view.getInt32(offset + 4, true);
    offset += 8;
    if (spriteOffset < 0 || spriteOffset >= data.length) continue;
    const sprite = new Uint8Array(Math.max(0, spriteLen));
    sprite.set(data.subarray(spriteOffset, Math.min(spriteOffset + spriteLen, data.length)), 0);
    result.push(header.isEncrypted ? decrypt(sprite) : sprite);
  }
  return result;
}

function renderSprite(pixelData: Uint8Array, header: SpriteHeader, palette: Uint32Array): Uint32Array {
  let data = pixelData;
  if (header.compression === CompressionType.Bytewise) data = decompressBytewise(data);
  else if (header.compression === CompressionType.Wordwise) data = decompressWordwise(data);

  const width = header.spriteWidthPx;
  const height = header.spriteHeightPx;
  const rgba = new Uint32Array(width * height);
  const pixelCount = width * height;
  const bpp = header.bpp;
  const transparentIdx = header.transparentColorIndex;
  const hasTransparency = header.hasTransparency;
  const paletteMax = palette.length;

  // Walk the bit stream LSB-first. Each `bpp` consecutive bits -> palette index.
  const totalBits = data.length * 8;
  let pixelIndex = 0;
  for (let bitPos = 0; bitPos + bpp <= totalBits && pixelIndex < pixelCount; bitPos += bpp) {
    let paletteIndex = 0;
    for (let i = 0; i < bpp; i += 1) {
      const bitAbs = bitPos + i;
      const byte = data[bitAbs >> 3]!;
      const bit = (byte >> (bitAbs & 7)) & 1;
      paletteIndex |= bit << i;
    }
    let color: number;
    if (hasTransparency && paletteIndex === transparentIdx) {
      color = 0; // fully transparent (A=0)
    } else if (paletteIndex < paletteMax) {
      color = palette[paletteIndex]!;
    } else {
      color = 0xff_ff_00_ff; // magenta sentinel
    }
    rgba[pixelIndex] = color;
    pixelIndex += 1;
  }
  return rgba;
}

// Renders all subimages of a single palette into a horizontal spritesheet matching
// the C# MakeSpritesheet layout: numSubimages across × imageHeight*spriteHeight down.
function renderSpritesheet(
  perSprite: Uint8Array[],
  header: SpriteHeader,
  palette: Uint32Array
): RgbaImage {
  const spritesPerSubimage = header.imageWidth * header.imageHeight;
  const totalWidth = Math.max(1, header.numSubimages * header.imageWidth * header.spriteWidthPx);
  const totalHeight = Math.max(1, header.imageHeight * header.spriteHeightPx);
  const out = new Uint8ClampedArray(totalWidth * totalHeight * 4);

  for (let sub = 0; sub < header.numSubimages; sub += 1) {
    for (let local = 0; local < spritesPerSubimage; local += 1) {
      const globalIdx = sub * spritesPerSubimage + local;
      if (globalIdx >= perSprite.length) continue;
      const spritePixels = renderSprite(perSprite[globalIdx]!, header, palette);
      const localX = local % header.imageWidth;
      const localY = Math.floor(local / header.imageWidth);
      const destX = sub * header.imageWidth * header.spriteWidthPx + localX * header.spriteWidthPx;
      const destY = localY * header.spriteHeightPx;
      blitRgbaToRgbaBuffer(spritePixels, header.spriteWidthPx, header.spriteHeightPx, out, totalWidth, destX, destY);
    }
  }
  return { width: totalWidth, height: totalHeight, pixels: out };
}

// First-frame convenience: render just subimage 0 using palette 0.
function renderFirstFrame(
  perSprite: Uint8Array[],
  header: SpriteHeader,
  palette: Uint32Array
): RgbaImage | undefined {
  const spritesPerSubimage = header.imageWidth * header.imageHeight;
  if (spritesPerSubimage === 0) return undefined;
  const width = Math.max(1, header.imageWidth * header.spriteWidthPx);
  const height = Math.max(1, header.imageHeight * header.spriteHeightPx);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let local = 0; local < spritesPerSubimage && local < perSprite.length; local += 1) {
    const spritePixels = renderSprite(perSprite[local]!, header, palette);
    const localX = local % header.imageWidth;
    const localY = Math.floor(local / header.imageWidth);
    const destX = localX * header.spriteWidthPx;
    const destY = localY * header.spriteHeightPx;
    blitRgbaToRgbaBuffer(spritePixels, header.spriteWidthPx, header.spriteHeightPx, out, width, destX, destY);
  }
  return { width, height, pixels: out };
}

function blitRgbaToRgbaBuffer(
  srcRgba: Uint32Array,
  srcWidth: number,
  srcHeight: number,
  dst: Uint8ClampedArray,
  dstWidth: number,
  destX: number,
  destY: number
): void {
  for (let y = 0; y < srcHeight; y += 1) {
    for (let x = 0; x < srcWidth; x += 1) {
      const color = srcRgba[y * srcWidth + x]!;
      const dstIndex = ((destY + y) * dstWidth + (destX + x)) * 4;
      dst[dstIndex + 0] = color & 0xff;
      dst[dstIndex + 1] = (color >> 8) & 0xff;
      dst[dstIndex + 2] = (color >> 16) & 0xff;
      dst[dstIndex + 3] = (color >> 24) & 0xff;
    }
  }
}
