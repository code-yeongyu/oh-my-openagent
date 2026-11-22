import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryIdentityContext } from "./context"
import { createMemoryTools, registerMemoryTools } from "./tools"
import { boundFixture, git, seedFile } from "./tools.test-support"

test("two sessions reading one file cannot splice a stale insert into the winner's block", async () => {
  const fixture = await boundFixture()
  const file_path = "reference/notes.md"
  await seedFile(fixture, file_path, "first\nsecond")
  const contexts = { A: fixture.context, B: createMemoryIdentityContext(fixture.context) }
  const resolve = (id?: string) => (id === "A" ? contexts.A : contexts.B)
  const ctx = (id: string) => ({ sessionManager: { getSessionId: () => id } })
  const pi = new FakeExtensionAPI()
  registerMemoryTools(pi, resolve)
  const [tool] = createMemoryTools(resolve)
  const path = join(fixture.repo.dir, file_path)
  const read = async (id: string, range = false) => {
    const call = {
      toolCallId: `read-${id}`,
      toolName: "read",
      input: { path, ...(range ? { offset: 4, limit: 1 } : {}) },
    }
    await pi.dispatch("tool_call", call, ctx(id))
    const text = await readFile(path, "utf8")
    const content = [{ type: "text", text: range ? text.split("\n")[3] : text }]
    await pi.dispatch("tool_result", { ...call, isError: false, content }, ctx(id))
  }
  await read("A")
  await read("B", true)
  const insert = (id: string, insert_line: number, insert_text: string) =>
    tool.execute(
      id,
      { command: "insert", file_path, reason: id, insert_line, insert_text },
      undefined,
      undefined,
      ctx(id),
    )
  expect((await insert("A", 1, "A1\nA2")).isError).toBeUndefined()
  const head = await fixture.repo.head()
  // Refresh A, not B. A store-wide last-read cache would let B's stale line through.
  await read("A")

  const stale = await insert("B", 2, "B1\nB2")
  expect(stale.details.errorCode).toBe("stale_read")
  expect(stale.isError).toBe(true)
  expect(stale.details.message).toContain(file_path)
  expect(await fixture.repo.head()).toBe(head)
  expect(await git(fixture.repo, ["status", "--porcelain"])).toBe("")
  await read("B", true)
  expect((await insert("B", 3, "B1\nB2")).isError).toBeUndefined()
  expect(await readFile(path, "utf8")).toEndWith("A1\nA2\nB1\nB2\nfirst\nsecond")
}, 30_000)

test("an identical insert is a success without a second commit or notice", async () => {
  const fixture = await boundFixture()
  const file_path = "reference/notes.md"
  await seedFile(fixture, file_path, "not the announcement\nend")
  const commits: string[] = []
  const [tool] = createMemoryTools(() => fixture.context, { onCommit: (commit) => commits.push(commit.sha) })
  const params = {
    command: "insert",
    file_path,
    reason: "announce",
    insert_line: 1,
    insert_text: "the announcement\nend",
  } as const
  expect((await tool.execute("first", params)).isError).toBeUndefined()
  const head = await fixture.repo.head()
  const second = await tool.execute("repeat", params)
  expect(second.details.message).toContain("already present")
  expect(second.isError).toBeUndefined()
  expect(commits).toHaveLength(1)
  expect(commits[0]).toBe(head)
  expect(await fixture.repo.head()).toBe(head)
  expect(await readFile(join(fixture.repo.dir, file_path), "utf8")).toEndWith(
    "\n---\nthe announcement\nend\nnot the announcement\nend",
  )
}, 30_000)
