import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// packages/shared-skills/skills/visual-qa/scripts/cli.ts
import { readFileSync } from "node:fs";

// packages/shared-skills/skills/visual-qa/scripts/image-diff.ts
var GRID_SIZE = 8;
function round4(value) {
  return Math.round(value * 1e4) / 1e4;
}
function pixelsDiffer(ref, refOffset, act, actOffset) {
  return ref[refOffset] !== act[actOffset] || ref[refOffset + 1] !== act[actOffset + 1] || ref[refOffset + 2] !== act[actOffset + 2] || ref[refOffset + 3] !== act[actOffset + 3];
}
function buildHotspots(cellDiff, cellTotal, cols, rows, overlapWidth, overlapHeight) {
  const hotspots = [];
  for (let gridY = 0;gridY < rows; gridY++) {
    for (let gridX = 0;gridX < cols; gridX++) {
      const index = gridY * cols + gridX;
      const diff = cellDiff[index] ?? 0;
      const total = cellTotal[index] ?? 0;
      if (diff === 0 || total === 0)
        continue;
      const left = Math.floor(gridX * overlapWidth / cols);
      const right = Math.floor((gridX + 1) * overlapWidth / cols);
      const top = Math.floor(gridY * overlapHeight / rows);
      const bottom = Math.floor((gridY + 1) * overlapHeight / rows);
      hotspots.push({
        gridX,
        gridY,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        diffRatio: round4(diff / total)
      });
    }
  }
  hotspots.sort((a, b) => b.diffRatio - a.diffRatio);
  return hotspots;
}
function buildSummary(similarityScore, diffPixels, totalPixels, dimensionsMatch, hotspotCount) {
  const parts = [`${similarityScore}/100 similarity`, `${diffPixels}/${totalPixels} pixels differ`];
  if (!dimensionsMatch)
    parts.push("dimensions differ");
  if (hotspotCount > 0)
    parts.push(`${hotspotCount} hotspot region(s)`);
  return `${parts.join("; ")}.`;
}
function diffImages(reference, actual) {
  const overlapWidth = Math.min(reference.width, actual.width);
  const overlapHeight = Math.min(reference.height, actual.height);
  const totalPixels = overlapWidth * overlapHeight;
  const cols = Math.max(1, Math.min(GRID_SIZE, overlapWidth));
  const rows = Math.max(1, Math.min(GRID_SIZE, overlapHeight));
  const cellDiff = new Array(cols * rows).fill(0);
  const cellTotal = new Array(cols * rows).fill(0);
  let diffPixels = 0;
  for (let y = 0;y < overlapHeight; y++) {
    const cellY = Math.min(rows - 1, Math.floor(y * rows / overlapHeight));
    for (let x = 0;x < overlapWidth; x++) {
      const cellX = Math.min(cols - 1, Math.floor(x * cols / overlapWidth));
      const cellIndex = cellY * cols + cellX;
      cellTotal[cellIndex] = (cellTotal[cellIndex] ?? 0) + 1;
      const refOffset = (y * reference.width + x) * 4;
      const actOffset = (y * actual.width + x) * 4;
      if (pixelsDiffer(reference.rgba, refOffset, actual.rgba, actOffset)) {
        diffPixels++;
        cellDiff[cellIndex] = (cellDiff[cellIndex] ?? 0) + 1;
      }
    }
  }
  const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  const similarityScore = Math.round((1 - diffRatio) * 100);
  const hotspots = buildHotspots(cellDiff, cellTotal, cols, rows, overlapWidth, overlapHeight);
  const dimensionsMatch = reference.width === actual.width && reference.height === actual.height;
  const alphaChannelIntact = !(reference.hasTransparentPixels && !actual.hasTransparentPixels);
  return {
    command: "image-diff",
    dimensionsMatch,
    reference: { width: reference.width, height: reference.height },
    actual: { width: actual.width, height: actual.height },
    totalPixels,
    diffPixels,
    diffRatio: round4(diffRatio),
    similarityScore,
    alphaChannelIntact,
    hotspots,
    summary: buildSummary(similarityScore, diffPixels, totalPixels, dimensionsMatch, hotspots.length)
  };
}

