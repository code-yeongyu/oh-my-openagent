import { describe, expect, test } from "bun:test"

import { lintDagDefinitionNodes } from "./dag-lint"

const CONTRACT_PROMPT =
  "TASK: Draft the release notes. DELIVERABLE: docs/RELEASE.md updated. SCOPE: write docs/RELEASE.md only. VERIFY: test -f docs/RELEASE.md. STOP WHEN: the file exists and lists every merged PR."

describe("dag definition lint", () => {
  test("#given nodes carrying the full prompt contract #when linted #then no warnings", () => {
    // given
    const nodes = [
      { id: "plan", prompt: CONTRACT_PROMPT },
      { id: "verify", prompt: `${CONTRACT_PROMPT} Verify the output.` },
    ]

    // when
    const warnings = lintDagDefinitionNodes(nodes)

    // then
    expect(warnings).toEqual([])
  })

  test("#given a node missing the TASK marker #when linted #then the warning names the node and the contract", () => {
    // given
    const nodes = [{ id: "plan", prompt: "draft the plan. STOP WHEN: done" }]

    // when
    const warnings = lintDagDefinitionNodes(nodes)

    // then
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"plan"')
    expect(warnings[0]).toContain("TASK:")
  })

  test("#given a node missing STOP WHEN #when linted #then the warning names the node and the stop condition", () => {
    // given
    const nodes = [{ id: "build", prompt: "TASK: build it. DELIVERABLE: dist/. SCOPE: dist only. VERIFY: bun run build." }]

    // when
    const warnings = lintDagDefinitionNodes(nodes)

    // then
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"build"')
    expect(warnings[0]).toContain("STOP WHEN")
  })

  test("#given a multi-node run without a verification node #when linted #then one run-level warning fires", () => {
    // given
    const producerPrompt =
      "TASK: Draft the release notes. DELIVERABLE: docs/RELEASE.md updated. SCOPE: write docs/RELEASE.md only. STOP WHEN: the file lists every merged PR."
    const nodes = [
      { id: "plan", prompt: producerPrompt },
      { id: "build", prompt: producerPrompt, dependsOn: ["plan"] },
    ]

    // when
    const warnings = lintDagDefinitionNodes(nodes)

    // then
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("verification")
  })

  test("#given a multi-node run whose verification lives in a node id #when linted #then no run-level warning", () => {
    // given
    const nodes = [
      { id: "plan", prompt: CONTRACT_PROMPT },
      { id: "qa-gate", prompt: CONTRACT_PROMPT, dependsOn: ["plan"] },
    ]

    // when
    const warnings = lintDagDefinitionNodes(nodes)

    // then
    expect(warnings).toEqual([])
  })

  test("#given a single-node run without verification shape #when linted #then no run-level warning", () => {
    // given
    const nodes = [{ id: "plan", prompt: CONTRACT_PROMPT }]

    // when
    const warnings = lintDagDefinitionNodes(nodes)

    // then
    expect(warnings).toEqual([])
  })
})
