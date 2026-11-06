import { describe, expect, it } from "bun:test"
import { stripOmoMaintenanceStamp } from "./comparable-config"

describe("stripOmoMaintenanceStamp", () => {
  it("#given a config without a maintenance stamp #when filtered #then every byte is unchanged", () => {
    const config = "[core]\n\trepositoryformatversion = 0\n\tbare = false\n[user]\n\tname = OmO Agent\n"
    expect(stripOmoMaintenanceStamp(config)).toBe(config)
  })

  it("#given an omo section with agentId and the stamp #when filtered #then only the stamp line is gone", () => {
    const config = "[core]\n\tbare = false\n[omo]\n\tagentId = agent-one\n\tmaintenanceAt = 1791637399524\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[core]\n\tbare = false\n[omo]\n\tagentId = agent-one\n")
  })

  it("#given an omo section as the last block with no keys #when filtered #then the rest stays byte-identical", () => {
    const config = "[core]\n\tbare = false\n[omo]\n"
    expect(stripOmoMaintenanceStamp(config)).toBe(config)
  })

  it("#given a one-line header with a key right after the omo section #when filtered #then that line survives as a real config entry", () => {
    const config = "[omo]\n\tmaintenanceAt = 1\n[core] bare = false\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo]\n[core] bare = false\n")
  })

  it("#given the stamp written on the header line #when filtered #then a bare header replaces it and following keys survive", () => {
    const config = "[omo] maintenanceAt = 1\n\tagentId = agent-one\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo]\n\tagentId = agent-one\n")
  })

  it("#given an omo subsection and sibling sections #when filtered #then nothing is removed", () => {
    const config = "[core]\n\tbare = false\n[omo \"team\"]\n\tmaintenanceAt = 1\n\tkeep = 1\n[user]\n\temail = a@omo.local\n"
    expect(stripOmoMaintenanceStamp(config)).toBe(config)
  })

  it("#given a header with a trailing comment #when filtered #then the commented stamp key is gone", () => {
    const config = "[omo] ; stamp\n\tmaintenanceAt = 1\n[core]\n\tbare = false\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo] ; stamp\n[core]\n\tbare = false\n")
  })

  it("#given a multi-line stamp value with a backslash continuation #when filtered #then the continuation lines are gone too", () => {
    const config = "[omo]\n\tmaintenanceAt = 1\\\n\t\t2\n\tagentId = agent-one\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo]\n\tagentId = agent-one\n")
  })

  it("#given the stamp key in another case #when filtered #then git's case-insensitive matching still drops it", () => {
    const config = "[omo]\n\tMAINTENANCEAT = 1\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo]\n")
  })

  it("#given no config at all #when filtered #then the result stays null", () => {
    expect(stripOmoMaintenanceStamp(null)).toBeNull()
  })

  it("#given a backslash inside a trailing semicolon comment #when filtered #then the next line stays a real key", () => {
    const config = "[omo]\n\tagentId = a\n\tmaintenanceAt = 1 ;\\\n\tagentId = evil\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo]\n\tagentId = a\n\tagentId = evil\n")
  })

  it("#given a backslash inside a trailing hash comment #when filtered #then the next line stays a real key", () => {
    const config = "[omo]\n\tmaintenanceAt = 1 #\\\n\tagentId = evil\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo]\n\tagentId = evil\n")
  })

  it("#given a stamp value ending in an escaped backslash #when filtered #then the next line is not dropped as a continuation", () => {
    const config = "[omo]\n\tmaintenanceAt = 1\\\\\n\tagentId = evil\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo]\n\tagentId = evil\n")
  })

  it("#given a stamp on the header line ending in an escaped backslash #when filtered #then the next line stays a real key", () => {
    const config = "[omo] maintenanceAt = 1\\\\\n\tagentId = evil\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo]\n\tagentId = evil\n")
  })

  it("#given a continuation line ending in an escaped backslash #when filtered #then the value ends and the next key survives", () => {
    const config = "[omo]\n\tmaintenanceAt = 1\\\n\t2\\\\\n\tagentId = evil\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo]\n\tagentId = evil\n")
  })

  it("#given a continuation line whose trailing comment ends in a backslash #when filtered #then the next key survives", () => {
    const config = "[omo]\n\tmaintenanceAt = 1\\\n\t2 ;\\\n\tagentId = evil\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo]\n\tagentId = evil\n")
  })

  it("#given a stamp value with trailing whitespace after the backslash #when filtered #then the next line is not dropped as a continuation", () => {
    const config = "[omo]\n\tmaintenanceAt = 1\\ \n\tagentId = evil\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo]\n\tagentId = evil\n")
  })

  it("#given a quoted stamp value whose backslash sits inside the quotes at end of line #when filtered #then the next line still continues the value", () => {
    const config = "[omo]\n\tmaintenanceAt = \"1\\\n\t2\"\n\tagentId = agent-one\n"
    expect(stripOmoMaintenanceStamp(config)).toBe("[omo]\n\tagentId = agent-one\n")
  })
})
