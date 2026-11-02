import { describe, expect, test } from "bun:test"

import {
  COMMANDCODE_KEY_ENV_VARS,
  COMMANDCODE_PROVIDER_ID,
  commandCodeKeyEnv,
  commandCodeProvider,
  commandCodeProviderItem,
  withCommandCodeProvider,
} from "../bin/lib/setup-commandcode.js"

describe("setup commandcode", () => {
  describe("#given the baked Command Code preset", () => {
    const config = commandCodeProvider()

    test("#then the provider entry is one `commandcode` provider on the OpenAI wire", () => {
      // then
      expect(config.name).toBe("Command Code")
      expect(config.baseUrl).toBe("https://api.commandcode.ai/provider/v1")
      expect(config.api).toBe("openai-completions")
    })

    test("#then both wire APIs are served from the one entry: Claude models carry the Anthropic overrides, the rest inherit the provider's wire", () => {
      // then
      const claude = config.models.filter((model) => model.id.startsWith("claude-"))
      const vendor = config.models.filter((model) => !model.id.startsWith("claude-"))
      expect(claude.length).toBeGreaterThan(0)
      expect(vendor.length).toBeGreaterThan(0)
      for (const model of claude) {
        expect(model.api).toBe("anthropic-messages")
        expect(model.baseUrl).toBe("https://api.commandcode.ai/provider")
      }
      for (const model of vendor) {
        expect(model.api).toBeUndefined()
        expect(model.baseUrl).toBeUndefined()
      }
    })

    test("#then every baked model carries Command Code's 32000 maxTokens and a stated context window", () => {
      // then
      expect(config.models.length).toBeGreaterThanOrEqual(8)
      for (const model of config.models) {
        expect(model.maxTokens).toBe(32000)
        expect(model.contextWindow).toBeGreaterThan(0)
      }
    })

    test("#then the entry carries no key of its own and no header", () => {
      // then
      const serialized = JSON.stringify(config)
      expect(serialized).not.toContain("apiKey")
      expect(serialized).not.toContain("${")
      expect(serialized).not.toContain("headers")
      expect(serialized).not.toContain("x-cmd-zdr")
    })
  })

  describe("#given the env vars the key is read from", () => {
    test("#when both are set #then CMD_API_KEY wins", () => {
      // given
      const env = { COMMANDCODE_API_KEY: "fallthrough", CMD_API_KEY: "primary" }

      // then
      expect(commandCodeKeyEnv(env)).toBe("CMD_API_KEY")
    })

    test("#when only COMMANDCODE_API_KEY is set #then it is used", () => {
      // then
      expect(commandCodeKeyEnv({ COMMANDCODE_API_KEY: "only" })).toBe("COMMANDCODE_API_KEY")
    })

    test("#when neither holds a value #then no env var is named", () => {
      // then
      expect(commandCodeKeyEnv({})).toBeUndefined()
      expect(commandCodeKeyEnv({ CMD_API_KEY: "", COMMANDCODE_API_KEY: "  " })).toBeUndefined()
      expect(commandCodeKeyEnv({ CMD_API_KEY: undefined })).toBeUndefined()
    })

    test("#then the two documented env vars are the ones read", () => {
      // then
      expect(COMMANDCODE_KEY_ENV_VARS).toEqual(["CMD_API_KEY", "COMMANDCODE_API_KEY"])
    })
  })

  describe("#given the provider item the custom-provider stage carries", () => {
    test("#when a key env var is set #then the item is the preset keyed by an env reference the engine interpolates", () => {
      // given
      const item = commandCodeProviderItem({ CMD_API_KEY: "sk-cmd-sentinel" })

      // then
      expect(item?.id).toBe(COMMANDCODE_PROVIDER_ID)
      expect(item?.origin).toBe("commandcode")
      expect(item?.config).toEqual(commandCodeProvider())
      expect(item?.key).toEqual({ key: `\${CMD_API_KEY}`, source: "environment variable CMD_API_KEY" })
      // Items travel over RPC and land in config files: the env value itself never rides in one.
      expect(JSON.stringify(item)).not.toContain("sk-cmd-sentinel")
    })

    test("#when no key env var is set #then there is no item", () => {
      // then
      expect(commandCodeProviderItem({})).toBeUndefined()
    })
  })

  describe("#given the custom-provider stage's planned source", () => {
    const empty = { providers: [], skipped: [], notices: [] }

    test("#when a key env var is set #then the preset joins the user's providers", () => {
      // given
      const source = { providers: [{ id: "myco", config: { name: "MyCo" }, key: { key: "k", source: "s" } }], skipped: [], notices: [] }

      // when
      const planned = withCommandCodeProvider(source, { CMD_API_KEY: "k" })

      // then
      expect(planned.providers.map((provider: { id: string }) => provider.id)).toEqual(["myco", "commandcode"])
      expect(planned.skipped).toEqual([])
      expect(planned.notices).toEqual([])
    })

    test("#when no key env var is set #then the source is unchanged", () => {
      // then
      expect(withCommandCodeProvider(empty, {})).toBe(empty)
    })

    test("#when the user's own config already declares `commandcode` #then their entry wins", () => {
      // given
      const theirs = { id: "commandcode", config: { name: "mine" }, key: { key: "k", source: "s" } }
      const source = { providers: [theirs], skipped: [], notices: [] }

      // when
      const planned = withCommandCodeProvider(source, { CMD_API_KEY: "k" })

      // then
      expect(planned.providers).toEqual([theirs])
    })

    test("#when the user's own `commandcode` block was refused with a notice #then the preset is not added behind it", () => {
      // given
      const source = { providers: [], skipped: ["commandcode"], notices: ["commandcode: could not read a fixed baseURL"] }

      // when
      const planned = withCommandCodeProvider(source, { CMD_API_KEY: "k" })

      // then
      expect(planned).toEqual(source)
    })
  })
})
