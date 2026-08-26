import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  dagDefinitionFingerprint,
  dagFingerprint,
  diffNodeFingerprints,
  nodeFingerprintInput,
  ownerFingerprintInput,
  type DagDefinitionFingerprintInputV1,
  type DagNodeFingerprintInputV1,
} from "./fingerprint"
import type { DagOwnerFingerprintInput } from "./owner"
import type { DagNodeId, DagRoute } from "./types"

const nodeId = (value: string): DagNodeId => value as DagNodeId

const categoryRoute: DagRoute = { kind: "category", category: "quick" }
const agentRoute: DagRoute = { kind: "agent", agent: "omo", model: "gpt-5.6" }

const baseNode: DagNodeFingerprintInputV1 = {
  nodeId: nodeId("a"),
  label: "Node A",
  dependsOn: [nodeId("b"), nodeId("c")],
  prompt: "summarize the repo",
  route: categoryRoute,
  childName: "child-a",
}

const baseDefinition: DagDefinitionFingerprintInputV1 = {
  name: "example",
  scheduler: {
    waveAdmission: "dependency-frontier",
    failurePolicy: "continue-independent",
    dependencyData: "filesystem-only",
  },
  nodes: [baseNode],
}

describe("dagFingerprint canonicalization", () => {
  it("#given key order differs #when fingerprinted #then identical hashes", () => {
    const a = dagFingerprint({ alpha: 1, beta: 2, nested: { y: 1, x: 2 } })
    const b = dagFingerprint({ nested: { x: 2, y: 1 }, beta: 2, alpha: 1 })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it("#given undefined fields #when fingerprinted #then omitted as if absent", () => {
    const withUndefined = dagFingerprint({ a: 1, b: undefined })
    const without = dagFingerprint({ a: 1 })
    expect(withUndefined).toBe(without)
  })

  it("#given arrays with different order #when fingerprinted #then different hashes", () => {
    const first = dagFingerprint([1, 2, 3])
    const second = dagFingerprint([3, 2, 1])
    expect(first).not.toBe(second)
  })

  it("#given strings differing by whitespace only #when fingerprinted #then different hashes", () => {
    expect(dagFingerprint("hello world")).not.toBe(dagFingerprint("hello  world"))
    expect(dagFingerprint("hello")).not.toBe(dagFingerprint("hello\n"))
  })
})

describe("dagDefinitionFingerprint", () => {
  it("#given reordered dependsOn #when fingerprinted #then identical fingerprints", () => {
    const reordered: DagDefinitionFingerprintInputV1 = {
      ...baseDefinition,
      nodes: [{ ...baseNode, dependsOn: [nodeId("c"), nodeId("b")] }],
    }
    expect(dagDefinitionFingerprint(reordered)).toBe(dagDefinitionFingerprint(baseDefinition))
  })

  it("#given reordered node list #when fingerprinted #then identical fingerprints", () => {
    const other: DagNodeFingerprintInputV1 = {
      nodeId: nodeId("z"),
      label: "Node Z",
      dependsOn: [],
      prompt: "second task",
      route: agentRoute,
      childName: "child-z",
    }
    const forward = dagDefinitionFingerprint({ ...baseDefinition, nodes: [baseNode, other] })
    const backward = dagDefinitionFingerprint({ ...baseDefinition, nodes: [other, baseNode] })
    expect(forward).toBe(backward)
  })

  it("#given a one-character change in the original prompt #when fingerprinted #then different fingerprints", () => {
    const changed: DagDefinitionFingerprintInputV1 = {
      ...baseDefinition,
      nodes: [{ ...baseNode, prompt: "summarize the repO" }],
    }
    expect(dagDefinitionFingerprint(changed)).not.toBe(dagDefinitionFingerprint(baseDefinition))
  })

  it("#given semantically identical definitions built independently #when fingerprinted #then identical", () => {
    const rebuilt: DagDefinitionFingerprintInputV1 = {
      scheduler: {
        dependencyData: "filesystem-only",
        failurePolicy: "continue-independent",
        waveAdmission: "dependency-frontier",
      },
      nodes: [
        {
          prompt: "summarize the repo",
          route: { kind: "category", category: "quick" },
          dependsOn: [nodeId("b"), nodeId("c")],
          label: "Node A",
          nodeId: nodeId("a"),
          childName: "child-a",
        },
      ],
      name: "example",
    }
    expect(dagDefinitionFingerprint(rebuilt)).toBe(dagDefinitionFingerprint(baseDefinition))
  })

  it("#given the same submitted definition across a skill file change on disk #when fingerprinted twice #then identical", async () => {
    const skillDirectory = mkdtempSync(join(tmpdir(), "dag-fingerprint-skill-"))
    const skillPath = join(skillDirectory, "skill.md")
    try {
      // given: a skill file exists with version 1 content
      await Bun.write(skillPath, "# skill v1")

      // when: the submitted definition is fingerprinted, then the skill file changes, then fingerprinted again
      const before = dagDefinitionFingerprint(baseDefinition)
      await Bun.write(skillPath, "# skill v2 with different content and digest")
      const after = dagDefinitionFingerprint(baseDefinition)

      // then: fingerprints cover the submitted definition only, never skill content
      expect(after).toBe(before)
    } finally {
      rmSync(skillDirectory, { recursive: true, force: true })
    }
  })

  it("#given optional node fields present #when fingerprinted #then included in the hash", () => {
    const withOptionals: DagDefinitionFingerprintInputV1 = {
      ...baseDefinition,
      nodes: [{ ...baseNode, taskSummary: "short", description: "long" }],
    }
    expect(dagDefinitionFingerprint(withOptionals)).not.toBe(dagDefinitionFingerprint(baseDefinition))
  })
})

describe("nodeFingerprintInput", () => {
  it("#given a node input with unsorted dependsOn #when normalized #then sorts dependsOn and keeps the original prompt", () => {
    const normalized = nodeFingerprintInput({
      nodeId: nodeId("n"),
      label: "L",
      dependsOn: [nodeId("d"), nodeId("a")],
      prompt: "exact prompt  as submitted",
      route: agentRoute,
      childName: "child-n",
    })
    expect(normalized.dependsOn).toEqual([nodeId("a"), nodeId("d")])
    expect(normalized.prompt).toBe("exact prompt  as submitted")
  })
})

describe("ownerFingerprintInput", () => {
  const ownerInput: DagOwnerFingerprintInput = {
    definitionFingerprint: "def-abc",
    nodeId: nodeId("node-x"),
  }

  it("#given execAttempt is 0 #when fingerprinted #then matches the pinned legacy hash", () => {
    const input = ownerFingerprintInput({ ...ownerInput, execAttempt: 0 })
    expect(dagFingerprint(input)).toBe(
      "8abfeef1a4832e7dd31064a56f785ae0253851596b4a650d6ec8a849620e58dc",
    )
  })

  it("#given execAttempt is omitted #when fingerprinted #then matches the pinned legacy hash", () => {
    const input = ownerFingerprintInput(ownerInput)
    expect(dagFingerprint(input)).toBe(
      "8abfeef1a4832e7dd31064a56f785ae0253851596b4a650d6ec8a849620e58dc",
    )
  })

  it("#given execAttempt is 1 #when fingerprinted #then differs from the legacy hash", () => {
    const legacy = ownerFingerprintInput({ ...ownerInput, execAttempt: 0 })
    const retry1 = ownerFingerprintInput({ ...ownerInput, execAttempt: 1 })
    expect(dagFingerprint(retry1)).not.toBe(dagFingerprint(legacy))
  })
})

describe("diffNodeFingerprints", () => {
  const base: DagNodeFingerprintInputV1 = {
    nodeId: nodeId("a"),
    label: "A",
    dependsOn: [],
    prompt: "do a",
    route: categoryRoute,
    childName: "child-a",
  }

  const sibling: DagNodeFingerprintInputV1 = {
    nodeId: nodeId("b"),
    label: "B",
    dependsOn: [],
    prompt: "do b",
    route: categoryRoute,
    childName: "child-b",
  }

  const dropped: DagNodeFingerprintInputV1 = {
    nodeId: nodeId("d"),
    label: "D",
    dependsOn: [],
    prompt: "do d",
    route: categoryRoute,
    childName: "child-d",
  }

  it("#given changed/unchanged/added/removed nodes #when diffed #then classifies each bucket correctly", () => {
    const oldNodes = [base, sibling, dropped]
    const newNodes = [
      { ...base, prompt: "do a changed" },
      sibling,
      {
        nodeId: nodeId("c"),
        label: "C",
        dependsOn: [],
        prompt: "do c",
        route: categoryRoute,
        childName: "child-c",
      },
    ]

    const result = diffNodeFingerprints(oldNodes, newNodes)

    expect(result.unchangedIds).toEqual([nodeId("b")])
    expect(result.changedIds).toEqual([nodeId("a")])
    expect(result.addedIds).toEqual([nodeId("c")])
    expect(result.removedIds).toEqual([nodeId("d")])
  })
})
