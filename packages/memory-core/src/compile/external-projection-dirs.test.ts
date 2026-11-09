import { describe, expect, it } from "bun:test"
import { groupDirectories } from "./external-projection-dirs"
import { renderExternalProjection, renderExternalProjectionStats } from "./external-projection"
import { NAME_LEGEND } from "./external-projection-names"

const AWS_KEY_SHAPED = ["AKIA", "ABCDEFGHIJKLMNOP"].join("")
const IDS = ["Y2Gw9vTZ9pnH2K5a", "87U3F2ZseCw7bLMz", "2Fc9uTN3x7DPCCxs"]
const labels = (paths: readonly string[]): string[] => groupDirectories(paths, undefined).map((group) => group.label)

describe("groupDirectories directory classes", () => {
  const cases: ReadonlyArray<{ readonly name: string; readonly paths: readonly string[]; readonly expected: readonly string[] }> = [
    {
      name: "three leaf siblings named by generated ids",
      paths: IDS.map((id) => `jobs/${id}/MEMORY.md`),
      expected: ["jobs/<id>/ (3 dirs)"],
    },
    {
      name: "two leaf siblings named by generated ids",
      paths: IDS.slice(0, 2).map((id) => `jobs/${id}/MEMORY.md`),
      expected: ["jobs/Y2Gw9vTZ9pnH2K5a/", "jobs/87U3F2ZseCw7bLMz/"].sort((a, b) => a.localeCompare(b)),
    },
    {
      name: "three leaf siblings holding the same file names",
      paths: ["people/cy/card.md", "people/ann/card.md", "people/bob/card.md"],
      expected: ["people/{ann, bob, cy}/"],
    },
    {
      name: "leaf siblings holding different file names",
      paths: ["people/ann/card.md", "people/bob/card.md", "people/cy/notes.md"],
      expected: ["people/ann/", "people/bob/", "people/cy/"],
    },
    {
      name: "an id-named sibling with a directory below it",
      paths: [...IDS.map((id) => `jobs/${id}/MEMORY.md`), `jobs/${IDS[0]}/runs/log.md`],
      expected: ["jobs/2Fc9uTN3x7DPCCxs/", "jobs/87U3F2ZseCw7bLMz/", "jobs/Y2Gw9vTZ9pnH2K5a/", "jobs/Y2Gw9vTZ9pnH2K5a/runs/"],
    },
    {
      name: "a sibling whose name is masked",
      paths: ["people/ann/card.md", "people/bob/card.md", `people/${AWS_KEY_SHAPED}/card.md`],
      expected: ["people/***/", "people/ann/", "people/bob/"],
    },
    {
      name: "files at the root next to a directory",
      paths: ["ARCHIVE.md", "notes/n.md"],
      expected: ["$MEMORY_DIR/", "notes/"],
    },
  ]

  for (const testCase of cases) {
    it(`#given ${testCase.name} #when grouped #then the line labels are exact`, () => {
      // given
      const paths = testCase.paths

      // when
      const grouped = labels(paths)

      // then
      expect(grouped).toEqual([...testCase.expected])
    })
  }

  it("#given id-named directories #when rendered and counted #then the legend opens the block, one line names the shared file and every file is shown", () => {
    // given
    const paths = IDS.map((id) => `reference/jobs/${id}/MEMORY.md`)
    const input = { times: new Map<string, number>(), limits: { maxEntriesPerDirectory: 0, maxBytes: 40_960 } }

    // when
    const text = renderExternalProjection(paths, input)
    const stats = renderExternalProjectionStats(paths, input)

    // then
    expect(text.split("\n").slice(1, 2)).toEqual([NAME_LEGEND])
    expect(text.split("\n")).toContain("reference/jobs/<id>/ (3 dirs): MEMORY")
    expect(stats).toMatchObject({ shown: 3, omitted: 0 })
  })
})
