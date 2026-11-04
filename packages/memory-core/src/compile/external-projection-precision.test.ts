import { describe, expect, it } from "bun:test"
import { groupDirectories } from "./external-projection-dirs"
import { directoryItems, type NamedFile } from "./external-projection-names"

// File names are the hint: hiding a meaningful name is the failure, an unfolded id only costs a few tokens.
// MUST-NOT-FOLD: the review's examples, real names from two memory repositories, and common naming shapes.
const MUST_NOT_FOLD: readonly string[] = [
  "ProjectPlan", "MeetingNote", "DesignSpecs", "project2024", "meeting2025", "roadmap2026", "AcmeCorpUS",
  "GlobexInc1", "InitechLLC", "cafe2026",
  "README", "MEMORY", "TAXONOMY", "USER", "ARCHIVE", "SKILL", "card", "bugwatch-resume-20261023-1400Z",
  "effort-per-model-handoff-20261023-1540Z", "release-progress-20261017-0330KST",
  "senpi-upstream-v1-sync-L1-lane-20261002", "jev-storm-node-capability-axisF-20260921", "delivery-20260920",
  "devday-live-20260930", "pricing-sim-20261013", "auth-incident-20261017", "ops-lessons-20261021",
  "omo-sync-20260926", "bunshin-audit-20260824", "skills-cleanup-20260912", "history-2026-10",
  "bun-144-pin-20261025", "claude-haiku-5-5", "qbt-skill-20260929", "1password", "umask077", "ed25519", "react19",
  "electron44", "fable51", "opus55", "bun143", "fetch128", "bash32", "t3code", "haiku55", "ubuntu26", "node18",
  "2point0", "issue12", "revision2", "phase0", "dori-logo-approved-version-20261027",
  "prompt-cache-ttl-and-seat-affinity-20261026",
  "meetingNotesDraft", "designSpecReview", "ProjectAlphaPlan", "QuarterlyReviewQ3", "project_plan_2026",
  "release_notes_v2", "quarterly-review-2026", "budget-2026-q3", "roadmap2027", "budget2026q3", "deadbeef",
  "facade2024", "decade2026", "deadbeefcafe2026", "beef1234", "OAuth2ClientIDv2", "XMLHttpRequest", "TTSRHtmlTags",
  "HTTPSProxyConfig", "KubernetesCRDv1beta1", "IPv6DualStackPlan", "HTML5CanvasNotes", "GitHubActions2024",
  "iPhone15ProMax", "MacBookProM5Max", "Q4OKRPlanning2026", "readUInt16BE", "readUInt16LE", "readUInt32BE",
  "hkdf32Sha256", "includesCtrlC",
  "KubernetesCRDv1b", "XMLHttpRequestV2", "readUInt16BEtest", "MacBookProM5Max1", "TTSRHtmlTagsList", "hkdf32Sha256Keys", "AwsS3BucketPlcy1",
]

