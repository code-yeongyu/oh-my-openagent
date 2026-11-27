import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { configuredNicknameModelIds } from "./nickname-model-ids"

describe("configuredNicknameModelIds", () => {
  test("#given the effective model catalog and agent/category model chains #when collecting IDs #then every configured model reference is included", () => {
    const config: OmoConfig = {
      models: {
        catalog: { model: "catalog-provider/catalog-model" },
      },
      agents: {
        reviewer: {
          model: "agent-provider/agent-model",
          models: ["agent-provider/chain-model", { model: "agent-provider/object-model" }],
        },
      },
      categories: {
        quick: {
          model: "category-provider/category-model",
          models: ["category-provider/chain-model", { model: "category-provider/object-model" }],
          fallback_models: ["category-provider/fallback-model", { model: "category-provider/fallback-object" }],
        },
      },
    }

    expect([...configuredNicknameModelIds(config)].sort()).toEqual([
      "agent-provider/agent-model",
      "agent-provider/chain-model",
      "agent-provider/object-model",
      "catalog-provider/catalog-model",
      "category-provider/category-model",
      "category-provider/chain-model",
      "category-provider/fallback-model",
      "category-provider/fallback-object",
      "category-provider/object-model",
    ])
  })
})
