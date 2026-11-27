// Reads zip archives (artifact downloads) and keeps every extracted path inside its target directory.
import { isAbsolute, relative, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import { SurfaceError } from "../vendor/surface/index.ts";

export type ZipEntry = { readonly path: string; readonly data: Uint8Array };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const ZIP64 = 0xffffffff;

const broken = (why: string): SurfaceError =>
  new SurfaceError(
    "invalid_response",
    `not a readable zip: ${why}`,
    "download it again; the archive may be truncated or use a feature this reader does not support",
  );

/** Where `name` lands under `dir`; a name that resolves outside `dir` is refused. */
export const safeJoin = (dir: string, name: string): string => {
  const root = resolve(dir);
  const target = resolve(root, name);
  const rel = relative(root, target);
  if (
    name.includes("\\") ||
    isAbsolute(name) ||
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  )
    throw new SurfaceError(
      "invalid_response",
      `refusing a path outside the target directory: ${name}`,
      "the archive or asset name is unsafe; inspect it before extracting",
    );
  return target;
};

/** The file entries of a zip (directories skipped), each checked against its stored size and CRC-32. */
export const unzip = (bytes: Uint8Array): ZipEntry[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fits = (at: number, size: number) => {
    if (at < 0 || at + size > bytes.length) throw broken("truncated");
  };
  const u16 = (at: number) => {
    fits(at, 2);
    return view.getUint16(at, true);
  };
  const u32 = (at: number) => {
    fits(at, 4);
    return view.getUint32(at, true);
  };
  const slice = (at: number, size: number) => {
    fits(at, size);
    return bytes.subarray(at, at + size);
  };

  let end = -1;
  for (
    let at = bytes.length - 22;
    at >= Math.max(0, bytes.length - 22 - 0xffff);
    at--
  )
    if (u32(at) === EOCD) {
      end = at;
      break;
    }
  if (end < 0) throw broken("no end-of-central-directory record");
  const count = u16(end + 10);
  let at = u32(end + 16);
  if (count === 0xffff || at === ZIP64) throw broken("zip64 is not supported");

  const names = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(at) !== CENTRAL) throw broken("bad central directory entry");
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const crc = u32(at + 16);
    const packed = u32(at + 20);
    const size = u32(at + 24);
    const nameLength = u16(at + 28);
    const local = u32(at + 42);
    const path = names.decode(slice(at + 46, nameLength));
    at += 46 + nameLength + u16(at + 30) + u16(at + 32);
    if (path.endsWith("/")) continue;
    if ((flags & 1) !== 0) throw broken(`${path} is encrypted`);
    if (packed === ZIP64 || size === ZIP64)
      throw broken("zip64 is not supported");
    if (u32(local) !== LOCAL) throw broken(`bad local header for ${path}`);
    const raw = slice(local + 30 + u16(local + 26) + u16(local + 28), packed);
    let data: Uint8Array;
    if (method === 0) data = raw;
    else if (method === 8)
      data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
    else throw broken(`${path} uses compression method ${method}`);
    if (data.length !== size || Bun.hash.crc32(data) !== crc)
      throw broken(`${path} fails its checksum`);
    entries.push({ path, data });
  }
  return entries;
};