// packages/shared-skills/skills/visual-qa/scripts/png-decode.ts
import { Buffer as Buffer2 } from "node:buffer";
import { inflateSync } from "node:zlib";

// packages/shared-skills/skills/visual-qa/scripts/png-crc.ts
import { Buffer } from "node:buffer";
var PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0;n < 256; n++) {
    let c = n;
    for (let k = 0;k < 8; k++) {
      c = (c & 1) === 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}
var CRC_TABLE = buildCrcTable();

// packages/shared-skills/skills/visual-qa/scripts/png-decode.ts
class PngDecodeError extends Error {
  name = "PngDecodeError";
}
function readChunks(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length)
      break;
    chunks.push({ type, data: buffer.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4;
  }
  return chunks;
}
function channelsForColorType(colorType) {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw new PngDecodeError(`unsupported color type ${colorType}`);
  }
}
function parseHeader(data) {
  if (data.length < 13) {
    throw new PngDecodeError("invalid IHDR chunk length");
  }
  const colorType = data[9] ?? 0;
  return {
    width: data.readUInt32BE(0),
    height: data.readUInt32BE(4),
    bitDepth: data[8] ?? 0,
    colorType,
    channels: channelsForColorType(colorType)
  };
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc)
    return a;
  if (pb <= pc)
    return b;
  return c;
}
function unfilterRow(filterType, row, prev, bpp) {
  const out = Buffer2.alloc(row.length);
  for (let i = 0;i < row.length; i++) {
    const raw = row[i] ?? 0;
    const a = i >= bpp ? out[i - bpp] ?? 0 : 0;
    const b = prev ? prev[i] ?? 0 : 0;
    const c = i >= bpp && prev ? prev[i - bpp] ?? 0 : 0;
    switch (filterType) {
      case 0:
        out[i] = raw;
        break;
      case 1:
        out[i] = raw + a & 255;
        break;
      case 2:
        out[i] = raw + b & 255;
        break;
      case 3:
        out[i] = raw + (a + b >> 1) & 255;
        break;
      case 4:
        out[i] = raw + paeth(a, b, c) & 255;
        break;
      default:
        throw new PngDecodeError(`unsupported filter type ${filterType}`);
    }
  }
  return out;
}
function decodePixels(idat, width, height, bpp) {
  const inflated = inflateSync(idat);
  const rowBytes = width * bpp;
  if (inflated.length < height * (rowBytes + 1)) {
    throw new PngDecodeError("truncated image data");
  }
  const pixels = Buffer2.alloc(width * height * bpp);
  let prev = null;
  for (let y = 0;y < height; y++) {
    const rowStart = y * (rowBytes + 1);
    const filterType = inflated[rowStart] ?? 0;
    const filtered = inflated.subarray(rowStart + 1, rowStart + 1 + rowBytes);
    const row = unfilterRow(filterType, filtered, prev, bpp);
    row.copy(pixels, y * rowBytes);
    prev = row;
  }
  return pixels;
}
function normalizeToRgba(pixels, pixelCount, channels) {
  const rgba = new Uint8Array(pixelCount * 4);
  let hasTransparent = false;
  for (let i = 0;i < pixelCount; i++) {
    const src = i * channels;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 255;
    switch (channels) {
      case 1: {
        const v = pixels[src] ?? 0;
        r = v;
        g = v;
        b = v;
        break;
      }
      case 2: {
        const v = pixels[src] ?? 0;
        r = v;
        g = v;
        b = v;
        a = pixels[src + 1] ?? 255;
        break;
      }
      case 3: {
        r = pixels[src] ?? 0;
        g = pixels[src + 1] ?? 0;
        b = pixels[src + 2] ?? 0;
        break;
      }
      default: {
        r = pixels[src] ?? 0;
        g = pixels[src + 1] ?? 0;
        b = pixels[src + 2] ?? 0;
        a = pixels[src + 3] ?? 255;
      }
    }
    const dst = i * 4;
    rgba[dst] = r;
    rgba[dst + 1] = g;
    rgba[dst + 2] = b;
    rgba[dst + 3] = a;
    if (a < 255)
      hasTransparent = true;
  }
  return { rgba, hasTransparent };
}
function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new PngDecodeError("not a PNG file (bad signature)");
  }
  const chunks = readChunks(buffer);
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR");
  if (ihdr === undefined) {
    throw new PngDecodeError("missing IHDR chunk");
  }
  const header = parseHeader(ihdr.data);
  if (header.bitDepth !== 8) {
    throw new PngDecodeError(`unsupported bit depth ${header.bitDepth}`);
  }
  const idatChunks = chunks.filter((chunk) => chunk.type === "IDAT");
  if (idatChunks.length === 0) {
    throw new PngDecodeError("missing IDAT chunk");
  }
  const idat = Buffer2.concat(idatChunks.map((chunk) => chunk.data));
  const pixels = decodePixels(idat, header.width, header.height, header.channels);
  const normalized = normalizeToRgba(pixels, header.width * header.height, header.channels);
  return {
    width: header.width,
    height: header.height,
    rgba: normalized.rgba,
    hasAlphaChannel: header.colorType === 4 || header.colorType === 6,
    hasTransparentPixels: normalized.hasTransparent
  };
}

