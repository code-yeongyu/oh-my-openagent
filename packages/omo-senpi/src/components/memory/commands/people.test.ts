import { describe, expect, test } from "bun:test"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke, seededRepo, tempIdentity } from "./commands.test-support"
import { derivePeopleGraph, registerPeopleCommand, resolvePersonQuery } from "./people"
import { LIMITS, peopleFixture, tempDirs } from "./people.test-support"

describe("people graph derivation", () => {
  test("#given three cards with four RELATIONSHIP lines #when the graph is derived #then nodes and edges match those lines exactly", async () => {
    // given
    const identity = await peopleFixture()
    const deps = fakeDeps(identity)

    // when
    const graph = await derivePeopleGraph(deps, identity, LIMITS)

    // then
    expect(graph.nodes.map((node) => node.slug).sort()).toEqual(["human", "jane-doe", "nia-blank", "sam-rivers"])
    expect(graph.edges).toEqual([
      { source: "human", predicate: "works-with", target: "jane-doe", targetSlug: "jane-doe" },
      { source: "human", predicate: "mentors", target: "sam-rivers", targetSlug: "sam-rivers" },
      { source: "jane-doe", predicate: "reports-to", target: "human", targetSlug: "human" },
      { source: "sam-rivers", predicate: "collaborates", target: "unknown-person", targetSlug: undefined },
    ])
  }, 30_000)

  test("#given a repository without any card #when the graph is derived #then it holds no node and no edge", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    await seededRepo(identity, [{ relativePath: "system/persona.md", content: "---\ndescription: P\n---\nbody\n" }])
    const deps = fakeDeps(identity)

    // when
    const graph = await derivePeopleGraph(deps, identity, LIMITS)

    // then
    expect(graph.nodes).toEqual([])
    expect(graph.edges).toEqual([])
  }, 30_000)
})

describe("person query resolution", () => {
  test("#given an alias #when the query resolves #then it hits the owning slug", async () => {
    // given
    const identity = await peopleFixture()
    const graph = await derivePeopleGraph(fakeDeps(identity), identity, LIMITS)

    // when
    const resolved = resolvePersonQuery(graph.nodes, "jd")

    // then
    expect(resolved).toEqual({ kind: "hit", slug: "jane-doe" })
  }, 30_000)

  test("#given an unknown name #when the query resolves #then it misses with close slugs", async () => {
    // given
    const identity = await peopleFixture()
    const graph = await derivePeopleGraph(fakeDeps(identity), identity, LIMITS)

    // when
    const resolved = resolvePersonQuery(graph.nodes, "jane doh")

    // then
    expect(resolved).toEqual({ kind: "miss", close: ["jane-doe"] })
  }, 30_000)
})

describe("/people command", () => {
  test("#given a fixture repository #when /people runs #then the derived roster and edge sets are surfaced through one notification", async () => {
    // given
    const identity = await peopleFixture()
    const deps = fakeDeps(identity)
    const pi = new MemoryFakeExtensionAPI()
    registerPeopleCommand(pi, deps)
    const ctx = fakeCommandContext()

    // when
    const graph = await derivePeopleGraph(deps, identity, LIMITS)
    const text = await invoke(pi, "people", "", ctx)

    // then
    expect(new Set(graph.nodes.map((node) => node.slug))).toEqual(new Set(["human", "jane-doe", "nia-blank", "sam-rivers"]))
    expect(new Set(graph.edges.map((edge) => `${edge.source}:${edge.predicate}:${edge.target}`))).toEqual(new Set([
      "human:works-with:jane-doe",
      "human:mentors:sam-rivers",
      "jane-doe:reports-to:human",
      "sam-rivers:collaborates:unknown-person",
    ]))
    expect(ctx.ui.notifications).toEqual([{ message: text, level: "info" }])
  }, 30_000)

  test("#given an unknown name #when /people runs #then the structural query miss and error notification preserve close slugs", async () => {
    // given
    const identity = await peopleFixture()
    const deps = fakeDeps(identity)
    const pi = new MemoryFakeExtensionAPI()
    registerPeopleCommand(pi, deps)
    const ctx = fakeCommandContext()

    // when
    const graph = await derivePeopleGraph(deps, identity, LIMITS)
    const resolution = resolvePersonQuery(graph.nodes, "jane doh")
    const text = await invoke(pi, "people", "jane doh", ctx)

    // then
    expect(resolution).toEqual({ kind: "miss", close: ["jane-doe"] })
    expect(ctx.ui.notifications).toEqual([{ message: text, level: "error" }])
  }, 30_000)

})
