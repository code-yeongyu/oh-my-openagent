import { describe, expect, test } from "bun:test"

import { describeInvalidHint, isValidHint, validateNudges } from "./gate"

const path = "reference/a.md"
const options = { candidates: new Set([path]), surfaced: new Set<string>(), maxItems: 1 }

/** Hints that speak TO the agent: second person, an imperative opening, or a Korean request ending. */
const ADDRESSING_HINTS = [
  "You must run the green-main guard before publishing.",
  "Your worktree rebase has to wait for the child task.",
  "The guard is yours to keep green before a publish.",
  "Rebase the worktree yourself once the child task finishes.",
  "Do not rebase this worktree until the child task finishes.",
  "Don't rebase this worktree while a child task writes in it.",
  "Never run the test suite on this machine.",
  "Always push the branch before asking for a remote run.",
  "Make sure the release note is updated first.",
  "Ensure the green-main guard passes before publishing.",
  "Verify these before continuing.",
  "Check the rollout guard before deploying.",
  "Run the remote runner instead of a local suite.",
  "Use the remote runner for every test path.",
  "Read the head-watch note before rebasing.",
  "Stop the rebase while a child task is mid-write.",
  "Avoid rebasing a worktree mid-write.",
  "Remember that the guard stays green before a publish.",
  "Keep the child task alive until it finishes writing.",
  "Prefer the remote runner over a local run.",
  "Skip the local test run on this machine.",
  "Consider queueing the rebase until the child finishes.",
  '"Do not rebase the worktree while a child task writes in it."',
  "  don't rebase the worktree while a child task writes in it.",
]

const KOREAN_ADDRESSING_HINTS = [
  "원격 러너로 테스트를 실행하세요",
  "머지 전에 그린 메인 가드를 확인하십시오!",
  "이 머신에서는 테스트를 로컬로 돌리지 마세요.",
  "자식 작업이 끝날 때까지 리베이스하지 마십시오.",
  "커밋 메시지는 파일로 작성해 주세요.",
  "커밋 메시지는 파일로 작성해주세요.",
  "푸시 전에 타입체크를 하라.",
  "푸시 전에 타입체크를 해라.",
  "릴리스 전에 그린 메인 가드를 통과해야 합니다.",
  "원격 러너를 사용하십시요.",
  "브랜치를 강제로 푸시하지 마.",
  "이 머신에서 테스트를 돌리지 마라",
]

/** Observations about the stored note: the only shape the nudge block is allowed to carry. */
const OBSERVATIONAL_HINTS = [
  "The release note records that publish must follow the green-main guard.",
  "The head-watch note records that a rebase during a child task's write corrupted its edits.",
  "The note records that the team never runs the suite locally on this machine.",
  "The deploy note records that the guard must always stay green before a publish.",
  "The runbook records that checking the rollout guard is the release step.",
  "Runs of the suite are remote-only according to the stored note.",
  "The stored note keeps the remote runner as the only test path.",
  "The incident note records that reading the head-watch rule came after the corruption.",
]

const KOREAN_OBSERVATIONAL_HINTS = [
  "메모는 이 머신에서 테스트를 로컬로 실행하지 않는다고 기록한다.",
  "노트에 적힌 규칙은 자식 작업이 끝날 때까지 리베이스를 미루는 것이다.",
  "저장된 메모에는 커밋 메시지를 파일로 작성한 사례가 있다.",
]

describe("describeInvalidHint", () => {
  test("#given a hint that breaks the shape budget #when described #then the shape reason is named", () => {
    // given / when / then
    expect(describeInvalidHint("")).toBe("empty")
    expect(describeInvalidHint("x".repeat(201))).toBe("too-long")
    expect(describeInvalidHint("line one\nline two")).toBe("multiline")
    expect(describeInvalidHint("This memory is not relevant to the task.")).toBe("decision-commentary")
  })

  test.each([...ADDRESSING_HINTS, ...KOREAN_ADDRESSING_HINTS])(
    "#given the agent-addressing hint %s #when described #then the reason is addresses-agent",
    (hint) => {
      expect(describeInvalidHint(hint)).toBe("addresses-agent")
    },
  )

  test.each([...OBSERVATIONAL_HINTS, ...KOREAN_OBSERVATIONAL_HINTS])(
    "#given the observational hint %s #when described #then no reason is returned",
    (hint) => {
      expect(describeInvalidHint(hint)).toBeUndefined()
    },
  )
})

describe("validateNudges under the nudge-only contract", () => {
  test.each([...ADDRESSING_HINTS, ...KOREAN_ADDRESSING_HINTS])(
    "#given the agent-addressing hint %s #when revalidated #then it is dropped without reserving its path",
    (hint) => {
      // given / when
      const corrected = { path, hint: OBSERVATIONAL_HINTS[0]! }

      // then
      expect(validateNudges([{ path, hint }], options)).toEqual([])
      expect(validateNudges([{ path, hint }, corrected], options)).toEqual([corrected])
    },
  )

  test.each([...OBSERVATIONAL_HINTS, ...KOREAN_OBSERVATIONAL_HINTS])(
    "#given the observational hint %s #when revalidated #then it survives unchanged",
    (hint) => {
      // given / when / then
      expect(validateNudges([{ path, hint }], options)).toEqual([{ path, hint }])
    },
  )
})

describe("isValidHint after the nudge-only contract", () => {
  test.each([...OBSERVATIONAL_HINTS, ...KOREAN_OBSERVATIONAL_HINTS])(
    "#given the observational hint %s #when checked #then the shape predicate still accepts it",
    (hint) => {
      expect(isValidHint(hint)).toBe(true)
    },
  )

  test("#given an instruction-shaped hint from an older session #when checked #then the shape predicate still accepts it", () => {
    // given: `isValidHint` is the REPLAY predicate (stored pending payloads and the `omo-kibitzer:nudged`
    // renderer). Nudges accepted before this contract existed must keep rendering and keep being
    // delivered; only admission - the nudge tool and `validateNudges` - applies the nudge-only rule.
    const stored = "Use the idle wake path."

    // when / then
    expect(isValidHint(stored)).toBe(true)
    expect(describeInvalidHint(stored)).toBe("addresses-agent")
  })

  test("#given a hint that breaks the shape budget #when checked #then the shape predicate still rejects it", () => {
    // given / when / then
    expect(isValidHint("")).toBe(false)
    expect(isValidHint("x".repeat(201))).toBe(false)
    expect(isValidHint("line one\nline two")).toBe(false)
    expect(isValidHint("This memory is not relevant to the task.")).toBe(false)
  })
})
