import { afterAll, afterEach, beforeEach } from "bun:test"
import { PostHog } from "posthog-node"

// A test process never sends product telemetry, and no PostHog client outlives the test that made it
// (#10394). posthog-node resolves the global `fetch` when it sends, so a client left running by one
// test flushes into whatever `fetch` a later test installed, and a request to a real host would be
// product telemetry from CI. Tests that prove the transport opt back in toward a loopback sink and
// shut their clients down before the test ends.

type GuardedClient = {
  fetch(url: string, options: unknown): Promise<unknown>
  capture(...args: unknown[]): unknown
  shutdown(...args: unknown[]): Promise<unknown>
  clearFlushTimer?(): void
  disabled?: boolean
}

type GuardedPrototype = {
  fetch: GuardedClient["fetch"]
  capture: GuardedClient["capture"]
  shutdown: GuardedClient["shutdown"]
}

export type PostHogTestGuard = {
  beginTest(): void
  endTest(): string[]
  endRun(): string[]
  takeViolations(): string[]
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

function isLoopback(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

function origin(): string {
  const frames = (new Error().stack ?? "").split("\n").slice(1).map((line) => line.trim())
  const testFrame = frames.find((line) => /\.test\.[cm]?[jt]sx?/.test(line))
  const callers = frames.filter((line) => line.startsWith("at ") && !line.includes("node_modules") && !line.includes("posthog-test-guard"))
  return testFrame ?? (callers.slice(0, 4).join(" < ") || "an unknown caller")
}

export function createPostHogTestGuard(prototype: GuardedPrototype): PostHogTestGuard {
  const realFetch = prototype.fetch
  const realCapture = prototype.capture
  const realShutdown = prototype.shutdown
  const owners = new WeakMap<object, { readonly test: number; readonly origin: string; readonly outsideTest: boolean }>()
  const silenced = new WeakSet<object>()
  let live = new Set<GuardedClient>()
  let violations: string[] = []
  let outsideTestViolations: string[] = []
  let test = 0
  let inTest = false

  const claim = (client: GuardedClient): void => {
    if (owners.has(client)) return
    const owner = { test, origin: origin(), outsideTest: !inTest }
    owners.set(client, owner)
    if (inTest) {
      live.add(client)
      return
    }
    outsideTestViolations.push(`a PostHog client was used outside a test (${owner.origin}); create and shut down each client inside the test that uses it`)
  }

  prototype.capture = function (this: GuardedClient, ...args: unknown[]) {
    claim(this)
    return realCapture.apply(this, args)
  }

  prototype.shutdown = function (this: GuardedClient, ...args: unknown[]) {
    live.delete(this)
    return realShutdown.apply(this, args)
  }

  prototype.fetch = function (this: GuardedClient, url: string, options: unknown) {
    claim(this)
    const owner = owners.get(this)
    if (owner?.outsideTest) {
      violations.push(`a PostHog client used outside a test (${owner.origin}) sent ${url}`)
      return Promise.reject(new Error("PostHog test guard: client used outside a test"))
    }
    if (silenced.has(this) || owner?.test !== test) {
      violations.push(`a PostHog client created at ${owner?.origin ?? "an unknown test"} sent ${url} after its test ended`)
      return Promise.reject(new Error("PostHog test guard: client outlived its test"))
    }
    if (!isLoopback(url)) {
      violations.push(`a PostHog client created at ${owner.origin} sent product telemetry to ${url}`)
      return Promise.reject(new Error("PostHog test guard: test processes never send product telemetry"))
    }
    return realFetch.call(this, url, options)
  }

  return {
    beginTest() {
      test += 1
      inTest = true
      violations = [...violations, ...outsideTestViolations]
      outsideTestViolations = []
      live = new Set()
    },
    takeViolations() {
      const found = violations
      violations = []
      return found
    },
    endTest() {
      inTest = false
      for (const client of live) {
        violations.push(`a PostHog client created at ${owners.get(client)?.origin} was never shut down`)
        silenced.add(client)
        client.clearFlushTimer?.()
        client.disabled = true
      }
      live = new Set()
      const found = violations
      violations = []
      test += 1
      return found
    },
    endRun() {
      const found = [...violations, ...outsideTestViolations]
      violations = []
      outsideTestViolations = []
      return found
    },
  }
}

let installedGuard: PostHogTestGuard | undefined

// For a test that deliberately triggers a refusal: returns the current test's violations and clears them.
export function takePostHogTestGuardViolations(): string[] {
  return installedGuard?.takeViolations() ?? []
}

export function installPostHogTestGuard(): void {
  if (installedGuard !== undefined) return
  const guard = createPostHogTestGuard(PostHog.prototype as unknown as GuardedPrototype)
  installedGuard = guard
  beforeEach(() => guard.beginTest())
  afterEach(() => {
    const violations = guard.endTest()
    if (violations.length > 0) throw new Error(`PostHog test guard (#10394):\n${violations.join("\n")}`)
  })
  afterAll(() => {
    const violations = guard.endRun()
    if (violations.length > 0) throw new Error(`PostHog test guard (#10394), after the last test:\n${violations.join("\n")}`)
  })
}