// Real routine ids from a memory mirror. Most read as ids on their own and fold; the rest read too much like words
// (wcjyAab9yeccko3U) to fold safely, so they are shown: an unfolded id costs a few tokens, a hidden name costs the hint.
const ROUTINE_IDS_THAT_FOLD: readonly string[] = [
  "WiTJd7hdMOcvppAY", "Y2Gw9vTZ9pnH2K5a", "87U3F2ZseCw7bLMz", "2Fc9uTN3x7DPCCxs", "soGao0XSJE6wRt0J",
  "lBaLsRBYTlx6LgRs", "5IcMoSJd5PnXvx3h", "t4HAYklcxHCYXK7o", "lkXkxLlNrXTOtxtG", "OGA3sYRWtReI3rZZ",
  "uRCVxrAwHN6uzlWR", "5GgEzKLiPiC0txrs", "EUn01XmAFeVHMXui", "adiADzIITRSbT264", "DnOBaqeqU2l9yBXd",
  "4g8zrKAnzJXW6PNY", "86rPvoSqCh92A54c", "QXwpL6fxh3RJCbJm", "8MdLdx02RRWqpQ80", "NonmDnfGsX2x0u76",
  "7IvF7P0RTcuLoPc4", "JTU7hjKLyqNhOQix", "7BMNGMTjN0dwgu8k", "M35Vc9W5nguYFMnx", "OoaxGpI6dEs9BEj4",
  "fQxEpdDAeAIOaa0D", "PjEeqWh6In4nwpk7", "njD7LhUhjyNtsc6c", "P3hWjRcYBMJpa4S2", "3xT5c4MqchOt5NKk",
  "NaNpOQ9AEw6UIr5m", "Fm59REYMOXsdmN5i", "kGbLtm46xxJ5c4U9", "WjckScSNxcNWMxW5", "tbrSF5f952JL5e3E",
  "JpgmrwwY8hF8o1dB", "QCNhgVrxYEa33HnY", "c5trARx5LbMePCh3", "06fwU9k5LQcSBvGR", "WceEXlx1ALVinBQZ",
  "niUfhbca7qbqLQz3", "hG55maxi5Q1owqjm", "Qs4sKVqMY5rVVuk1", "4Lpb8C0sk9eCPze5", "LRZ6vjz79mDkSa0H",
  "NPJEpvFBOVsV0qV8", "hJWq1KDBNNvxs6kH", "aFiiSahlrfT1GI1W", "yVfZCw3LOB1mmcF6", "dIqOyg3U0XlIvNzP",
  "ofEsS41pHazZDJ6W", "jG8YULIYj1IETsQ8", "uK2VQLc2nR49jehL", "gQEsaXD1YHF61biV", "sy87P7rObQpW6YJ0",
  "t36xoxkrQ8Z9AyIz", "a8bEQHp3IYAwZllJ", "lzX031Co8XPKa11v", "rddRlSayfp2Q1AZs", "jIvbHnW6ERuhTn9r",
  "Ii29wfPbNGyzOMlG", "9xEN9l0kW9S79kkE",
]
const ROUTINE_IDS_SHOWN: readonly string[] = [
  "wcjyAab9yeccko3U", "xiiIFULqBVxtbvvl", "NW2sUpGrIeaGKIet", "9TuPENCX913g7lMs", "HameqnJzxQWWoRL4",
  "qwdbxHvtIPOQO4NY", "XpTHKRroIBYxc5em", "YWIvPoWolGY89IFm", "t1fAfVXpiHIDC5Nh", "nMQlomHnfCqCuvnl",
]
const DIGESTS: readonly string[] = [
  "0b6e3c1a-2d4f-4e8a-9b1c-3d5e7f9a1b2c", "1c7f4d2b-3e5a-4f9b-8c2d-4e6f8a0b2c3d", "2d8a5e3c-4f6b-4a0c-9d3e-5f7a9b1c3d4e",
  "2898cea8ffefb2554d95f3a3b96424f574f3eee9", "9e107d9d372bb6826bd81d3542a419d6", "a0e94eed4f0da066",
]
const MUST_FOLD: readonly string[] = [...ROUTINE_IDS_THAT_FOLD, ...DIGESTS]

const files = (names: readonly string[]): NamedFile[] => names.map((name) => ({ name: `${name}.md`, time: 0, files: 1 }))
const byName = (a: string, b: string): number => a.localeCompare(b)
const itemsOf = (names: readonly string[]): string[] => directoryItems(files(names)).map((item) => item.text).sort(byName)
const labelsOf = (names: readonly string[]): string[] =>
  groupDirectories(names.map((name, index) => `ids/${name}/note-${index}.md`), undefined).map((group) => group.label).sort(byName)

