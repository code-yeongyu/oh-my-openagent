/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { userInfo } from "node:os"
import { join } from "node:path"

import { testTempDir } from "../../../test-support/temp-dir"
import * as projectModelProfileRpc from "./project-model-profile-rpc"
import { getProjectModelProfile, setProjectModelProfile } from "./project-model-profile-rpc"

const COMMENTED = `// project omo config
{
  // keep me
  "side_panel": { "enabled": true }
}
`

function folder(content?: string): string {
  const cwd = realpathSync(testTempDir("omo-project-model-profile-home-"))
  if (content !== undefined) {
    mkdirSync(join(cwd, ".omo"))
    writeFileSync(join(cwd, ".omo", "omo.jsonc"), content)
  }
  return cwd
}

const trusted = (cwd: string) => ({ cwd, isProjectTrusted: () => true })
const configText = (cwd: string) => readFileSync(join(cwd, ".omo", "omo.jsonc"), "utf8")

// The engine runs as another account than the one owning the folder (a root or service engine), so the owner's home is
// looked up; a folder this account owns needs no lookup.
function asAnotherAccount<T>(cwd: string, body: () => T): T {
  const original = process.getuid
  process.getuid = () => statSync(cwd).uid + 1
  try {
    return body()
  } finally {
    if (original === undefined) delete process.getuid
    else process.getuid = original
  }
}

