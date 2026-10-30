import { touchesSoulPath, type MemoryToolCommit } from "@oh-my-opencode/memory-core"

import type { MemoryExtensionAPI } from "./capabilities"
import type { MemoryIdentityContext } from "./context"
import { SOUL_UPDATED_ENTRY_TYPE, renderSoulUpdatedEntry, type SoulUpdatedRecord } from "./soul-notice"
import { AGREEMENT_FLAGGED_ENTRY_TYPE, renderAgreementFlaggedEntry } from "./agreement-notice"

export interface MemoryNoticeWiringOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly resolveEditNotice: (identity: string) => boolean
}

export interface MemoryNoticeWiring {
  register(pi: MemoryExtensionAPI): void
  onCommit(context: MemoryIdentityContext, commit: MemoryToolCommit): void
}

export function createMemoryNoticeWiring(options: MemoryNoticeWiringOptions): MemoryNoticeWiring {
  let api: MemoryExtensionAPI | undefined

  return {
    register(pi): void {
      api = pi
      pi.registerEntryRenderer(SOUL_UPDATED_ENTRY_TYPE, renderSoulUpdatedEntry)
      pi.registerEntryRenderer(AGREEMENT_FLAGGED_ENTRY_TYPE, renderAgreementFlaggedEntry)
    },
    onCommit(context, commit): void {
      if (api === undefined) return
      if (touchesSoulPath(commit.affectedPaths) && options.resolveEditNotice(context.identity)) {
        api.appendEntry(SOUL_UPDATED_ENTRY_TYPE, {
          sha: commit.sha,
          subject: commit.subject,
          affectedPaths: commit.affectedPaths,
        } satisfies SoulUpdatedRecord)
      }
    },
  }
}
