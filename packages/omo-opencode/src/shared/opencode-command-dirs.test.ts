import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"
import { resolve } from "node:path"

describe("opencode-command-dirs", () => {
  let originalOpencodeConfigDir: string | undefined
  let originalXdgConfigHome: string | undefined

  beforeEach(() => {
    originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
  })

  afterEach(() => {
    if (originalOpencodeConfigDir !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir
    } else {
      delete process.env.OPENCODE_CONFIG_DIR
    }

    if (originalXdgConfigHome !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome
    } else {
      delete process.env.XDG_CONFIG_HOME
    }
  })

  describe("getOpenCodeSkillDirs", () => {
    describe("#given config dir inside profiles/", () => {
      describe("#when getOpenCodeSkillDirs is called", () => {
        it("#then returns both profile and parent skill dirs", async () => {
          process.env.XDG_CONFIG_HOME = "/home/user/.config"
          process.env.OPENCODE_CONFIG_DIR = "/home/user/.config/opencode/profiles/opus"

          const { getOpenCodeSkillDirs } = await import("./opencode-command-dirs")
          const dirs = getOpenCodeSkillDirs({ binary: "opencode" })

          expect(dirs).toContain(resolve("/home/user/.config/opencode/profiles/opus/skills"))
          expect(dirs).toContain(resolve("/home/user/.config/opencode/profiles/opus/skill"))
          expect(dirs).toContain(resolve("/home/user/.config/opencode/skill"))
          expect(dirs).toContain(resolve("/home/user/.config/opencode/skills"))
          expect(dirs).toHaveLength(4)
        })
      })
    })

    describe("#given config dir NOT inside profiles/", () => {
      describe("#when getOpenCodeSkillDirs is called", () => {
        it("#then returns only the config dir skills", async () => {
          process.env.XDG_CONFIG_HOME = "/home/user/.config"
          process.env.OPENCODE_CONFIG_DIR = "/home/user/.config/opencode"

          const { getOpenCodeSkillDirs } = await import("./opencode-command-dirs")
          const dirs = getOpenCodeSkillDirs({ binary: "opencode" })

          expect(dirs).toContain(resolve("/home/user/.config/opencode/skills"))
          expect(dirs).toContain(resolve("/home/user/.config/opencode/skill"))
          expect(dirs).toHaveLength(2)
        })
      })
    })
  })

  describe("getOpenCodeCommandDirs", () => {
    describe("#given config dir inside profiles/", () => {
      describe("#when getOpenCodeCommandDirs is called", () => {
        it("#then returns both profile and parent command dirs", async () => {
          process.env.XDG_CONFIG_HOME = "/home/user/.config"
          process.env.OPENCODE_CONFIG_DIR = "/home/user/.config/opencode/profiles/opus"

          const { getOpenCodeCommandDirs } = await import("./opencode-command-dirs")
          const dirs = getOpenCodeCommandDirs({ binary: "opencode" })

          expect(dirs).toContain(resolve("/home/user/.config/opencode/profiles/opus/commands"))
          expect(dirs).toContain(resolve("/home/user/.config/opencode/profiles/opus/command"))
          expect(dirs).toContain(resolve("/home/user/.config/opencode/commands"))
          expect(dirs).toContain(resolve("/home/user/.config/opencode/command"))
          expect(dirs).toHaveLength(4)
        })
      })
    })
  })
})
