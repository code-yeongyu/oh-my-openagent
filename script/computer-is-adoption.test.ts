import { describe, expect, test } from "bun:test"

import { type FixtureRepo, withFixtureRepo } from "./computer-is-fixture-repo.ts"
import { runGates } from "./computer-is-gates.ts"

// `--adoption` guards the adoption ledger (IS-22): every mechanism this program takes from another project is
// taken by a row, a file carrying another project's code has that project's notice, and a row's entries count as
// proven only when a test or scenario is tagged with their id. The tag and port-marker strings below are built by
// concatenation so this file itself never tags or marks the real repository.

const tag = (id: string): string => `[${id}]`
const portMarker = (id: string): string => ["adoption", "port:"].join("-") + ` ${id}`

const header = "id\tsource\thead\tlicence\tverdict\tmechanism\trows"
const ledger = (...lines: string[]): string => `${[header, ...lines].join("\n")}\n`
const entry = (id: string, source: string, verdict: string, rows: string): string =>
  [id, source, "40c6f6ebf8", "MIT", verdict, `mechanism of ${id}`, rows].join("\t")

const notices = (...sources: string[]): string =>
  `# Third Party Notices\n\n${sources.map((source) => `### ${source}\n- License: MIT\n`).join("\n")}`

function seed(repo: FixtureRepo, files: Record<string, string>): void {
  repo.write(files)
  repo.commit("seed")
}

describe("computer-is-gates --adoption", () => {
  test("a ledger whose takeable entries all have rows and whose ported files have notices passes", () => {
    withFixtureRepo((repo) => {
      seed(repo, {
        "script/computer-adoption.tsv": ledger(
          entry("ADP-1", "goat-cu", "adopt", "4"),
          entry("ADP-2", "oh-my-pi", "probe", "3, 21"),
          entry("ADP-3", "goat", "reject", ""),
        ),
        "THIRD-PARTY-NOTICES.md": notices("goat-cu"),
        "crates/x/src/catalog.rs": `// ${portMarker("ADP-1")}\nfn main() {}\n`,
      })

      const result = runGates(["--adoption"], repo.options)

      expect(result.lines).toEqual(["ADOPTION entries=3 covered=2 notices=ok"])
      expect(result.exitCode).toBe(0)
    })
  })

  test("an adopt, adapt or probe entry taken by no row fails and is named", () => {
    withFixtureRepo((repo) => {
      seed(repo, {
        "script/computer-adoption.tsv": ledger(
          entry("ADP-1", "goat-cu", "adopt", "4"),
          entry("ADP-2", "goat", "adapt", ""),
        ),
        "THIRD-PARTY-NOTICES.md": notices(),
      })

      const result = runGates(["--adoption"], repo.options)

      expect(result.lines).toEqual(["ADOPTION entries=2 covered=1 notices=ok", "ADOPTION ADP-2 taken by no row"])
      expect(result.exitCode).toBe(1)
    })
  })

  test("a file that carries another project's code without that project's notice fails", () => {
    withFixtureRepo((repo) => {
      seed(repo, {
        "script/computer-adoption.tsv": ledger(
          entry("ADP-1", "goat-cu", "adopt", "4"),
          entry("ADP-2", "goat", "adopt", "5"),
        ),
        "THIRD-PARTY-NOTICES.md": notices("goat-cu"),
        "crates/x/src/seat.rs": `// ${portMarker("ADP-2")}\n`,
      })

      const result = runGates(["--adoption"], repo.options)

      expect(result.lines).toEqual([
        "ADOPTION entries=2 covered=2 notices=missing",
        "ADOPTION crates/x/src/seat.rs carries ADP-2 (goat) without a goat notice in THIRD-PARTY-NOTICES.md",
      ])
      expect(result.exitCode).toBe(1)
    })
  })

  test("a malformed ledger line is a finding, never a smaller passing ledger", () => {
    withFixtureRepo((repo) => {
      seed(repo, {
        "script/computer-adoption.tsv": ledger(
          entry("ADP-1", "goat-cu", "adopt", "4"),
          entry("ADP-2", "goat", "borrow", "5"),
        ),
        "THIRD-PARTY-NOTICES.md": notices(),
      })

      const result = runGates(["--adoption"], repo.options)

      expect(result.exitCode).toBe(1)
      expect(result.lines).toContain("ADOPTION ledger line 3: verdict 'borrow' is not adopt, adapt, probe or reject")
    })
  })
})

