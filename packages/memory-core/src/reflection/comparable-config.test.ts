import { describe, expect, it } from "bun:test"
import { stripOmoConfigSection } from "./comparable-config"

describe("stripOmoConfigSection", () => {
  it("#given a config without an omo section #when stripped #then every byte is unchanged", () => {
    const config = "[core]\n\trepositoryformatversion = 0\n\tbare = false\n[user]\n\tname = OmO Agent\n"
    expect(stripOmoConfigSection(config)).toBe(config)
  })

  it("#given a config whose omo section holds the maintenance stamp #when stripped #then the section and its keys are gone", () => {
    const config = "[core]\n\tbare = false\n[omo]\n\tagentId = agent-one\n\tmaintenanceAt = 1791637399524\n"
    expect(stripOmoConfigSection(config)).toBe("[core]\n\tbare = false\n")
  })

  it("#given an omo section as the last block with no keys #when stripped #then the rest stays byte-identical", () => {
    const config = "[core]\n\tbare = false\n[omo]\n"
    expect(stripOmoConfigSection(config)).toBe("[core]\n\tbare = false\n")
  })

  it("#given an omo subsection and sibling sections #when stripped #then only the exact omo section is removed", () => {
    const config = "[core]\n\tbare = false\n[omo \"team\"]\n\tkeep = 1\n[user]\n\temail = a@omo.local\n"
    expect(stripOmoConfigSection(config)).toBe(config)
  })

  it("#given a header with a trailing comment #when stripped #then the commented omo section is removed", () => {
    const config = "[omo] ; stamp\n\tmaintenanceAt = 1\n[core]\n\tbare = false\n"
    expect(stripOmoConfigSection(config)).toBe("[core]\n\tbare = false\n")
  })

  it("#given a value continuation line inside the omo section #when stripped #then the continuation is dropped with its section", () => {
    const config = "[omo]\n\tmaintenanceAt = 1\\\n\t\t2\n[core]\n\tbare = false\n"
    expect(stripOmoConfigSection(config)).toBe("[core]\n\tbare = false\n")
  })

  it("#given no config at all #when stripped #then the result stays null", () => {
    expect(stripOmoConfigSection(null)).toBeNull()
  })
})
