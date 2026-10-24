import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { GitMemoryRepo, type GitExec } from "../git"
import { readAgreementsAt } from "./ledger-file"
import { AGREEMENTS_PATH } from "./types"

const FIRST = "1".repeat(40)
const SECOND = "2".repeat(40)

function fixture() {
  const dir = join(tmpdir(), `agreements-read-${crypto.randomUUID()}`)
  const commands: string[][] = []
  const contents = new Map<string, string>([[FIRST, "first ledger\n"], [SECOND, "second ledger\n"]])
  let fail = false
  const exec: GitExec = {
    async run(argv) {
      commands.push([...argv])
      const revision = argv.map((arg) => /^(HEAD|[0-9a-f]{40})(?::|$)/.exec(arg)?.[1])
        .find((value) => value !== undefined)
      if (revision === undefined) throw new Error(`Unexpected git argv: ${JSON.stringify(argv)}`)
      expect(argv).toEqual(argv[0] === "ls-tree"
        ? ["ls-tree", "-r", "--name-only", "-z", revision, "--", AGREEMENTS_PATH]
        : ["show", `${revision}:${AGREEMENTS_PATH}`])
      if (fail) return { code: 128, stdout: "", stderr: "unavailable object" }
      const content = contents.get(revision)
      return {
        code: 0,
        stdout: argv[0] === "ls-tree" ? (content === undefined ? "" : `${AGREEMENTS_PATH}\0`) : content ?? "",
        stderr: "",
      }
    },
  }
  const open = (cwd = dir) => new GitMemoryRepo({ dir: cwd, agentId: "ledger-test", exec })
  return { dir, commands, contents, open, fail: (value: boolean) => { fail = value } }
}

describe("readAgreementsAt immutable revision cache", () => {
  it("#given one SHA read by two repo instances #when read again #then no git command is spawned", async () => {
    // given
    const f = fixture()
    expect(await readAgreementsAt(f.open(), FIRST)).toBe("first ledger\n")
    const before = f.commands.length
    // when
    const again = await readAgreementsAt(f.open(), FIRST)
    // then
    expect(again).toBe("first ledger\n")
    expect(f.commands.length).toBe(before)
    expect(f.commands[0]?.slice(-2)).toEqual(["--", AGREEMENTS_PATH])
  })

  it("#given cached content #when another SHA is read #then reads the new committed ledger", async () => {
    // given
    const f = fixture()
    await readAgreementsAt(f.open(), FIRST)
    // when
    const next = await readAgreementsAt(f.open(), SECOND)
    // then
    expect(next).toBe("second ledger\n")
    expect(f.commands.filter((argv) => argv[0] === "ls-tree")).toHaveLength(2)
  })

  it("#given an absent ledger #when the SHA is read twice #then undefined is cached", async () => {
    // given
    const f = fixture()
    f.contents.delete(FIRST)
    // when
    const values = [await readAgreementsAt(f.open(), FIRST), await readAgreementsAt(f.open(), FIRST)]
    // then
    expect(values).toEqual([undefined, undefined])
    expect(f.commands).toHaveLength(1)
  })

  it("#given two repositories #when the same SHA is read #then each repository is queried", async () => {
    // given
    const f = fixture()
    await readAgreementsAt(f.open(), FIRST)
    // when
    await readAgreementsAt(f.open(`${f.dir}-other`), FIRST)
    // then
    expect(f.commands.filter((argv) => argv[0] === "ls-tree")).toHaveLength(2)
  })

  it("#given a mutable HEAD revision #when its content changes #then it is read again", async () => {
    // given
    const f = fixture()
    f.contents.set("HEAD", "before\n")
    expect(await readAgreementsAt(f.open(), "HEAD")).toBe("before\n")
    // when
    f.contents.set("HEAD", "after\n")
    const next = await readAgreementsAt(f.open(), "HEAD")
    // then
    expect(next).toBe("after\n")
  })

  it("#given a failed immutable read #when retried #then the failure was not cached", async () => {
    // given
    const f = fixture()
    f.fail(true)
    let failure: unknown
    try { await readAgreementsAt(f.open(), FIRST) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    // when
    f.fail(false)
    const content = await readAgreementsAt(f.open(), FIRST)
    // then
    expect(content).toBe("first ledger\n")
  })

  it("#given simultaneous reads of one SHA #when completed #then only one lookup and blob read run", async () => {
    // given
    const f = fixture()
    // when
    const values = await Promise.all([readAgreementsAt(f.open(), FIRST), readAgreementsAt(f.open(), FIRST)])
    // then
    expect(values).toEqual(["first ledger\n", "first ledger\n"])
    expect(f.commands).toHaveLength(2)
  })

  it("#given many later revisions #when an old SHA is revisited #then bounded cache eviction re-reads it", async () => {
    // given
    const f = fixture()
    await readAgreementsAt(f.open(), FIRST)
    for (let index = 0; index < 40; index += 1) {
      await readAgreementsAt(f.open(), index.toString(16).padStart(40, "0"))
    }
    const before = f.commands.length
    // when
    const value = await readAgreementsAt(f.open(), FIRST)
    // then
    expect(value).toBe("first ledger\n")
    expect(f.commands.length - before).toBe(2)
  })
})