describe("computer-is-gates --adoption ledger rules", () => {
  const cases: readonly { readonly name: string; readonly lines: readonly string[]; readonly finding: string }[] = [
    {
      name: "a duplicate id",
      lines: [entry("ADP-1", "goat-cu", "adopt", "4"), entry("ADP-1", "goat", "adopt", "5")],
      finding: "ADOPTION ledger line 3: id ADP-1 appears twice",
    },
    {
      name: "a rejected entry that names rows",
      lines: [entry("ADP-1", "goat-cu", "reject", "4")],
      finding: "ADOPTION ledger line 2: ADP-1 is rejected but names rows 4",
    },
    {
      name: "a row number past the program's last row",
      lines: [entry("ADP-1", "goat-cu", "adopt", "4, 999")],
      finding: "ADOPTION ledger line 2: ADP-1 names row 999, outside the program's rows 1-51",
    },
    {
      name: "row 0",
      lines: [entry("ADP-1", "goat-cu", "adopt", "0")],
      finding: "ADOPTION ledger line 2: ADP-1 names row 0, outside the program's rows 1-51",
    },
    { name: "a ledger with no entries", lines: [], finding: "ADOPTION ledger has no entries" },
  ]
  for (const { name, lines, finding } of cases) {
    test(`${name} is a finding`, () => {
      withFixtureRepo((repo) => {
        seed(repo, { "script/computer-adoption.tsv": ledger(...lines), "THIRD-PARTY-NOTICES.md": notices() })

        const result = runGates(["--adoption"], repo.options)

        expect(result.exitCode).toBe(1)
        expect(result.lines).toContain(finding)
      })
    })
  }
})

describe("computer-is-gates --adoption --row", () => {
  test("counts a row's entries and the ones a tracked test or scenario is tagged with", () => {
    withFixtureRepo((repo) => {
      seed(repo, {
        "script/computer-adoption.tsv": ledger(
          entry("ADP-2", "goat-cu", "adopt", "3"),
          entry("ADP-4", "goat-cu", "adopt", "3"),
          entry("ADP-5", "goat-cu", "adopt", "7"),
        ),
        "THIRD-PARTY-NOTICES.md": notices(),
        "script/qa/computer/sentinel/summary.test.ts": `test("observer ${tag("ADP-2")}", () => {})\n`,
        "docs/notes.md": `${tag("ADP-4")} is mentioned in prose, which proves nothing\n`,
      })

      const partial = runGates(["--adoption", "--row", "3"], repo.options)
      expect(partial.lines).toEqual([
        "ADOPTION row=3 entries=2 proven=1",
        "ADOPTION row=3 ADP-4 has no tagged test or scenario",
      ])
      expect(partial.exitCode).toBe(1)

      seed(repo, { "script/qa/computer/sentinel/scenarios/warp.ts": `export const warp = "${tag("ADP-4")}"\n` })
      const full = runGates(["--adoption", "--row", "3"], repo.options)
      expect(full.lines).toEqual(["ADOPTION row=3 entries=2 proven=2"])
      expect(full.exitCode).toBe(0)
    })
  })

  test("a row that takes no ledger entry fails instead of reporting an empty pass", () => {
    withFixtureRepo((repo) => {
      seed(repo, {
        "script/computer-adoption.tsv": ledger(entry("ADP-1", "goat-cu", "adopt", "4")),
        "THIRD-PARTY-NOTICES.md": notices(),
      })

      const result = runGates(["--adoption", "--row", "7"], repo.options)

      expect(result.lines).toEqual(["ADOPTION row=7 entries=0 proven=0", "ADOPTION row=7 takes no ledger entry"])
      expect(result.exitCode).toBe(1)
    })
  })

  test("a row number that is not a positive integer is a usage error", () => {
    withFixtureRepo((repo) => {
      seed(repo, { "script/computer-adoption.tsv": ledger(), "THIRD-PARTY-NOTICES.md": notices() })

      expect(runGates(["--adoption", "--row", "three"], repo.options).exitCode).toBe(2)
    })
  })
})