describe("generated-id fold precision", () => {
  const table: ReadonlyArray<{ readonly column: string; readonly names: readonly string[]; readonly items: readonly string[]; readonly dirs: readonly string[] }> = [
    { column: "MUST-NOT-FOLD", names: MUST_NOT_FOLD, items: MUST_NOT_FOLD, dirs: MUST_NOT_FOLD.map((name) => `ids/${name}/`) },
    { column: "MUST-FOLD", names: MUST_FOLD, items: [`<id> (${MUST_FOLD.length} files)`], dirs: [`ids/<id>/ (${MUST_FOLD.length} dirs)`] },
  ]

  for (const row of table) {
    it(`#given the ${row.column} names in one directory #when listed as files #then the items are exact`, () => {
      // given
      const names = row.names

      // when
      const items = itemsOf(names)

      // then
      expect(items).toEqual([...row.items].sort(byName))
    })

    it(`#given the ${row.column} names as sibling directories #when grouped #then the line labels are exact`, () => {
      // given
      const names = row.names

      // when
      const labels = labelsOf(names)

      // then
      expect(labels).toEqual([...row.dirs].sort(byName))
    })
  }

  const surroundings: ReadonlyArray<{ readonly name: string; readonly ids: readonly string[]; readonly folded: number; readonly shown: readonly string[] }> = [
    { name: "the real routine ids", ids: [...ROUTINE_IDS_THAT_FOLD, ...ROUTINE_IDS_SHOWN], folded: ROUTINE_IDS_THAT_FOLD.length, shown: ROUTINE_IDS_SHOWN },
    { name: "UUIDs and hex digests", ids: DIGESTS, folded: DIGESTS.length, shown: [] },
  ]

  for (const surrounding of surroundings) {
    it(`#given each MUST-NOT-FOLD name among ${surrounding.name} #when listed as files #then the name is shown and only the ids fold`, () => {
      // given
      const expected = (name: string): string[] => [`<id> (${surrounding.folded} files)`, ...surrounding.shown, name].sort(byName)

      // when
      const wrong = MUST_NOT_FOLD.filter((name) => !Bun.deepEquals(itemsOf([...surrounding.ids, name]), expected(name)))

      // then
      expect(wrong).toEqual([])
    })

    it(`#given each MUST-NOT-FOLD name among ${surrounding.name} #when grouped as sibling directories #then the name is shown and only the ids fold`, () => {
      // given
      const expected = (name: string): string[] =>
        [`ids/<id>/ (${surrounding.folded} dirs)`, ...[...surrounding.shown, name].map((shown) => `ids/${shown}/`)].sort(byName)

      // when
      const wrong = MUST_NOT_FOLD.filter((name) => !Bun.deepEquals(labelsOf([...surrounding.ids, name]), expected(name)))

      // then
      expect(wrong).toEqual([])
    })
  }
})

// Date runs: a number after a date is hint-free only as a clock time (HHMM, HHMMSS, optional zone) or a 1-2 digit
// sequence number; any other number (a ticket, a PR, an HTTP code, a version) is the hint and keeps every name listed.
describe("date-run fold precision", () => {
  const mustList: ReadonlyArray<readonly string[]> = [
    ["review-20261027-11486", "review-20261028-11453", "review-20261029-11501"],
    ["review-20261027-4455", "review-20261028-9727", "review-20261029-3611"],
    ["ticket-20261027-482", "ticket-20261028-517", "ticket-20261029-903"],
    ["incident-20261027-503", "incident-20261028-404", "incident-20261029-500"],
    ["release-20261027-5.1.48", "release-20261028-5.1.49", "release-20261029-5.2.0"],
    ["build-20261027-v2", "build-20261028-v3", "build-20261029-v10"],
    ["deploy-20261027-1200fix", "deploy-20261028-1300api", "deploy-20261029-1400bug"],
  ]
  const mustFold: ReadonlyArray<{ readonly names: readonly string[]; readonly item: string }> = [
    {
      names: ["standup-20261027-0930", "standup-20261028-1015", "standup-20261029-1745"],
      item: "standup-20261027-0930 … standup-20261029-1745 (3 files)",
    },
    {
      names: ["sync-20261027-093015z", "sync-20261028-101500z", "sync-20261029-235959z"],
      item: "sync-20261027-093015z … sync-20261029-235959z (3 files)",
    },
    {
      names: ["progress-20261027-0330KST", "progress-20261028-1508Z", "progress-20261029-2250z"],
      item: "progress-20261027-0330KST … progress-20261029-2250z (3 files)",
    },
    {
      names: ["notes-20261027-1", "notes-20261028-2", "notes-20261029-12"],
      item: "notes-20261027-1 … notes-20261029-12 (3 files)",
    },
  ]

  it("#given each MUST-LIST date run #when listed #then every name stays listed", () => {
    // given
    const runs = mustList

    // when
    const folded = runs.filter((names) => !Bun.deepEquals(itemsOf(names), [...names].sort(byName)))

    // then
    expect(folded).toEqual([])
  })

  it("#given each MUST-FOLD date run #when listed #then it folds into one range", () => {
    // given
    const runs = mustFold

    // when
    const wrong = runs.filter((run) => !Bun.deepEquals(itemsOf(run.names), [run.item]))

    // then
    expect(wrong).toEqual([])
  })

  it("#given a MUST-FOLD run beside a MUST-LIST name of the same prefix #when listed #then only the clock times fold", () => {
    // given
    const names = ["standup-20261027-0930", "standup-20261028-1015", "standup-20261029-1745", "standup-20261030-503"]

    // when
    const items = itemsOf(names)

    // then
    expect(items).toEqual(["standup-20261027-0930 … standup-20261029-1745 (3 files)", "standup-20261030-503"].sort(byName))
  })
})
