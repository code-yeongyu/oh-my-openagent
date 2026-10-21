import { describe, expect, test } from "bun:test"

import { OmoConfigSchema, OmoTypedHarnessConfigSchema } from "./config"
import { DEFAULT_FILE_REF_ALLOWLIST_ROOTS, fileRefAllowlistRoots, OmoSecuritySettingsSchema } from "./security"

describe("omo security settings", () => {
  describe("#given no security section", () => {
    describe("#when the config is parsed", () => {
      test("#then the file-reference allowlist a reader gets is the single shipped root", () => {
        expect(fileRefAllowlistRoots(OmoConfigSchema.parse({}))).toEqual(DEFAULT_FILE_REF_ALLOWLIST_ROOTS)
      })

      test("#then the mode a reader gets is refuse, not allow", () => {
        expect(OmoSecuritySettingsSchema.parse({}).file_ref_default_mode).toBe("refuse")
      })
    })
  })

  describe("#given a security section naming extra allowlist roots", () => {
    describe("#when the config is parsed", () => {
      test("#then the roots replace the default, so the reader gets exactly what the user named", () => {
        const parsed = OmoConfigSchema.parse({ security: { file_ref_allowlist_roots: ["~/.config/opencode", "/srv/omo-secrets"] } })

        expect(fileRefAllowlistRoots(parsed)).toEqual(["~/.config/opencode", "/srv/omo-secrets"])
      })
    })
  })

  describe("#given a relative allowlist root", () => {
    describe("#when the config is parsed", () => {
      test("#then it is refused, because a relative root would resolve against whatever cwd setup ran in", () => {
        expect(() => OmoSecuritySettingsSchema.parse({ file_ref_allowlist_roots: ["./secrets"] })).toThrow()
      })
    })
  })

  describe("#given a denylisted path offered as an allowlist root", () => {
    describe("#when the config is parsed", () => {
      test("#then it parses - the denylist is not this key's job - and the resolver still denies it", () => {
        // The schema accepts an absolute path by shape. It is the resolver that refuses a
        // denylisted prefix whatever the allowlist holds, which setup-opencode-assets.test.ts owns.
        expect(OmoSecuritySettingsSchema.parse({ file_ref_allowlist_roots: ["/proc"] }).file_ref_allowlist_roots).toEqual(["/proc"])
      })
    })
  })

  describe("#given an unknown key in the security section", () => {
    describe("#when a harness block is parsed", () => {
      test("#then it is refused rather than silently dropped", () => {
        expect(() => OmoTypedHarnessConfigSchema.parse({ security: { file_ref_allowlist_root: ["~"] } })).toThrow()
      })
    })
  })
})