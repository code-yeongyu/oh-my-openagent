import { describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readLinuxBundle, selectLinuxBundle } from "../linux-trust-bundle"
import type { LinuxBundleFs, LinuxBundleStat } from "../linux-trust-bundle"

describe("selectLinuxBundle", () => {
  test.each([
    ["debian", "/etc/ssl/certs/ca-certificates.crt", "debian"],
    ["ubuntu", "/etc/ssl/certs/ca-certificates.crt", "debian"],
    ["alpine", "/etc/ssl/certs/ca-certificates.crt", "debian"],
    ["arch", "/etc/ssl/certs/ca-certificates.crt", "debian"],
    ["fedora", "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", "fedora"],
    ["rhel", "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", "fedora"],
    ["centos", "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", "fedora"],
    ["suse", "/etc/ssl/ca-bundle.pem", "suse"],
    ["opensuse", "/etc/ssl/ca-bundle.pem", "suse"],
    ["opensuse-leap", "/etc/ssl/ca-bundle.pem", "suse"],
    ["opensuse-tumbleweed", "/etc/ssl/ca-bundle.pem", "suse"],
    ["sles", "/etc/ssl/ca-bundle.pem", "suse"],
  ] as const)("#given ID %s #when selecting #then chooses %s", (id, path, family) => {
    const result = selectLinuxBundle(`ID=${id}`, null, () => true)
    expect(result).toEqual({ kind: "known", family, path })
  })

  test.each(["debian", "ubuntu", "alpine", "arch", "fedora", "rhel", "centos", "suse", "opensuse", "sles"])(
    "#given derivative ID_LIKE %s #when selecting #then uses the recognized family",
    (token) => {
      const [family, path] = ["fedora", "rhel", "centos"].includes(token)
        ? (["fedora", "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"] as const)
        : ["suse", "opensuse", "sles"].includes(token)
          ? (["suse", "/etc/ssl/ca-bundle.pem"] as const)
          : (["debian", "/etc/ssl/certs/ca-certificates.crt"] as const)
      const result = selectLinuxBundle(`ID=derivative\nID_LIKE="unrecognized ${token}"`, null, () => true)
      expect(result).toEqual({ kind: "known", family, path })
    },
  )

  test("#given opensuse-* only as an ID_LIKE token #when selecting #then it is not a SUSE match", () => {
    expect(selectLinuxBundle("ID=other\nID_LIKE=opensuse-leap", null, (path) => path === "/etc/ssl/cert.pem"))
      .toEqual({ kind: "unknown", family: "unknown", path: "/etc/ssl/cert.pem" })
  })

  test.each([
    ["an escaped backslash ends the line", "ID=x\\\\\nID_LIKE=fedora"],
    ["an odd trailing backslash continues the line", "ID=fed\\\nora"],
    ["trailing whitespace after the value", "ID=fedora \t"],
  ])("#given %s #when selecting #then parses like systemd", (_case, release) => {
    expect(selectLinuxBundle(release, null, () => true))
      .toEqual({ kind: "known", family: "fedora", path: "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem" })
  })

  test("#given ID and conflicting ID_LIKE #when selecting #then ID wins", () => {
    const result = selectLinuxBundle("ID=fedora\nID_LIKE=debian", null, () => true)
    expect(result).toEqual({ kind: "known", family: "fedora", path: "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem" })
  })

  test("#given ordered ID_LIKE #when selecting #then first recognized token wins", () => {
    const result = selectLinuxBundle('ID=other\nID_LIKE="unknown suse debian"', null, () => true)
    expect(result).toEqual({ kind: "known", family: "suse", path: "/etc/ssl/ca-bundle.pem" })
  })

  test.each([
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/etc/ssl/cert.pem",
  ])("#given unknown ID and first existing %s #when selecting #then returns that path", (path) => {
    const paths = [
      "/etc/ssl/certs/ca-certificates.crt",
      "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
      "/etc/pki/tls/certs/ca-bundle.crt",
      "/etc/ssl/ca-bundle.pem",
      "/etc/ssl/cert.pem",
    ]
    const existing = paths.slice(paths.indexOf(path))
    expect(selectLinuxBundle("ID=other", null, (candidate) => existing.includes(candidate)))
      .toEqual({ kind: "unknown", family: "unknown", path })
  })

  test("#given unknown ID and no bundle #when selecting #then returns unknown absence", () => {
    expect(selectLinuxBundle("ID=other", null, () => false))
      .toEqual({ kind: "linux-bundle-absent", family: "unknown", path: null })
  })

  test("#given absent known bundle and another family present #when selecting #then never falls back", () => {
    expect(selectLinuxBundle("ID=fedora", null, (path) => path === "/etc/ssl/certs/ca-certificates.crt"))
      .toEqual({ kind: "linux-bundle-absent", family: "fedora", path: "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem" })
  })

  test("#given missing primary os-release #when selecting #then uses fallback text", () => {
    expect(selectLinuxBundle(null, "ID=sles", () => true))
      .toEqual({ kind: "known", family: "suse", path: "/etc/ssl/ca-bundle.pem" })
  })

  test("#given empty primary os-release #when selecting #then does not merge fallback", () => {
    expect(selectLinuxBundle("", "ID=sles", (path) => path === "/etc/ssl/cert.pem"))
      .toEqual({ kind: "unknown", family: "unknown", path: "/etc/ssl/cert.pem" })
  })

  test.each(["ID='debian'", 'ID="debian"', "ID=debi\\an", '# ignored\nID="other"\nID_LIKE="unknown debian"'])(
    "#given quoted or escaped release %s #when selecting #then decodes shell-style values",
    (release) => {
      expect(selectLinuxBundle(release, null, () => true).path).toBe("/etc/ssl/certs/ca-certificates.crt")
    },
  )

  test("#given duplicate assignments #when selecting #then last assignment wins", () => {
    expect(selectLinuxBundle("ID=fedora\nID=ubuntu", null, () => true))
      .toEqual({ kind: "known", family: "debian", path: "/etc/ssl/certs/ca-certificates.crt" })
  })

  test.each(['ID="debi\\$an"', 'ID="debi\\"an"', "ID='debi\\an'", 'ID="debi\\an"'])(
    "#given non-family escaped value %s #when selecting #then does not misdecode a known family",
    (release) => {
      expect(selectLinuxBundle(release, null, (path) => path === "/etc/ssl/cert.pem"))
        .toEqual({ kind: "unknown", family: "unknown", path: "/etc/ssl/cert.pem" })
    },
  )
})

