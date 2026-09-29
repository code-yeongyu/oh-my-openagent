import { describe, expect, test } from "bun:test"

import type { z } from "zod"

import { OmoConfigSchema } from "./config"
import { OmoGatewayConfigSchema } from "./gateway"

/**
 * The gateway section is strict and all-optional (a scope's `id` is the one required field), so
 * these tests pin the rejects - unknown keys, relative credential paths, wrong platforms, a
 * surface account claimed by two scopes - and the accepts the plan's sample shape stands for.
 */

// Synthetic ids only: T000TEST-style tokens, never a real workspace or user id.
const FULL_SAMPLE: z.input<typeof OmoGatewayConfigSchema> = {
  stt: { provider: "soniox", credentials_env: "OMO_GATEWAY_STT_KEY" },
  scopes: [
    {
      id: "team",
      memory_identity: "team-gateway",
      lead: { cwd: "~/work/team", model_profile: "default" },
      agent_accounts: ["slack:U000OTHERBOT"],
      rule_sources: [
        {
          kind: "playbook",
          repo: "~/playbooks/team",
          ref: "main",
          include: ["rules/*.md", "lessons/*.md"],
        },
      ],
      surfaces: [
        {
          platform: "slack",
          account_id: "T0000EXAMPLE",
          credentials_dir: "~/.config/agent-messenger-example",
          token_kind: "user",
          listen: { dm: true, mention: true, bound_threads: true, owned_chats: ["C0000WORK"] },
        },
      ],
    },
    {
      id: "personal",
      memory_identity: "personal-gateway",
      lead: { cwd: "~" },
      surfaces: [
        {
          platform: "discord",
          account_id: "111000222333444555",
          credentials_file: "~/.config/agent-messenger-example/discordbot.json",
          listen: { owned_chats: ["999000111222333444"] },
        },
        { platform: "telegram", account_id: "7000000001", credentials_env: "OMO_GATEWAY_TELEGRAM_TOKEN" },
        { platform: "notion", account_id: "notion-workspace-1", credentials_env: "OMO_GATEWAY_NOTION_TOKEN", listen: { mention: true } },
      ],
    },
  ],
}

function pathsOf(result: { success: boolean; error?: { issues: { path: (string | number | symbol)[] }[] } }): string[] {
  return (result.error?.issues ?? []).map((issue) => issue.path.map(String).join("."))
}

