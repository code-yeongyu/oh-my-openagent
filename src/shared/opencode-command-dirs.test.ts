import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"
import { join } from "node:path"

describe("opencode-command-dirs", () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env.OPENCODE_CONFIG_DIR
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = originalEnv
    } else {
      delete process.env.OPENCODE_CONFIG_DIR
    }
  })

  describe("getOpenCodeSkillDirs", () => {
    describe("#given config dir inside profiles/", () => {
      describe("#when getOpenCodeSkillDirs is called", () => {
        it("#then returns both profile and parent skill dirs", async () => {
          process.env.OPENCODE_CONFIG_DIR = "/home/user/.config/opencode/profiles/opus"

          const { getOpenCodeSkillDirs } = await import("./opencode-command-dirs")
          const dirs = getOpenCodeSkillDirs({ binary: "opencode" })

          expect(dirs).toContain("/home/user/.config/opencode/profiles/opus/skills")
          expect(dirs).toContain("/home/user/.config/opencode/profiles/opus/skill")
          expect(dirs).toContain("/home/user/.config/opencode/skill")
          expect(dirs).toContain("/home/user/.config/opencode/skills")
          expect(dirs).toHaveLength(4)
        })
      })
    })

    describe("#given config dir NOT inside profiles/", () => {
      describe("#when getOpenCodeSkillDirs is called", () => {
        it("#then returns only the config dir skills", async () => {
          process.env.OPENCODE_CONFIG_DIR = "/home/user/.config/opencode"

          const { getOpenCodeSkillDirs } = await import("./opencode-command-dirs")
          const dirs = getOpenCodeSkillDirs({ binary: "opencode" })

          expect(dirs).toContain("/home/user/.config/opencode/skills")
          expect(dirs).toContain("/home/user/.config/opencode/skill")
          expect(dirs).toHaveLength(2)
        })
      })
    })
  })

  describe("getOpenCodeCommandDirs", () => {
    describe("#given config dir inside profiles/", () => {
      describe("#when getOpenCodeCommandDirs is called", () => {
        it("#then returns both profile and parent command dirs", async () => {
          process.env.OPENCODE_CONFIG_DIR = "/home/user/.config/opencode/profiles/opus"

          const { getOpenCodeCommandDirs } = await import("./opencode-command-dirs")
          const dirs = getOpenCodeCommandDirs({ binary: "opencode" })

          expect(dirs).toContain("/home/user/.config/opencode/profiles/opus/commands")
          expect(dirs).toContain("/home/user/.config/opencode/profiles/opus/command")
          expect(dirs).toContain("/home/user/.config/opencode/commands")
          expect(dirs).toContain("/home/user/.config/opencode/command")
          expect(dirs).toHaveLength(4)
        })
      })
    })
  })
})
