import { describe, expect, test } from "bun:test"
import { matchThread, type LadderView } from "."

type Row = LadderView & { readonly label: string; readonly scoped?: boolean }

const rows: readonly Row[] = [
  { label: "live", id: "0aa00001-0000-4000-8000-000000000001", keys: ["rk-live"], aliases: ["Lane-A"], name: "Alpha" },
  {
    label: "keyed",
    id: "0bb00001-0000-4000-8000-000000000001",
    keys: ["0aa00001-0000-4000-8000-000000000001"],
    name: "beta",
  },
  { label: "twinA", id: "0cc00001-0000-4000-8000-000000000001", name: "shared", scoped: true },
  { label: "twinB", id: "0cc00001-ffff-4000-8000-000000000002", name: "shared", scoped: false },
  { label: "copy", id: "0cc00001-0000-4000-8000-000000000001", name: "" },
  { label: "aliasNamed", id: "0dd00001-0000-4000-8000-000000000001", name: "lane-a" },
]

const answer = (text: string, opts: Partial<Parameters<typeof matchThread<Row>>[2]> = {}) => {
  const found = matchThread(rows, text, { view: (row) => row, ...opts })
  if (found.kind === "none") return "none"
  if (found.kind === "one") return `${found.step}:${found.entry.label}`
  return `${found.step}:${found.entries.map((row) => row.label).join("+")}`
}

// The one thread-part ladder every resolver shares (#14305 U8): the thread tools' book (thread/addressing.ts) and the
// remote client's sessions.resolve both run it, so a step order or a tie rule changed here changes every surface.
describe("#given candidate threads #when matchThread reads a thread part #then exact id > session id > alias > name > unique 8+ hex id prefix", () => {
  test.each([
    ["an exact id beats the same text as another row's listing key", "0aa00001-0000-4000-8000-000000000001", "id:live"],
    ["a listing key", "rk-live", "session_id:live"],
    ["an alias beats a name that normalizes to the same text", "lane-a", "alias:live"],
    ["a name, NFKC and case folded", "ＡＬＰＨＡ", "name:live"],
    [
      "one id held by two rows: both answer, the caller decides",
      "0cc00001-0000-4000-8000-000000000001",
      "id:twinA+copy",
    ],
    ["a name two rows share", "shared", "name:twinA+twinB"],
    ["a unique 8+ hex id prefix", "0bb00001", "id_prefix:keyed"],
    ["a prefix counts each thread id once", "0cc00001-0", "id_prefix:twinA"],
    ["a prefix shorter than 8 characters", "0bb0000", "none"],
    ["an 8+ hex prefix two thread ids share: both answer", "0cc00001", "id_prefix:twinA+twinB"],
    ["empty text", "", "none"],
    ["nothing", "nowhere", "none"],
  ])("%s", (_case, text, expected) => {
    expect(answer(text)).toBe(expected)
  })

  test("#given a name scope #when a name matches outside it #then only the scoped row answers; ids and prefixes ignore the scope", () => {
    const named = (row: Row) => row.scoped !== false
    expect(answer("shared", { named })).toBe("name:twinA")
    expect(answer("0cc00001-ffff-4000-8000-000000000002", { named })).toBe("id:twinB")
    expect(answer("0cc00001-f", { named })).toBe("id_prefix:twinB")
  })

  test("#given the id prefix step switched off or excluding one id #when a prefix is read #then it answers nothing for that id", () => {
    expect(answer("0bb00001", { idPrefix: false })).toBe("none")
    expect(answer("0bb00001", { idPrefix: { exclude: "0bb00001-0000-4000-8000-000000000001" } })).toBe("none")
  })
})
