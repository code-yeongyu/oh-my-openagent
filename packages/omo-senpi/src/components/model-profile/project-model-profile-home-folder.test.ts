/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { COMMENTED, asAnotherAccount, configText, folder, trusted } from "./project-model-profile-home.test-support"
import { getProjectModelProfile, setProjectModelProfile } from "./project-model-profile-rpc"

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

  test("#given the owner lookup fails for another account's folder away from this account's home #when a pin is set #then it is refused and nothing is written", () => {
    const accountsRoot = folder()
    const work = join(folder(), "workspace")
    mkdirSync(join(work, ".omo"), { recursive: true })
    writeFileSync(join(work, ".omo", "omo.jsonc"), COMMENTED)
    const deps = { homeOfUid: () => undefined, accountsRoot }

    const replies = asAnotherAccount(work, () => [
      setProjectModelProfile(trusted(work), { modelProfile: "a/b" }, deps),
      getProjectModelProfile(trusted(work), deps),
    ])

    for (const reply of replies) expect(reply).toMatchObject({ kind: "refused", code: "home_folder" })
    expect(configText(work)).toBe(COMMENTED)
  })

  test("#given the owner lookup fails while this account's home sits at the file system root #when a pin is set in another account's folder #then it is refused and nothing is written", () => {
    const work = join(folder(), "workspace")
    mkdirSync(join(work, ".omo"), { recursive: true })
    writeFileSync(join(work, ".omo", "omo.jsonc"), COMMENTED)

    const reply = asAnotherAccount(work, () =>
      setProjectModelProfile(
        trusted(work),
        { modelProfile: "a/b" },
        { homeOfUid: () => undefined, accountsRoot: null },
      ),
    )

    expect(reply).toMatchObject({ kind: "refused", code: "home_folder" })
    expect(configText(work)).toBe(COMMENTED)
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

  test("#given a folder another account owns #when either verb checks for a home folder #then this account's home and the owner's home are each looked up once per call", () => {
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
    expect(asked).toStrictEqual([owner + 1, owner, owner + 1, owner])
  })
})