describe("project model_profile RPC home-folder refusal (#13207, #13209)", () => {
  test("#given the session folder is HOME #when either verb runs #then it is refused and the user layer is untouched", () => {
    const home = folder(COMMENTED)
    const previous = process.env.HOME
    process.env.HOME = home
    try {
      expect(setProjectModelProfile(trusted(home), { modelProfile: "a/b" })).toMatchObject({
        kind: "refused",
        code: "home_folder",
      })
      expect(getProjectModelProfile(trusted(home))).toMatchObject({ kind: "refused", code: "home_folder" })
      expect(configText(home)).toBe(COMMENTED)
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
    }
  })

  test("#given HOME through an alias #when a pin is set #then it is refused as the home folder", () => {
    const home = folder(COMMENTED)
    const link = join(folder(), "home-link")
    symlinkSync(home, link)
    const previous = process.env.HOME
    process.env.HOME = home
    try {
      for (const cwd of [link, `${home}/`, join(home, "sub", "..")])
        expect(setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" })).toMatchObject({
          kind: "refused",
          code: "home_folder",
        })
      expect(configText(home)).toBe(COMMENTED)
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
    }
  })

  test("#given the account home while HOME points elsewhere #when a pin is set #then it is refused as the home folder", () => {
    const previous = process.env.HOME
    process.env.HOME = folder()
    try {
      expect(setProjectModelProfile(trusted(userInfo().homedir), { modelProfile: "a/b" })).toMatchObject({
        kind: "refused",
        code: "home_folder",
      })
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
    }
  })

  test("#given another account's home folder #when a pin is set #then it is refused and nothing is written", () => {
    const other = join(folder(), "someone-else")
    mkdirSync(join(other, ".omo"), { recursive: true })
    writeFileSync(join(other, ".omo", "omo.jsonc"), COMMENTED)

    const reply = asAnotherAccount(other, () =>
      setProjectModelProfile(trusted(other), { modelProfile: "a/b" }, { homeOfUid: () => other }),
    )

    expect(reply).toMatchObject({ kind: "refused", code: "home_folder" })
    expect(readFileSync(join(other, ".omo", "omo.jsonc"), "utf8")).toBe(COMMENTED)
  })

  test("#given the owner lookup fails for a folder beside this account's home #when a pin is set #then it is refused and nothing is written", () => {
    const accountsRoot = folder()
    const other = join(accountsRoot, "someone-else")
    mkdirSync(join(other, ".omo"), { recursive: true })
    writeFileSync(join(other, ".omo", "omo.jsonc"), COMMENTED)
    const deps = { homeOfUid: () => undefined, accountsRoot }

    const replies = asAnotherAccount(other, () => [
      setProjectModelProfile(trusted(other), { modelProfile: "a/b" }, deps),
      getProjectModelProfile(trusted(other), deps),
    ])

    for (const reply of replies) expect(reply).toMatchObject({ kind: "refused", code: "home_folder" })
    expect(readFileSync(join(other, ".omo", "omo.jsonc"), "utf8")).toBe(COMMENTED)
  })

  test("#given the owner lookup fails for a folder elsewhere #when a pin is set #then it is written", () => {
    const accountsRoot = folder()
    const work = join(folder(), "workspace")
    mkdirSync(work)

    const reply = asAnotherAccount(work, () =>
      setProjectModelProfile(trusted(work), { modelProfile: "a/b" }, { homeOfUid: () => undefined, accountsRoot }),
    )

    expect(reply).toMatchObject({ kind: "ok", modelProfile: "a/b" })
  })

  test("#given a session folder that no longer exists, spelled as HOME #when either verb runs #then it is refused and not created", () => {
    const home = join(folder(), "gone")
    const previous = process.env.HOME
    process.env.HOME = home
    try {
      for (const cwd of [home, `${home}/`]) {
        expect(setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" })).toMatchObject({
          kind: "refused",
          code: "home_folder",
        })
        expect(getProjectModelProfile(trusted(cwd))).toMatchObject({ kind: "refused", code: "home_folder" })
      }
      expect(existsSync(home)).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
    }
  })

  test("#given a folder beside an account home in a shared parent #when a pin is set #then it is written", () => {
    const shared = folder()
    const home = join(shared, "home")
    const work = join(shared, "workspace")
    mkdirSync(home)
    mkdirSync(work)

    const reply = asAnotherAccount(work, () =>
      setProjectModelProfile(trusted(work), { modelProfile: "a/b" }, { homeOfUid: () => home, accountsRoot: shared }),
    )

    expect(reply).toMatchObject({ kind: "ok", modelProfile: "a/b" })
  })

  test("#given an account home outside any shared accounts folder #when a pin is set there or through an alias #then it is refused", () => {
    const serviceHome = join(folder(), "var", "lib", "svc")
    mkdirSync(join(serviceHome, ".omo"), { recursive: true })
    writeFileSync(join(serviceHome, ".omo", "omo.jsonc"), COMMENTED)
    const alias = join(folder(), "svc-link")
    symlinkSync(serviceHome, alias)

    for (const cwd of [serviceHome, alias])
      expect(
        asAnotherAccount(serviceHome, () =>
          setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" }, { homeOfUid: () => serviceHome }),
        ),
      ).toMatchObject({
        kind: "refused",
        code: "home_folder",
      })
    expect(readFileSync(join(serviceHome, ".omo", "omo.jsonc"), "utf8")).toBe(COMMENTED)
  })

  test("#given a folder this account owns #when either verb checks for a home folder #then no owner home is looked up", () => {
    const cwd = folder(COMMENTED)
    const asked: number[] = []
    const deps = {
      homeOfUid: (uid: number) => {
        asked.push(uid)
        return null
      },
    }

    expect(getProjectModelProfile(trusted(cwd), deps).kind).toBe("ok")
    expect(setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" }, deps).kind).toBe("ok")

    expect(asked).toStrictEqual([])
  })

  test("#given a folder another account owns #when either verb checks for a home folder #then only its owner's home is looked up, once per call", () => {
    const cwd = folder(COMMENTED)
    const asked: number[] = []
    const deps = {
      homeOfUid: (uid: number) => {
        asked.push(uid)
        return null
      },
    }

    asAnotherAccount(cwd, () => {
      expect(getProjectModelProfile(trusted(cwd), deps).kind).toBe("ok")
      expect(setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" }, deps).kind).toBe("ok")
    })

    const owner = statSync(cwd).uid
    expect(asked).toStrictEqual([owner, owner])
  })

  test("#given a passwd entry from getent or macOS id -P #when its home is read #then the home field is returned", () => {
    const { homeFromPasswdEntry } = projectModelProfileRpc
    expect(homeFromPasswdEntry("svc:x:998:998::/var/lib/svc:/usr/sbin/nologin\n")).toBe("/var/lib/svc")
    expect(homeFromPasswdEntry("q:********:501:20::0:0:Q Kim:/Users/q name:/bin/zsh")).toBe("/Users/q name")
    expect(homeFromPasswdEntry("")).toBeNull()
    expect(homeFromPasswdEntry("broken:line:relative/home:/bin/sh")).toBeNull()
  })

  test("#given a failed owner lookup #when it is asked again #then the failure is reused without a second lookup, like a found home", () => {
    const { lookupHomeOfUid } = projectModelProfileRpc
    let failing = 0
    const failingRun = () => {
      failing += 1
      throw new Error("lookup timed out")
    }
    expect(lookupHomeOfUid(424242, failingRun)).toBeUndefined()
    expect(lookupHomeOfUid(424242, failingRun)).toBeUndefined()
    expect(failing).toBe(1)

    let found = 0
    const foundRun = () => {
      found += 1
      return "svc:x:424243:424243::/var/lib/svc:/bin/sh\n"
    }
    expect(lookupHomeOfUid(424243, foundRun)).toBe("/var/lib/svc")
    expect(lookupHomeOfUid(424243, foundRun)).toBe("/var/lib/svc")
    expect(found).toBe(1)
  })

  const passwdLookupBinary = process.platform === "darwin" ? "/usr/bin/id" : "/usr/bin/getent"

  test.skipIf(!existsSync(passwdLookupBinary))(
    `#given this platform's passwd lookup (${passwdLookupBinary}; skipped when that binary is absent) #when this account's home is looked up through the default path #then an absolute folder this account owns is returned`,
    () => {
      const uid = process.getuid?.()
      if (uid === undefined)
        throw new Error("process.getuid is missing on a platform that ships the passwd lookup binary")

      const home = projectModelProfileRpc.lookupHomeOfUid(uid)

      expect(typeof home === "string" && home.startsWith("/")).toBe(true)
      expect(statSync(home as string).uid).toBe(uid)
    },
  )
})
