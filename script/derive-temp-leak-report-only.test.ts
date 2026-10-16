import { describe, expect, test } from "bun:test"

import { deriveTempEntries, hasSourceCreator, ownerOf } from "./derive-temp-leak-report-only"

describe("deriveTempEntries (#9766)", () => {
  test("#given mkdtemp literal, template and helper creators #when derived #then each yields its prefix", () => {
    const source = [
      'mkdtempSync(join(tmpdir(), "omo-cli-"))',
      "mkdtempSync(join(tmpdir(), `omo-tui-${label}-`))",
      "await mkdtemp(`${tmpdir()}/omo-mirror-`)",
      'const dir = createTempDir("omo-helper-")',
    ].join("\n")

    expect(deriveTempEntries(source)).toEqual(["omo-cli-", "omo-helper-", "omo-mirror-", "omo-tui-"])
  })

  test("#given a fixed name joined under the temp dir #when derived #then it is an exact entry", () => {
    expect(deriveTempEntries('const log = join(tmpdir(), "omo.js")')).toEqual(["omo.js$"])
  })

  test("#given a temp path built by concatenation #when derived #then the literal part is a prefix", () => {
    expect(deriveTempEntries('const dir = join(tmpdir(), "omo-concat-" + id)')).toEqual(["omo-concat-"])
  })

  test("#given no temp creator #when derived #then nothing is listed", () => {
    expect(deriveTempEntries('mkdirSync(join(projectDir, "omo-cli-"))')).toEqual([])
  })
})

describe("hasSourceCreator (#9766)", () => {
  test.each([
    ["omo-cli-", ["omo-cli-"], true],
    ["omo-", ["omo-cli-"], true],
    ["omo-sg-runner-", ["omo-"], true],
    ["omo-cli.log$", ["omo-"], true],
    ["omo.js$", ["omo.js$"], true],
    ["omo-sg-runner-", ["omo-sg$"], false],
    ["boulder-stale-", ["omo-"], false],
  ])("entry %p with creators %p has a creator: %p", (entry, creators, expected) => {
    expect(hasSourceCreator(entry, creators)).toBe(expected)
  })
})

describe("ownerOf (#9766)", () => {
  test.each([
    ["packages/omo-opencode/src/cli/install.test.ts", "omo-opencode"],
    ["script/build.test.ts", "script"],
    ["postinstall.test.ts", "postinstall.test.ts"],
  ])("%p is owned by %p", (file, owner) => {
    expect(ownerOf(file)).toBe(owner)
  })
})
