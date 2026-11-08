import { describe, expect, test } from "bun:test"

import {
  MAX_AGE_ENTRIES,
  probeTreeActivity,
  type AgeProbeEntry,
  type AgeProbeFs,
} from "./transient-age"

const CUTOFF = 1_000_000

type TreeSpec = Readonly<Record<string, { readonly mtimeMs?: number; readonly entries?: readonly string[] }>>

// The probe joins paths with `node:path`, which separates with a backslash on Windows, while this
// fixture keys its tree with forward slashes. Normalizing on lookup (and on what the recorder
// reports) keeps the fixture describing one tree on every platform instead of missing every
// lookup on Windows and reporting an unreadable mtime.
function posix(path: string): string {
  return path.replace(/\\/g, "/")
}

class RecordingAgeProbeFs implements AgeProbeFs {
  readonly listed: string[] = []
  readonly stated: string[] = []

  constructor(private readonly tree: TreeSpec) {}

  async list(path: string): Promise<readonly AgeProbeEntry[]> {
    const key = posix(path)
    this.listed.push(key)
    const node = this.tree[key]
    if (node?.entries === undefined) throw new Error(`ENOTDIR: ${key}`)
    return node.entries.map((name) => ({ name, directory: this.tree[`${key}/${name}`]?.entries !== undefined }))
  }

  async mtimeMs(path: string): Promise<number | undefined> {
    const key = posix(path)
    this.stated.push(key)
    return this.tree[key]?.mtimeMs
  }
}

function wideTree(width: number): TreeSpec {
  const entries: string[] = []
  const tree: Record<string, { mtimeMs?: number; entries?: readonly string[] }> = {}
  for (let index = 0; index < width; index += 1) {
    const name = `file-${index}`
    entries.push(name)
    tree[`/root/${name}`] = { mtimeMs: CUTOFF - 1 }
  }
  tree["/root"] = { mtimeMs: CUTOFF - 1, entries }
  return tree
}

describe("transient age probe", () => {
  test("#given a root whose own mtime already proves it active #when it is probed #then no directory is listed", async () => {
    const fs = new RecordingAgeProbeFs({
      "/root": { mtimeMs: CUTOFF + 1, entries: ["runtime"] },
      "/root/runtime": { mtimeMs: CUTOFF + 1, entries: [] },
    })

    expect(await probeTreeActivity("/root", CUTOFF, 6, fs)).toBe("active")
    expect({ listed: fs.listed, stated: fs.stated }).toEqual({ listed: [], stated: ["/root"] })
  })

  test("#given a stale root whose first fresh entry is the first one read #when it is probed #then the walk stops at that entry", async () => {
    const fs = new RecordingAgeProbeFs({
      "/root": { mtimeMs: CUTOFF - 10, entries: ["fresh", "stale"] },
      "/root/fresh": { mtimeMs: CUTOFF + 1 },
      "/root/stale": { mtimeMs: CUTOFF - 10 },
    })

    expect(await probeTreeActivity("/root", CUTOFF, 6, fs)).toBe("active")
    expect(fs.stated).toEqual(["/root", "/root/fresh"])
  })

  test("#given a tree whose every mtime is at or before the cutoff #when it is probed #then it reports idle", async () => {
    const fs = new RecordingAgeProbeFs({
      "/root": { mtimeMs: CUTOFF - 10, entries: ["runtime"] },
      "/root/runtime": { mtimeMs: CUTOFF, entries: [] },
    })

    expect(await probeTreeActivity("/root", CUTOFF, 6, fs)).toBe("idle")
  })

  test("#given a stale root whose only fresh write is a deep leaf #when it is probed #then it reports active", async () => {
    const fs = new RecordingAgeProbeFs({
      "/root": { mtimeMs: CUTOFF - 10, entries: ["runtime"] },
      "/root/runtime": { mtimeMs: CUTOFF - 10, entries: ["transcripts"] },
      "/root/runtime/transcripts": { mtimeMs: CUTOFF - 10, entries: ["stream-1"] },
      "/root/runtime/transcripts/stream-1": { mtimeMs: CUTOFF - 10, entries: ["transcript.jsonl"] },
      "/root/runtime/transcripts/stream-1/transcript.jsonl": { mtimeMs: CUTOFF + 1 },
    })

    expect(await probeTreeActivity("/root", CUTOFF, 6, fs)).toBe("active")
  })

  test("#given a fresh leaf below the depth bound #when it is probed #then the walk stops short and reports idle", async () => {
    const fs = new RecordingAgeProbeFs({
      "/root": { mtimeMs: CUTOFF - 10, entries: ["a"] },
      "/root/a": { mtimeMs: CUTOFF - 10, entries: ["b"] },
      "/root/a/b": { mtimeMs: CUTOFF + 1, entries: [] },
    })

    expect(await probeTreeActivity("/root", CUTOFF, 1, fs)).toBe("idle")
    expect(fs.listed).toEqual(["/root"])
  })

  test("#given a root with no readable mtime anywhere #when it is probed #then it reports unknown", async () => {
    const fs = new RecordingAgeProbeFs({})

    expect(await probeTreeActivity("/root", CUTOFF, 6, fs)).toBe("unknown")
  })

  test("#given more direct entries than the entry budget #when it is probed #then the walk stops at the budget", async () => {
    const fs = new RecordingAgeProbeFs(wideTree(MAX_AGE_ENTRIES + 50))

    expect(await probeTreeActivity("/root", CUTOFF, 6, fs)).toBe("idle")
    expect(fs.stated).toHaveLength(MAX_AGE_ENTRIES + 1)
  })
})
