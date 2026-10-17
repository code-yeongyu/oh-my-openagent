import { describe, expect, test } from "bun:test"

import {
  shardKey as engineShardKey,
  shardSocketPath as engineShardSocketPath,
} from "@code-yeongyu/senpi"
import {
  shardKey as omoShardKey,
  shardSocketPath as omoShardSocketPath,
} from "@oh-my-opencode/senpi-task"

describe("omo and adopted engine shard naming", () => {
  for (const owner of ["parent-session", "thread/with spaces", "유니코드-session"]) {
    test(`#given ${JSON.stringify(owner)} #when both implementations derive a shard #then key and socket match`, () => {
      const root = "/tmp/omo-shard-parity"

      expect(omoShardKey("p", owner)).toBe(engineShardKey("p", owner))
      expect(omoShardSocketPath(root, "p", owner)).toBe(engineShardSocketPath(root, "p", owner))
      expect(omoShardKey("i", owner)).toBe(engineShardKey("i", owner))
      expect(omoShardSocketPath(root, "i", owner)).toBe(engineShardSocketPath(root, "i", owner))
    })
  }
})
