import { describe, expect, spyOn, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { AGREEMENTS_PATH, agreementId } from "@oh-my-opencode/memory-core"

import * as durability from "../../../../memory-core/src/journal/fsync"
import { memorySettings } from "./memory.test-support"
import { fixture } from "./prompt.test-support"
import { createMemoryNoticeInputs } from "./wiring-notice-inputs"

const TEXT = "Never filter the message monitor output"
const ID = agreementId(TEXT)

describe("memory notice inputs warn sink", () => {
  test("#given a directory-sync EIO after the watermark rename #when each notice is resolved #then the warning reaches onWarn", async () => {
    // given
    const { repo, context } = await fixture()
    await mkdir(join(repo.dir, "system"), { recursive: true })
    await writeFile(
      join(repo.dir, AGREEMENTS_PATH),
      `---\ndescription: Agreements\n---\n\n- [global] ${TEXT} <!-- id: ${ID}; by: agent; n: 3; status: needs-human -->\n`,
    )
    await repo.commitWrite([AGREEMENTS_PATH], "chore(facts): extract 1 fact", { agentId: "prompt-agent", authorName: "Facts Extractor" })
    const warnings: string[] = []
    const inputs = createMemoryNoticeInputs({
      resolveContext: () => context,
      loadSettings: () => memorySettings(),
      onWarn: (message) => { warnings.push(message) },
    })
    const sync = durability.syncJournalDirectory
    const intercepted = spyOn(durability, "syncJournalDirectory").mockImplementation(async (dir) => {
      if (dir !== context.identityPaths.notices) return sync(dir)
      throw Object.assign(new Error("injected directory sync failure"), { code: "EIO" })
    })
    try {
      // when
      await inputs.resolveSoulNotice(repo, "session-1", context.identity)
      const flagged = await inputs.resolveAgreementsNotice(repo, "session-1", context.identity)
      // then
      expect(flagged?.map((item) => item.id)).toEqual([ID])
      expect(warnings).toHaveLength(2)
      expect(warnings.some((message) => message.includes("soul watermark"))).toBe(true)
      expect(warnings.some((message) => message.includes("agreements watermark"))).toBe(true)
    } finally {
      intercepted.mockRestore()
    }
  }, 30_000)
})
