import { access, readFile, unlink, writeFile } from "node:fs/promises"

export interface BunFileLike {
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
  exists(): Promise<boolean>
  delete(): Promise<void>
}

type BunFileRuntime = {
  file(path: string): BunFileLike
  write(path: string, data: string | ArrayBuffer | Uint8Array): Promise<number>
}

const runtime = globalThis as typeof globalThis & { readonly Bun?: BunFileRuntime }

function byteLength(data: string | ArrayBuffer | Uint8Array): number {
  if (typeof data === "string") return Buffer.byteLength(data, "utf8")

  return data.byteLength
}

function toWritableData(data: string | ArrayBuffer | Uint8Array): string | Uint8Array {
  if (typeof data === "string") return data
  if (data instanceof Uint8Array) return data

  return new Uint8Array(data)
}

function createNodeFile(path: string): BunFileLike {
  return {
    text() {
      return readFile(path, "utf8")
    },
    async arrayBuffer() {
      const buffer = await readFile(path)

      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    },
    exists() {
      return access(path).then(
        () => true,
        () => false,
      )
    },
    delete() {
      return unlink(path)
    },
  }
}

export function bunFile(path: string): BunFileLike {
  const bun = runtime.Bun
  if (bun) return bun.file(path)

  return createNodeFile(path)
}

export async function bunWrite(path: string, data: string | ArrayBuffer | Uint8Array): Promise<number> {
  const bun = runtime.Bun
  if (bun) return bun.write(path, data)

  await writeFile(path, toWritableData(data))

  return byteLength(data)
}