// packages/shared-skills/skills/visual-qa/scripts/ansi.ts
var ESC = String.fromCharCode(27);
var CSI = String.fromCharCode(155);
var ANSI_PATTERN = new RegExp(`[${ESC}${CSI}][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`, "g");
function stripAnsi(input) {
  return input.replace(ANSI_PATTERN, "");
}
function hasAnsi(input) {
  return stripAnsi(input) !== input;
}

// packages/shared-skills/skills/visual-qa/scripts/east-asian-width.ts
var ZERO_WIDTH_RANGES = [
  { start: 768, end: 879 },
  { start: 1155, end: 1161 },
  { start: 1425, end: 1469 },
  { start: 1552, end: 1562 },
  { start: 1611, end: 1631 },
  { start: 1648, end: 1648 },
  { start: 1750, end: 1756 },
  { start: 4448, end: 4607 },
  { start: 8203, end: 8207 },
  { start: 8234, end: 8238 },
  { start: 8288, end: 8292 },
  { start: 8400, end: 8447 },
  { start: 65056, end: 65071 },
  { start: 65279, end: 65279 }
];
var WIDE_RANGES = [
  { start: 4352, end: 4447 },
  { start: 8986, end: 8987 },
  { start: 11904, end: 12350 },
  { start: 12353, end: 13311 },
  { start: 13312, end: 19903 },
  { start: 19968, end: 40959 },
  { start: 40960, end: 42191 },
  { start: 43360, end: 43391 },
  { start: 44032, end: 55203 },
  { start: 63744, end: 64255 },
  { start: 65040, end: 65049 },
  { start: 65072, end: 65135 },
  { start: 65280, end: 65376 },
  { start: 65504, end: 65510 },
  { start: 110592, end: 110959 },
  { start: 127488, end: 127743 },
  { start: 127744, end: 129791 },
  { start: 131072, end: 262141 }
];
function inRanges(codePoint, ranges) {
  for (const range of ranges) {
    if (codePoint >= range.start && codePoint <= range.end) {
      return true;
    }
  }
  return false;
}
function charWidth(codePoint) {
  if (codePoint === 0)
    return 0;
  if (codePoint < 32)
    return 0;
  if (codePoint >= 127 && codePoint <= 159)
    return 0;
  if (inRanges(codePoint, ZERO_WIDTH_RANGES))
    return 0;
  if (inRanges(codePoint, WIDE_RANGES))
    return 2;
  return 1;
}
function stringWidth(text) {
  let total = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined)
      continue;
    total += charWidth(codePoint);
  }
  return total;
}