describe("gateway config schema", () => {
  test("#given the plan's full sample shape #when parsed #then it is accepted unchanged", () => {
    // given / when
    const result = OmoGatewayConfigSchema.safeParse(FULL_SAMPLE)

    // then
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual(FULL_SAMPLE)
  })

  test("#given an empty gateway section #when parsed #then it is accepted (every field optional)", () => {
    // given / when
    const result = OmoGatewayConfigSchema.safeParse({})

    // then
    expect(result.success).toBe(true)
  })

  test("#given a scope without an id #when parsed #then the missing id is named", () => {
    // given / when
    const result = OmoGatewayConfigSchema.safeParse({ scopes: [{ memory_identity: "x" }] })

    // then
    expect(result.success).toBe(false)
    expect(pathsOf(result)).toContain("scopes.0.id")
  })

  test("#given unknown keys #when parsed #then they are rejected at every level", () => {
    // given / when / then
    const gateway = OmoGatewayConfigSchema.safeParse({ scopes: [{ id: "qa" }], extra: true })
    expect(gateway.success).toBe(false)

    const scope = OmoGatewayConfigSchema.safeParse({ scopes: [{ id: "qa", unknown: 1 }] })
    expect(scope.success).toBe(false)

    const surface = OmoGatewayConfigSchema.safeParse({ scopes: [{ id: "qa", surfaces: [{ platform: "slack", rogue: 1 }] }] })
    expect(surface.success).toBe(false)
  })

  test("#given an unsupported platform #when parsed #then the surface platform path is named", () => {
    // given / when
    const result = OmoGatewayConfigSchema.safeParse({ scopes: [{ id: "qa", surfaces: [{ platform: "irc" }] }] })

    // then
    expect(result.success).toBe(false)
    expect(pathsOf(result)).toContain("scopes.0.surfaces.0.platform")
  })

  test("#given credential paths #when parsed #then only absolute or ~-rooted paths pass", () => {
    // given / when / then
    const relative = OmoGatewayConfigSchema.safeParse({
      scopes: [{ id: "qa", surfaces: [{ platform: "slack", credentials_dir: "secrets" }] }],
    })
    expect(relative.success).toBe(false)
    expect(pathsOf(relative)).toContain("scopes.0.surfaces.0.credentials_dir")

    const home = OmoGatewayConfigSchema.safeParse({
      scopes: [{ id: "qa", surfaces: [{ platform: "slack", credentials_dir: "~/.config/example" }] }],
    })
    expect(home.success).toBe(true)

    const absolute = OmoGatewayConfigSchema.safeParse({
      scopes: [{ id: "qa", surfaces: [{ platform: "slack", credentials_file: "/etc/omo/example.json" }] }],
    })
    expect(absolute.success).toBe(true)
  })

  test("#given a surface with two credential fields #when parsed #then it is rejected", () => {
    // given / when
    const result = OmoGatewayConfigSchema.safeParse({
      scopes: [
        {
          id: "qa",
          surfaces: [{ platform: "telegram", credentials_env: "TOKEN", credentials_file: "~/token.json" }],
        },
      ],
    })

    // then
    expect(result.success).toBe(false)
  })

  test("#given token_kind outside slack #when parsed #then it is rejected as a slack-only field", () => {
    // given / when
    const result = OmoGatewayConfigSchema.safeParse({
      scopes: [{ id: "qa", surfaces: [{ platform: "discord", token_kind: "bot" }] }],
    })

    // then
    expect(result.success).toBe(false)
    expect(pathsOf(result)).toContain("scopes.0.surfaces.0.token_kind")
  })

  test("#given rule sources #when parsed #then only playbook kinds with absolute, ~-rooted or git-URL repos pass", () => {
    // given / when / then
    const valid = OmoGatewayConfigSchema.safeParse({
      scopes: [
        { id: "qa", rule_sources: [{ kind: "playbook", repo: "https://example.invalid/team/playbook.git" }] },
      ],
    })
    expect(valid.success).toBe(true)

    const gitSsh = OmoGatewayConfigSchema.safeParse({
      scopes: [{ id: "qa", rule_sources: [{ kind: "playbook", repo: "git@example.invalid:team/playbook.git" }] }],
    })
    expect(gitSsh.success).toBe(true)

    const wrongKind = OmoGatewayConfigSchema.safeParse({
      scopes: [{ id: "qa", rule_sources: [{ kind: "wiki", repo: "~/playbooks/team" }] }],
    })
    expect(wrongKind.success).toBe(false)

    const relativeRepo = OmoGatewayConfigSchema.safeParse({
      scopes: [{ id: "qa", rule_sources: [{ kind: "playbook", repo: "playbooks/team" }] }],
    })
    expect(relativeRepo.success).toBe(false)
  })

  test("#given a surface account claimed by two scopes #when parsed #then the second claim is named", () => {
    // given
    const surface = { platform: "slack", account_id: "T0000EXAMPLE" }

    // when
    const result = OmoGatewayConfigSchema.safeParse({
      scopes: [
        { id: "team", surfaces: [surface] },
        { id: "personal", surfaces: [surface] },
      ],
    })

    // then
    expect(result.success).toBe(false)
    expect(pathsOf(result)).toContain("scopes.1.surfaces.0.account_id")
  })

  test("#given the same surface account twice in one scope #when parsed #then the repeat is rejected too", () => {
    // given
    const surface = { platform: "telegram", account_id: "7000000001" }

    // when
    const result = OmoGatewayConfigSchema.safeParse({ scopes: [{ id: "qa", surfaces: [surface, surface] }] })

    // then
    expect(result.success).toBe(false)
    expect(pathsOf(result)).toContain("scopes.0.surfaces.1.account_id")
  })

  test("#given feishu surfaces #when parsed #then the domain field is feishu-only and lark/absent are accepted", () => {
    // given / when
    const withLark = OmoGatewayConfigSchema.safeParse({
      scopes: [
        {
          id: "qa",
          surfaces: [
            { platform: "feishu", account_id: "feishu-tenant-1", domain: "lark", credentials_env: "OMO_GATEWAY_FEISHU_TOKEN", listen: { owned_chats: ["oc_feishu_test"] } },
            { platform: "feishu", account_id: "feishu-tenant-2" },
          ],
        },
      ],
    })

    // then
    expect(withLark.success).toBe(true)

    const badDomain = OmoGatewayConfigSchema.safeParse({
      scopes: [{ id: "qa", surfaces: [{ platform: "feishu", domain: "wechat" }] }],
    })
    expect(badDomain.success).toBe(false)
    expect(pathsOf(badDomain)).toContain("scopes.0.surfaces.0.domain")

    const offPlatform = OmoGatewayConfigSchema.safeParse({
      scopes: [{ id: "qa", surfaces: [{ platform: "slack", domain: "feishu" }] }],
    })
    expect(offPlatform.success).toBe(false)
    expect(pathsOf(offPlatform)).toContain("scopes.0.surfaces.0.domain")
  })

  test("#given the wired root config schema #when a gateway section is parsed #then root and profile views accept it", () => {
    // given
    const gateway = { scopes: [{ id: "qa" }] }

    // when
    const root = OmoConfigSchema.safeParse({ gateway })
    const profile = OmoConfigSchema.safeParse({ profiles: { night: { gateway } } })

    // then
    expect(root.success).toBe(true)
    expect(profile.success).toBe(true)
  })
})
