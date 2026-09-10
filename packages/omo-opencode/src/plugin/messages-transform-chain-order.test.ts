import { describe, expect, test } from "bun:test"

import { MESSAGES_TRANSFORM_HOOK_KEYS } from "./messages-transform"

// given
const PINNED_CHAIN_ORDER = [
  "btwSideContextInjector",
  "contextInjectorMessagesTransform",
  "teamModeStatusInjector",
  "teamMailboxInjector",
  "toolPairValidator",
  "monitorStatusInjector",
  "categorySkillReminder",
] as const

describe("#given the messages-transform chain order contract", () => {
  test("#when reading the hook chain #then the keys equal the pinned prefix-stability sequence", () => {
    // when
    const actual = [...MESSAGES_TRANSFORM_HOOK_KEYS]

    // then
    expect(actual).toEqual([...PINNED_CHAIN_ORDER])
  })
})