const metadata: LinuxBundleStat = { size: 3, mtimeMs: 1, ino: 2, dev: 3, isFile: () => true }

// A byte-stream fake: partial reads consume bytes, metadata changes are independent of reads.
function fixture(options: {
  readonly before?: LinuxBundleStat
  readonly after?: LinuxBundleStat
  readonly held?: LinuxBundleStat
  readonly bytes?: Uint8Array
  readonly unreadable?: boolean
}) {
  let stats = 0
  let offset = 0
  let closed = false
  let opened = false
  const bytes = options.bytes ?? new Uint8Array([1, 2, 3])
  const io: LinuxBundleFs = {
    async stat() {
      if (options.unreadable) throw new TypeError("permission denied")
      stats += 1
      return stats === 1 ? options.before ?? metadata : options.after ?? metadata
    },
    async open() {
      opened = true
      return {
        async read(buffer) {
          const length = Math.min(buffer.length, bytes.length - offset, 65536)
          buffer.set(bytes.subarray(offset, offset + length))
          offset += length
          return { bytesRead: length }
        },
        async stat() { return options.held ?? options.before ?? metadata },
        async close() { closed = true },
      }
    },
  }
  return { io, closed: () => closed, opened: () => opened, consumed: () => offset }
}

describe("readLinuxBundle", () => {
  test("#given readable bytes #when reading #then returns bytes and closes the handle", async () => {
    const fake = fixture({})
    const result = await readLinuxBundle("/bundle", fake.io)
    expect(result).toEqual({ kind: "success", path: "/bundle", bytes: new Uint8Array([1, 2, 3]) })
    expect(fake.closed()).toBe(true)
  })

  test("#given over-cap stat #when reading #then rejects before opening", async () => {
    const bytes = new Uint8Array(8 * 1024 * 1024 + 1)
    const stat = { ...metadata, size: bytes.length }
    const fake = fixture({ before: stat, after: stat, bytes })
    expect((await readLinuxBundle("/bundle", fake.io)).kind).toBe("linux-bundle-too-large")
    expect(fake.opened()).toBe(false)
  })

  test("#given growth beyond the stat size #when reading #then reads one byte past it and rejects", async () => {
    const fake = fixture({ bytes: new Uint8Array(8 * 1024 * 1024 + 2) })
    expect(await readLinuxBundle("/bundle", fake.io)).toEqual({ kind: "linux-bundle-replaced", path: "/bundle" })
    expect(fake.consumed()).toBe(metadata.size + 1)
    expect(fake.closed()).toBe(true)
  })

  test("#given fewer bytes than the unchanged stats report #when reading #then rejects", async () => {
    const fake = fixture({ bytes: new Uint8Array([1, 2]) })
    expect(await readLinuxBundle("/bundle", fake.io)).toEqual({ kind: "linux-bundle-replaced", path: "/bundle" })
  })

  test("#given a different object opened between matching path stats #when reading #then rejects", async () => {
    const fake = fixture({ held: { ...metadata, ino: metadata.ino + 1 } })
    expect(await readLinuxBundle("/bundle", fake.io)).toEqual({ kind: "linux-bundle-replaced", path: "/bundle" })
    expect(fake.closed()).toBe(true)
  })

  test("#given exact-cap bundle #when reading #then accepts the boundary", async () => {
    const bytes = new Uint8Array(8 * 1024 * 1024)
    const stat = { ...metadata, size: bytes.length }
    const fake = fixture({ before: stat, after: stat, bytes })
    const result = await readLinuxBundle("/bundle", fake.io)
    expect(result).toEqual({ kind: "success", path: "/bundle", bytes })
  })

  test.each(["size", "mtimeMs", "ino", "dev"] as const)(
    "#given replaced-between-stats %s #when reading #then rejects changed snapshot",
    async (field) => {
      const fake = fixture({ after: { ...metadata, [field]: metadata[field] + 1 } })
      expect(await readLinuxBundle("/bundle", fake.io)).toEqual({ kind: "linux-bundle-replaced", path: "/bundle" })
      expect(fake.closed()).toBe(true)
    },
  )

  test("#given unreadable path #when reading #then returns typed unreadable failure", async () => {
    const fake = fixture({ unreadable: true })
    expect(await readLinuxBundle("/bundle", fake.io)).toEqual({ kind: "linux-bundle-unreadable", path: "/bundle" })
  })

  test("#given directory #when reading #then rejects without opening", async () => {
    const fake = fixture({ before: { ...metadata, isFile: () => false } })
    expect(await readLinuxBundle("/bundle", fake.io)).toEqual({ kind: "linux-bundle-unreadable", path: "/bundle" })
    expect(fake.opened()).toBe(false)
  })

  // Linux-only module; Windows symlinks need a privilege CI runners do not grant.
  test.skipIf(process.platform === "win32")("#given normal symlink in a temp directory #when reading #then follows target bytes", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "linux-trust-bundle-"))
    try {
      const target = join(dir, "bundle.pem")
      const link = join(dir, "selected.pem")
      await fs.writeFile(target, "bundle bytes")
      await fs.symlink(target, link)
      const result = await readLinuxBundle(link, fs)
      expect(result).toEqual({ kind: "success", path: link, bytes: new TextEncoder().encode("bundle bytes") })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
