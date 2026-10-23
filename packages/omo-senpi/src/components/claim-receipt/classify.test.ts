/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { type Claim, classifyClaims } from "./classify"

function only(text: string): Claim {
  const claims = classifyClaims(text)
  expect(claims).toHaveLength(1)
  return claims[0] as Claim
}

function shape(text: string): Pick<Claim, "kind" | "strength" | "admitted"> {
  const { kind, strength, admitted } = only(text)
  return { kind, strength, admitted }
}

describe("claim-receipt classifier", () => {
  describe("#given an English success claim", () => {
    it("#then finds asserted test, typecheck, build, exists and done claims", () => {
      expect(shape("All tests pass.")).toEqual({ kind: "test", strength: "asserted", admitted: false })
      expect(shape("tsc is clean.")).toEqual({ kind: "typecheck", strength: "asserted", admitted: false })
      expect(shape("No type errors.")).toEqual({ kind: "typecheck", strength: "asserted", admitted: false })
      expect(shape("The build succeeds.")).toEqual({ kind: "build", strength: "asserted", admitted: false })
      expect(shape("This already exists in `auth.ts`.")).toEqual({ kind: "exists", strength: "asserted", admitted: false })
      expect(shape("Done.")).toEqual({ kind: "done", strength: "asserted", admitted: false })
    })
  })

  describe("#given a Korean success claim", () => {
    it("#then finds the claim without relying on word boundaries", () => {
      expect(shape("테스트 모두 통과했어요.")).toEqual({ kind: "test", strength: "asserted", admitted: false })
      expect(shape("테스트통과")).toEqual({ kind: "test", strength: "asserted", admitted: false })
      expect(shape("빌드 성공.")).toEqual({ kind: "build", strength: "asserted", admitted: false })
      expect(shape("타입 에러 없음.")).toEqual({ kind: "typecheck", strength: "asserted", admitted: false })
      expect(shape("이미 구현되어 있어요.")).toEqual({ kind: "exists", strength: "asserted", admitted: false })
      expect(shape("수정 완료했습니다.")).toEqual({ kind: "done", strength: "asserted", admitted: false })
    })
  })

  describe("#given a numeric result report in prose", () => {
    it("#then treats zero failures as an asserted test claim", () => {
      expect(shape("Result: 0 failed.")).toEqual({ kind: "test", strength: "asserted", admitted: false })
      expect(shape("142/142 pass.")).toEqual({ kind: "test", strength: "asserted", admitted: false })
      expect(shape("실패 0건이에요.")).toEqual({ kind: "test", strength: "asserted", admitted: false })
      expect(shape("35 pass, 0 fail.")).toEqual({ kind: "test", strength: "asserted", admitted: false })
    })

    it("#then a report with nonzero failures is not a success claim", () => {
      expect(classifyClaims("3 failed, 10 passed.")).toEqual([])
      expect(classifyClaims("실패 2건, 통과 40건.")).toEqual([])
    })
  })

  describe("#given a hedged claim", () => {
    it("#then keeps it as a hedged claim", () => {
      expect(shape("Tests should pass.")).toEqual({ kind: "test", strength: "hedged", admitted: false })
      expect(shape("This should pass now.")).toEqual({ kind: "test", strength: "hedged", admitted: false })
      expect(shape("통과할 거예요.")).toEqual({ kind: "test", strength: "hedged", admitted: false })
    })
  })

  describe("#given an explicit admission that the check did not run", () => {
    it("#then marks the claim admitted, including an admission in the neighbouring sentence", () => {
      expect(only("I did not run the tests; they should pass.").admitted).toBe(true)
      expect(only("Tests should pass. I have not run them yet.").admitted).toBe(true)
      expect(only("테스트는 아직 안 돌렸어요. 통과할 거예요.").admitted).toBe(true)
      expect(only("빌드는 성공할 것 같아요 (미검증).").admitted).toBe(true)
    })
  })

  describe("#given a negated sentence", () => {
    it("#then finds no success claim in English or in Korean conjugations", () => {
      expect(classifyClaims("Tests do not pass.")).toEqual([])
      expect(classifyClaims("The build isn't green yet.")).toEqual([])
      expect(classifyClaims("통과하지 못했어요.")).toEqual([])
      expect(classifyClaims("테스트가 통과하지 않았습니다.")).toEqual([])
      expect(classifyClaims("미통과 2건이 남았어요.")).toEqual([])
      expect(classifyClaims("불통과예요.")).toEqual([])
      expect(classifyClaims("아닙니다, 아직 실패합니다.")).toEqual([])
      expect(classifyClaims("아직 구현되어 있지 않아요.")).toEqual([])
    })
  })

  describe("#given claims inside code, quotes, blockquotes or a relayed report", () => {
    it("#then ignores them", () => {
      expect(classifyClaims("Run `all tests pass` as the label.")).toEqual([])
      expect(classifyClaims("```\n46 pass\n0 fail\n```")).toEqual([])
      expect(classifyClaims("> All tests pass.")).toEqual([])
      expect(classifyClaims('He wrote "all tests pass" in the PR.')).toEqual([])
      expect(classifyClaims("그는 \u201C테스트 모두 통과\u201D라고 적었어요.")).toEqual([])
      expect(classifyClaims("그는 「빌드 성공」이라고 했어요.")).toEqual([])
      expect(classifyClaims("[REPORT] all tests pass and the build succeeds.")).toEqual([])
    })
  })

  describe("#given a conditional or future statement about a check", () => {
    it("#then does not treat the condition as a claim", () => {
      expect(classifyClaims("If the suite passes, I send READY to the lead.")).toEqual([])
      expect(classifyClaims("Its earlier review carries over once both bundle checks pass.")).toEqual([])
      expect(classifyClaims("Delta reviews get enqueued as each suite finishes green.")).toEqual([])
      expect(classifyClaims("It runs the test to show whether the failure already exists on dev.")).toEqual([])
      expect(classifyClaims("Ask: run the lane - wanted: every item merged and the prod test passed.")).toEqual([])
      expect(classifyClaims("테스트가 통과하면 머지할게요.")).toEqual([])
    })
  })

  describe("#given words that only resemble a claim", () => {
    it("#then a version suffix, a lane action or a possession is not a claim", () => {
      expect(classifyClaims("Gate v2 passed at 11:56.")).toEqual([])
      expect(classifyClaims("That alert is one I've already handled.")).toEqual([])
      expect(classifyClaims("A machine that already has memory gets the label.")).toEqual([])
      expect(classifyClaims("\uC774\uBBF8 \uAD6C\uD604\uB41C \uD568\uC218\uB97C \uC7AC\uC0AC\uC6A9\uD588\uC2B5\uB2C8\uB2E4.")).toEqual([])
    })
  })

  describe("#given a concrete result report", () => {
    it("#then marks claims that quote observed numbers or exit codes as reported", () => {
      expect(only("The rerun exited 0 with 343 passing.").reported).toBe(true)
      expect(only("Result: 0 failed.").reported).toBe(true)
      expect(only("88 related tests pass, along with typecheck.").reported).toBe(true)
      expect(only("After the fix the crypto suite passes 135 of 135.").reported).toBe(true)
      expect(only("All tests pass.").reported).toBe(false)
      expect(only("Tests should pass.").reported).toBe(false)
    })
  })

  describe("#given done inside an ordinary sentence", () => {
    it("#then does not treat it as a completion claim", () => {
      expect(classifyClaims("Once this is done we can merge.")).toEqual([])
      expect(classifyClaims("What should be done next is a review.")).toEqual([])
      expect(classifyClaims("Sign-in went through, and launch 1 of 3 is done.")).toEqual([])
    })
  })

  describe("#given a multi-sentence answer", () => {
    it("#then returns one claim per claiming sentence with its sentence text", () => {
      const claims = classifyClaims("I fixed the parser.\nAll tests pass.\n빌드도 성공했어요.")
      expect(claims.map((claim) => [claim.kind, claim.sentence])).toEqual([
        ["test", "All tests pass."],
        ["build", "빌드도 성공했어요."],
      ])
    })
  })
})
