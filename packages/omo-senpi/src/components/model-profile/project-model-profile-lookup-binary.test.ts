/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { delimiter, join } from "node:path"

import { testTempDir } from "../../../test-support/temp-dir"

import * as ownerHomeLookup from "./owner-home-lookup"

// Which getent or id the passwd lookup runs: it is chosen before the folder is trusted, so a binary the folder ships
// must never be the one that runs.
describe("project model_profile RPC owner lookup binary (#13209, #13292)", () => {
  test("#given NixOS keeps getent in its system profile #when the lookup binary is searched #then the NixOS system directories are searched before PATH", () => {
    expect(ownerHomeLookup.SYSTEM_BIN_DIRS).toEqual(
      expect.arrayContaining(["/run/current-system/sw/bin", "/nix/var/nix/profiles/default/bin"]),
    )
  })

  test.skipIf(process.platform === "win32")(
    "#given no system getent and absolute PATH entries inside the checked folder, through a symlink, and inside the session folder, each holding a planted getent #when the default runner looks the uid up #then only the getent outside both folders runs",
    () => {
      const plant = (directory: string, marker: string, home: string) => {
        mkdirSync(directory, { recursive: true })
        const planted = join(directory, "getent")
        writeFileSync(planted, `#!/bin/sh\necho ran > "${marker}"\necho "x:x:0:0::${home}:/bin/sh"\n`)
        chmodSync(planted, 0o755)
      }
      const checked = realpathSync(testTempDir("omo-owner-lookup-checked-"))
      const session = realpathSync(testTempDir("omo-owner-lookup-session-"))
      const outside = realpathSync(testTempDir("omo-owner-lookup-outside-"))
      const markers = {
        checked: join(outside, "checked-ran"),
        session: join(outside, "session-ran"),
        tool: join(outside, "tool-ran"),
      }
      plant(join(checked, "bin"), markers.checked, "/planted")
      plant(join(session, "node_modules", ".bin"), markers.session, "/planted")
      plant(join(outside, "tools"), markers.tool, "/outside")
      const linked = join(outside, "linked-bin")
      symlinkSync(join(checked, "bin"), linked)
      const previousPath = process.env.PATH
      const previousCwd = process.cwd()
      process.env.PATH = [
        linked,
        join(checked, "bin"),
        join(session, "node_modules", ".bin"),
        join(outside, "tools"),
      ].join(delimiter)
      process.chdir(session)
      let entry: string | null
      try {
        entry = ownerHomeLookup.runPasswdLookup(424268, {
          platform: "linux",
          systemBinDirs: [],
          untrustedFolders: [checked],
        })
      } finally {
        process.chdir(previousCwd)
        if (previousPath === undefined) delete process.env.PATH
        else process.env.PATH = previousPath
      }

      expect(entry).toBe("x:x:0:0::/outside:/bin/sh\n")
      expect(existsSync(markers.tool)).toBe(true)
      expect(existsSync(markers.checked)).toBe(false)
      expect(existsSync(markers.session)).toBe(false)
    },
  )

  test.skipIf(process.platform === "win32")(
    "#given trusted PATH directories holding getent file symlinks into the checked folder, into the session folder, and to a binary outside both #when the default runner looks the uid up #then neither linked folder binary runs and the outside one still does",
    () => {
      const plant = (directory: string, marker: string, home: string) => {
        mkdirSync(directory, { recursive: true })
        const planted = join(directory, "getent")
        writeFileSync(planted, `#!/bin/sh\necho ran > "${marker}"\necho "x:x:0:0::${home}:/bin/sh"\n`)
        chmodSync(planted, 0o755)
        return planted
      }
      const checked = realpathSync(testTempDir("omo-owner-lookup-file-checked-"))
      const session = realpathSync(testTempDir("omo-owner-lookup-file-session-"))
      const outside = realpathSync(testTempDir("omo-owner-lookup-file-outside-"))
      const markers = {
        checked: join(outside, "checked-ran"),
        session: join(outside, "session-ran"),
        tool: join(outside, "tool-ran"),
      }
      const targets = [
        plant(join(checked, "bin"), markers.checked, "/planted"),
        plant(join(session, "node_modules", ".bin"), markers.session, "/planted"),
        plant(join(outside, "system"), markers.tool, "/outside"),
      ]
      const trustedDirs = targets.map((target, index) => {
        const directory = join(outside, `trusted-${index}`)
        mkdirSync(directory)
        symlinkSync(target, join(directory, "getent"))
        return directory
      })
      const previousPath = process.env.PATH
      const previousCwd = process.cwd()
      process.env.PATH = trustedDirs.join(delimiter)
      process.chdir(session)
      let entry: string | null
      try {
        entry = ownerHomeLookup.runPasswdLookup(424269, {
          platform: "linux",
          systemBinDirs: [],
          untrustedFolders: [checked],
        })
      } finally {
        process.chdir(previousCwd)
        if (previousPath === undefined) delete process.env.PATH
        else process.env.PATH = previousPath
      }

      expect(entry).toBe("x:x:0:0::/outside:/bin/sh\n")
      expect(existsSync(markers.tool)).toBe(true)
      expect(existsSync(markers.checked)).toBe(false)
      expect(existsSync(markers.session)).toBe(false)
    },
  )

  test.skipIf(process.platform === "win32")(
    "#given PATH holds only a relative entry and the session folder ships its own getent and id #when the default runner looks this account up #then the planted binaries never run",
    () => {
      const work = realpathSync(testTempDir("omo-owner-lookup-planted-"))
      const marker = join(work, "planted-ran")
      for (const name of ["getent", "id"]) {
        const planted = join(work, name)
        writeFileSync(planted, `#!/bin/sh\necho ran > "${marker}"\necho "x:x:0:0::/planted:/bin/sh"\n`)
        chmodSync(planted, 0o755)
      }
      const previousPath = process.env.PATH
      const previousCwd = process.cwd()
      process.env.PATH = "."
      process.chdir(work)
      try {
        ownerHomeLookup.runPasswdLookup(process.getuid?.() ?? 0)
      } catch {
        // A host without the system lookup binary fails the lookup; only whether the planted copy ran matters here.
      } finally {
        process.chdir(previousCwd)
        if (previousPath === undefined) delete process.env.PATH
        else process.env.PATH = previousPath
      }

      expect(existsSync(marker)).toBe(false)
    },
  )
})