// packages/shared-skills/skills/visual-qa/scripts/tui-grid.ts
var BOX_DRAWING_START = 9472;
var BOX_DRAWING_END = 9599;
var MAX_WIDE_COLUMNS = 64;
function splitLines(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "")
    lines.pop();
  return lines;
}
function isFrameLine(plain) {
  for (const char of plain) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && codePoint >= BOX_DRAWING_START && codePoint <= BOX_DRAWING_END) {
      return true;
    }
  }
  return false;
}
function wideStartColumns(plain) {
  const columns = [];
  let column = 0;
  for (const char of plain) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined)
      continue;
    const width = charWidth(codePoint);
    if (width === 2)
      columns.push(column);
    column += width;
  }
  return columns;
}
function summarize(lineCount, maxWidth, expectedColumns, overflowCount, borderMisaligned, containsAnsi) {
  const parts = [`${lineCount} line(s)`, `max width ${maxWidth}/${expectedColumns}`];
  if (overflowCount > 0)
    parts.push(`${overflowCount} overflow line(s)`);
  if (borderMisaligned)
    parts.push("borders misaligned");
  if (containsAnsi)
    parts.push("contains ANSI");
  return `${parts.join("; ")}.`;
}
function checkTui(text, expectedColumns) {
  const lines = splitLines(text);
  const lineWidths = [];
  const overflowLines = [];
  const wideColumns = new Set;
  const frameWidths = new Set;
  for (let index = 0;index < lines.length; index++) {
    const plain = stripAnsi(lines[index] ?? "");
    const width = stringWidth(plain);
    lineWidths.push(width);
    if (expectedColumns > 0 && width > expectedColumns) {
      overflowLines.push({ line: index + 1, width });
    }
    if (isFrameLine(plain))
      frameWidths.add(width);
    for (const column of wideStartColumns(plain)) {
      if (wideColumns.size < MAX_WIDE_COLUMNS)
        wideColumns.add(column);
    }
  }
  const maxWidth = lineWidths.reduce((max, width) => width > max ? width : max, 0);
  const borderMisaligned = frameWidths.size > 1;
  const containsAnsi = hasAnsi(text);
  return {
    command: "tui-check",
    expectedColumns,
    lineCount: lines.length,
    lineWidths,
    maxWidth,
    overflowLines,
    borderMisaligned,
    wideCharColumns: [...wideColumns].sort((a, b) => a - b),
    hasAnsi: containsAnsi,
    summary: summarize(lines.length, maxWidth, expectedColumns, overflowLines.length, borderMisaligned, containsAnsi)
  };
}

// packages/shared-skills/skills/visual-qa/scripts/cli.ts
class CliError extends Error {
  name = "CliError";
}
var DEFAULT_COLUMNS = 80;
var COLS_FLAG = "--cols";
function runImageDiff(args) {
  const referencePath = args[0];
  const actualPath = args[1];
  if (referencePath === undefined || actualPath === undefined) {
    throw new CliError("usage: image-diff <reference.png> <actual.png>");
  }
  const reference = decodePng(readFileSync(referencePath));
  const actual = decodePng(readFileSync(actualPath));
  return diffImages(reference, actual);
}
function parseColumns(args) {
  for (let index = 0;index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === COLS_FLAG) {
      const parsed = Number(args[index + 1]);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new CliError(`${COLS_FLAG} requires a positive integer`);
      }
      return parsed;
    }
    if (arg.startsWith(`${COLS_FLAG}=`)) {
      const parsed = Number(arg.slice(COLS_FLAG.length + 1));
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new CliError(`${COLS_FLAG} requires a positive integer`);
      }
      return parsed;
    }
  }
  return DEFAULT_COLUMNS;
}
function runTuiCheck(args) {
  const capturePath = args[0];
  if (capturePath === undefined || capturePath.startsWith("--")) {
    throw new CliError("usage: tui-check <capture.txt> [--cols N]");
  }
  const text = readFileSync(capturePath, "utf8");
  return checkTui(text, parseColumns(args.slice(1)));
}
function run(argv) {
  const command = argv[0];
  const rest = argv.slice(1);
  switch (command) {
    case "image-diff":
      return runImageDiff(rest);
    case "tui-check":
      return runTuiCheck(rest);
    default:
      throw new CliError(`unknown command "${command ?? ""}"; expected "image-diff" or "tui-check"`);
  }
}
function main(argv) {
  try {
    const result = run(argv);
    process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`visual-qa error: ${message}
`);
    process.exitCode = 1;
  }
}
if (__require.main == __require.module) {
  main(process.argv.slice(2));
}
export {
  runTuiCheck,
  runImageDiff,
  run,
  CliError
};
