import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { listWakeDeliveryErrors, recordWakeDeliveryError } from "./wake-errors"

async function createConfig() {
  const baseDir = await mkdtemp(path.join(tmpdir(), "team-mailbox-wake-errors-"))
  return TeamModeConfigSchema.parse({ base_dir: baseDir })
}

describe("wake delivery error markers", () => {
  test("#given a live wake dispatch failed #when the marker is recorded #then team status can list the failed message id and reason", async () => {
    // given
    const config = await createConfig()
    const teamRunId = randomUUID()
    const messageId = randomUUID()

    // when
    await recordWakeDeliveryError(teamRunId, "worker", messageId, "network down", config)
    const wakeErrors = await listWakeDeliveryErrors(teamRunId, "worker", config)

    // then
    expect(wakeErrors).toEqual([
      expect.objectContaining({
        version: 1,
        messageId,
        reason: "network down",
      }),
    ])
  })

  test("#given no wake dispatch has failed #when listing markers #then it returns no wake errors", async () => {
    // given
    const config = await createConfig()

    // when
    const wakeErrors = await listWakeDeliveryErrors(randomUUID(), "worker", config)

    // then
    expect(wakeErrors).toEqual([])
  })
})
