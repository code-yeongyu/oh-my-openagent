/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { userInfo } from "node:os"
import { join } from "node:path"

import { COMMENTED, asAnotherAccount, configText, folder, trusted } from "./project-model-profile-home.test-support"
import { getProjectModelProfile, setProjectModelProfile } from "./project-model-profile-rpc"

describe("project model_profile RPC refusal of this account's own home (#13209)", () => {
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

  test("#given HOME points elsewhere and this account's passwd home is the session folder #when either verb runs #then it is refused and the user layer is untouched", () => {
    const passwdHome = folder(COMMENTED)
    const work = folder()
    const asked: number[] = []
    const deps = {
      homeOfUid: (uid: number) => {
        asked.push(uid)
        return passwdHome
      },
    }
    const previous = process.env.HOME
    process.env.HOME = folder()
    try {
      expect(setProjectModelProfile(trusted(passwdHome), { modelProfile: "a/b" }, deps)).toMatchObject({
        kind: "refused",
        code: "home_folder",
      })
      expect(getProjectModelProfile(trusted(passwdHome), deps)).toMatchObject({ kind: "refused", code: "home_folder" })
      expect(configText(passwdHome)).toBe(COMMENTED)
      expect(setProjectModelProfile(trusted(work), { modelProfile: "a/b" }, deps)).toMatchObject({
        kind: "ok",
        modelProfile: "a/b",
      })
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
    }

    const ownUid = statSync(passwdHome).uid
    expect(asked).toStrictEqual([ownUid, ownUid, ownUid])
  })

  test("#given HOME points elsewhere and this account's passwd home is owned by another uid (UID-mapped) #when either verb runs in that home #then it is refused and the user layer is untouched", () => {
    const passwdHome = folder(COMMENTED)
    const ownUid = statSync(passwdHome).uid + 1
    const deps = { homeOfUid: (uid: number) => (uid === ownUid ? passwdHome : null) }
    const previous = process.env.HOME
    process.env.HOME = folder()
    try {
      const replies = asAnotherAccount(passwdHome, () => [
        setProjectModelProfile(trusted(passwdHome), { modelProfile: "a/b" }, deps),
        getProjectModelProfile(trusted(passwdHome), deps),
      ])

      for (const reply of replies) expect(reply).toMatchObject({ kind: "refused", code: "home_folder" })
      expect(configText(passwdHome)).toBe(COMMENTED)
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
    }
  })

  // A missing passwd entry for this account (a container started with a bare uid) is treated like a failed lookup:
  // only folders at or above HOME are refused, so the bind-mounted project below it keeps working.
  for (const [label, ownHome] of [
    ["fails", undefined],
    ["finds no passwd entry", null],
  ] as const) {
    test(`#given the lookup of this account's own home ${label} and HOME points inside a folder this account owns #when a pin is set in that folder or its parent #then it is refused and nothing is written`, () => {
      const parent = folder()
      const work = join(parent, "work")
      mkdirSync(join(work, ".omo"), { recursive: true })
      writeFileSync(join(work, ".omo", "omo.jsonc"), COMMENTED)
      mkdirSync(join(work, "sandbox-home"))
      const deps = { homeOfUid: () => ownHome }
      const previous = process.env.HOME
      process.env.HOME = join(work, "sandbox-home")
      try {
        for (const cwd of [work, parent]) {
          expect(setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" }, deps)).toMatchObject({
            kind: "refused",
            code: "home_folder",
          })
          expect(getProjectModelProfile(trusted(cwd), deps)).toMatchObject({ kind: "refused", code: "home_folder" })
        }
        expect(configText(work)).toBe(COMMENTED)
        expect(existsSync(join(parent, ".omo"))).toBe(false)
      } finally {
        if (previous === undefined) delete process.env.HOME
        else process.env.HOME = previous
      }
    })
  }

  test("#given the lookup of this account's own home fails or finds no passwd entry #when a pin is set in a folder this account owns #then it is written", () => {
    for (const ownHome of [undefined, null]) {
      const work = folder()

      const reply = setProjectModelProfile(trusted(work), { modelProfile: "a/b" }, { homeOfUid: () => ownHome })

      expect(reply).toMatchObject({ kind: "ok", modelProfile: "a/b" })
    }
  })
})
