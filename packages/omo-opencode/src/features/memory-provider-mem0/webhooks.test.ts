import { describe, expect, it } from "bun:test"
import {
  filterWebhooksForEvent,
  matchesEvent,
  registerWebhook,
  validateWebhookConfig,
  type WebhookClient,
  type WebhookConfig,
  WebhookValidationError,
} from "./webhooks"

describe("validateWebhookConfig", () => {
  it("#given valid config #when validated #then returns without error", () => {
    expect(() =>
      validateWebhookConfig({
        url: "https://example.com/hook",
        events: ["memory_created"],
      }),
    ).not.toThrow()
  })

  it("#given missing url #when validated #then throws WebhookValidationError", () => {
    expect(() =>
      validateWebhookConfig({ url: "", events: ["memory_created"] }),
    ).toThrow(WebhookValidationError)
  })

  it("#given malformed url #when validated #then throws", () => {
    expect(() =>
      validateWebhookConfig({ url: "not-a-url", events: ["memory_created"] }),
    ).toThrow(WebhookValidationError)
  })

  it("#given non-http protocol #when validated #then throws", () => {
    expect(() =>
      validateWebhookConfig({ url: "ftp://example.com/hook", events: ["memory_created"] }),
    ).toThrow(WebhookValidationError)
  })

  it("#given empty events array #when validated #then throws", () => {
    expect(() =>
      validateWebhookConfig({ url: "https://example.com", events: [] }),
    ).toThrow(WebhookValidationError)
  })

  it("#given unknown event #when validated #then throws with event name", () => {
    expect(() =>
      validateWebhookConfig({
        url: "https://example.com",
        events: ["bogus" as never],
      }),
    ).toThrow(/bogus/)
  })
})

describe("matchesEvent + filterWebhooksForEvent", () => {
  const hooks: WebhookConfig[] = [
    { url: "https://a.example.com", events: ["memory_created", "memory_updated"] },
    { url: "https://b.example.com", events: ["memory_deleted"] },
    { url: "https://c.example.com", events: ["memory_consolidated"] },
  ]

  it("#given matching event #when matchesEvent called #then returns true", () => {
    expect(matchesEvent(hooks[0] as WebhookConfig, "memory_updated")).toBe(true)
  })

  it("#given non-matching event #when matchesEvent called #then returns false", () => {
    expect(matchesEvent(hooks[0] as WebhookConfig, "memory_deleted")).toBe(false)
  })

  it("#given event #when filtered #then returns only subscribers", () => {
    const subs = filterWebhooksForEvent(hooks, "memory_deleted")
    expect(subs).toHaveLength(1)
    expect(subs[0]?.url).toBe("https://b.example.com")
  })
})

describe("registerWebhook", () => {
  it("#given valid config #when registered #then client.createWebhook called", async () => {
    let seen: WebhookConfig | undefined
    const client: WebhookClient = {
      createWebhook: async (cfg) => {
        seen = cfg
        return { ...cfg, webhook_id: "wh-1" }
      },
      getWebhooks: async () => [],
      updateWebhook: async () => {},
      deleteWebhook: async () => {},
    }
    const result = await registerWebhook(client, {
      url: "https://example.com/hook",
      events: ["memory_created"],
    })
    expect(seen?.url).toBe("https://example.com/hook")
    expect(result.webhook_id).toBe("wh-1")
  })

  it("#given invalid config #when registered #then throws before client call", async () => {
    let called = false
    const client: WebhookClient = {
      createWebhook: async (cfg) => {
        called = true
        return cfg
      },
      getWebhooks: async () => [],
      updateWebhook: async () => {},
      deleteWebhook: async () => {},
    }
    await expect(
      registerWebhook(client, { url: "", events: [] }),
    ).rejects.toThrow(WebhookValidationError)
    expect(called).toBe(false)
  })
})
