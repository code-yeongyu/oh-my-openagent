import { KEYWORD_DETECTORS } from "../../../packages/omo-opencode/src/hooks/keyword-detector/constants"

const detector = KEYWORD_DETECTORS.find((candidate) => candidate.type === "ultrawork")
if (!detector) throw new Error("ultrawork detector not found")

const scenarios = [
  { text: "ulw", expected: true },
  { text: "please use ulw now", expected: true },
  { text: "ultrawork", expected: true },
  { text: "ulw-loop", expected: true },
  { text: "ulw-plan", expected: false },
  { text: "please use ULW-PLAN for this", expected: false },
  { text: "ulw-research", expected: false },
  { text: "please use ulw-research for this", expected: false },
]

const results = scenarios.map(({ text, expected }) => {
  const actual = detector.pattern.test(text)
  return { text, expected, actual, passed: actual === expected }
})

console.log(JSON.stringify(results, null, 2))
if (results.some((result) => !result.passed)) process.exitCode = 1
