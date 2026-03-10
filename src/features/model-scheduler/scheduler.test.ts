import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { getModelHealthFilePath, getModelRoutingFilePath, runModelSchedulerCycle } from "./index"

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR
  delete process.env.XDG_CACHE_HOME

  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("model scheduler", () => {
  it("rewrites unhealthy agent and category routing in active mode", async () => {
    const configDir = createTempDir("omo-model-scheduler-config-")
    const cacheHome = createTempDir("omo-model-scheduler-cache-")
    process.env.OPENCODE_CONFIG_DIR = configDir
    process.env.XDG_CACHE_HOME = cacheHome

    writeFileSync(
      join(configDir, "model-routing.json"),
      JSON.stringify({
        agentModelMapping: {
          Hephaestus: {
            primary: "augment-pro/gpt-5.4",
            fallback: ["augment-pro/gpt-5.3-codex"],
          },
        },
        categoryRouting: {
          quick: "augment-pro/claude-haiku-4-5",
        },
      }),
      "utf-8",
    )

    const ctx = {
      directory: "/project",
      client: {
        provider: {
          list: async () => ({
            data: {
              connected: ["augment-pro"],
              all: [
                {
                  id: "augment-pro",
                  models: {
                    "gpt-5.3-codex": {},
                    "claude-haiku-4-5": {},
                  },
                },
              ],
            },
          }),
        },
        session: {
          create: async () => ({ data: { id: "probe-session-1" } }),
          prompt: async () => {},
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "OK" }] }],
          }),
        },
      },
    }

    const result = await runModelSchedulerCycle(ctx, {
      mode: "active",
      interval_minutes: 60,
    })

    expect(result).not.toBeNull()

    const routing = JSON.parse(readFileSync(getModelRoutingFilePath(), "utf-8")) as {
      agentModelMapping: { Hephaestus: { primary: string; fallback: string[] } }
      categoryRouting: { quick: string }
      scheduler: { lastChangeCount: number }
    }
    expect(routing.agentModelMapping.Hephaestus.primary).toBe("augment-pro/gpt-5.3-codex")
    expect(routing.categoryRouting.quick).toBe("augment-pro/claude-haiku-4-5")
    expect(routing.scheduler.lastChangeCount).toBe(1)
    expect(existsSync(getModelHealthFilePath())).toBe(true)

    const health = JSON.parse(readFileSync(getModelHealthFilePath(), "utf-8")) as {
      probe: { enabled: boolean; checkedModelCount: number; models: Record<string, { status: string }> }
    }
    expect(health.probe.enabled).toBe(true)
    expect(health.probe.checkedModelCount).toBeGreaterThan(0)
    expect(health.probe.models["augment-pro/gpt-5.3-codex"].status).toBe("healthy")
  })

  it("records health state without rewriting routing in observe mode", async () => {
    const configDir = createTempDir("omo-model-scheduler-observe-config-")
    const cacheHome = createTempDir("omo-model-scheduler-observe-cache-")
    process.env.OPENCODE_CONFIG_DIR = configDir
    process.env.XDG_CACHE_HOME = cacheHome

    writeFileSync(
      join(configDir, "model-routing.json"),
      JSON.stringify({
        agentModelMapping: {
          Explore: {
            primary: "augment-pro/gpt-5.2-codex",
            fallback: ["augment-pro/claude-haiku-4-5"],
          },
        },
      }),
      "utf-8",
    )

    const ctx = {
      directory: "/project",
      client: {
        provider: {
          list: async () => ({
            data: {
              connected: ["augment-pro"],
              all: [
                {
                  id: "augment-pro",
                  models: {
                    "claude-haiku-4-5": {},
                  },
                },
              ],
            },
          }),
        },
        session: {
          create: async () => ({ data: { id: "probe-session-2" } }),
          prompt: async () => {},
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "OK" }] }],
          }),
        },
      },
    }

    const result = await runModelSchedulerCycle(ctx, {
      mode: "observe",
      interval_minutes: 60,
    })

    expect(result?.auditEntry.changed).toBe(false)

    const routing = JSON.parse(readFileSync(getModelRoutingFilePath(), "utf-8")) as {
      agentModelMapping: { Explore: { primary: string } }
    }
    expect(routing.agentModelMapping.Explore.primary).toBe("augment-pro/gpt-5.2-codex")

    const health = JSON.parse(readFileSync(getModelHealthFilePath(), "utf-8")) as {
      agents: { Explore: { selectedModel: string; status: string } }
    }
    expect(health.agents.Explore.selectedModel).toBe("augment-pro/claude-haiku-4-5")
    expect(health.agents.Explore.status).toBe("healthy")
  })

  it("treats slow probe results as unhealthy and reroutes away from them", async () => {
    const configDir = createTempDir("omo-model-scheduler-probe-config-")
    const cacheHome = createTempDir("omo-model-scheduler-probe-cache-")
    process.env.OPENCODE_CONFIG_DIR = configDir
    process.env.XDG_CACHE_HOME = cacheHome

    writeFileSync(
      join(configDir, "model-routing.json"),
      JSON.stringify({
        agentModelMapping: {
          Hephaestus: {
            primary: "augment-pro/gpt-5.4",
            fallback: ["augment-pro/gpt-5.3-codex"],
          },
        },
      }),
      "utf-8",
    )

    const promptCalls: string[] = []
    const ctx = {
      directory: "/project",
      client: {
        provider: {
          list: async () => ({
            data: {
              connected: ["augment-pro"],
              all: [
                {
                  id: "augment-pro",
                  models: {
                    "gpt-5.4": {},
                    "gpt-5.3-codex": {},
                  },
                },
              ],
            },
          }),
        },
        session: {
          create: async () => ({ data: { id: `probe-session-${promptCalls.length + 1}` } }),
          prompt: async (args: { body: { model: { modelID: string } } }) => {
            promptCalls.push(args.body.model.modelID)
            if (args.body.model.modelID === "gpt-5.4") {
              await new Promise((resolve) => setTimeout(resolve, 25))
            }
          },
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "OK" }] }],
          }),
        },
      },
    }

    await runModelSchedulerCycle(ctx, {
      mode: "active",
      interval_minutes: 60,
      probe_timeout_ms: 1000,
      probe_max_latency_ms: 10,
    })

    const routing = JSON.parse(readFileSync(getModelRoutingFilePath(), "utf-8")) as {
      agentModelMapping: { Hephaestus: { primary: string } }
    }
    const health = JSON.parse(readFileSync(getModelHealthFilePath(), "utf-8")) as {
      agents: { Hephaestus: { status: string; reason: string; probeStatus: string } }
      probe: { models: Record<string, { status: string }> }
    }

    expect(routing.agentModelMapping.Hephaestus.primary).toBe("augment-pro/gpt-5.3-codex")
    expect(health.agents.Hephaestus.reason).toBe("latency-too-high")
    expect(health.agents.Hephaestus.probeStatus).toBe("healthy")
    expect(health.probe.models["augment-pro/gpt-5.4"].status).toBe("slow")
  })

  it("cleans up probe sessions after each scheduler cycle", async () => {
    const configDir = createTempDir("omo-model-scheduler-cleanup-config-")
    const cacheHome = createTempDir("omo-model-scheduler-cleanup-cache-")
    process.env.OPENCODE_CONFIG_DIR = configDir
    process.env.XDG_CACHE_HOME = cacheHome

    writeFileSync(
      join(configDir, "model-routing.json"),
      JSON.stringify({
        agentModelMapping: {
          Hephaestus: {
            primary: "augment-pro/gpt-5.4",
            fallback: ["augment-pro/gpt-5.3-codex"],
          },
        },
      }),
      "utf-8",
    )

    const deletedSessionIds: string[] = []
    const ctx = {
      directory: "/project",
      client: {
        provider: {
          list: async () => ({
            data: {
              connected: ["augment-pro"],
              all: [
                {
                  id: "augment-pro",
                  models: {
                    "gpt-5.4": {},
                    "gpt-5.3-codex": {},
                  },
                },
              ],
            },
          }),
        },
        session: {
          create: async (args: { body: { title: string } }) => ({
            data: { id: `probe-session-${args.body.title.split(": ")[1]}` },
          }),
          delete: async (args: { path: { id: string } }) => {
            deletedSessionIds.push(args.path.id)
            return {}
          },
          prompt: async () => {},
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "OK" }] }],
          }),
        },
      },
    }

    await runModelSchedulerCycle(ctx, {
      mode: "active",
      interval_minutes: 60,
    })

    expect(deletedSessionIds).toContain("probe-session-augment-pro/gpt-5.4")
    expect(deletedSessionIds).toContain("probe-session-augment-pro/gpt-5.3-codex")
    expect(deletedSessionIds).toHaveLength(2)
  })

  it("probes candidate models in parallel within a single cycle", async () => {
    const configDir = createTempDir("omo-model-scheduler-parallel-config-")
    const cacheHome = createTempDir("omo-model-scheduler-parallel-cache-")
    process.env.OPENCODE_CONFIG_DIR = configDir
    process.env.XDG_CACHE_HOME = cacheHome

    writeFileSync(
      join(configDir, "model-routing.json"),
      JSON.stringify({
        agentModelMapping: {
          Hephaestus: {
            primary: "augment-pro/gpt-5.4",
            fallback: ["augment-pro/gpt-5.3-codex"],
          },
        },
      }),
      "utf-8",
    )

    let activePrompts = 0
    let maxConcurrentPrompts = 0
    const ctx = {
      directory: "/project",
      client: {
        provider: {
          list: async () => ({
            data: {
              connected: ["augment-pro"],
              all: [
                {
                  id: "augment-pro",
                  models: {
                    "gpt-5.4": {},
                    "gpt-5.3-codex": {},
                  },
                },
              ],
            },
          }),
        },
        session: {
          create: async (args: { body: { title: string } }) => ({
            data: { id: `probe-session-${args.body.title.split(": ")[1]}` },
          }),
          prompt: async () => {
            activePrompts += 1
            maxConcurrentPrompts = Math.max(maxConcurrentPrompts, activePrompts)
            await new Promise((resolve) => setTimeout(resolve, 25))
            activePrompts -= 1
          },
          messages: async () => ({
            data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "OK" }] }],
          }),
        },
      },
    }

    await runModelSchedulerCycle(ctx, {
      mode: "active",
      interval_minutes: 60,
      probe_timeout_ms: 1000,
      probe_max_latency_ms: 1000,
    })

    expect(maxConcurrentPrompts).toBeGreaterThan(1)
  })
})
