import {
  consumeAgreementsNoticeDelta,
  consumeSoulNoticeDelta,
  type AgreementItem,
  type GitMemoryRepo,
  type SoulNotice,
} from "@oh-my-opencode/memory-core"
import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"

import { AGREEMENT_FLAGGED_ENTRY_TYPE, type AgreementFlaggedRecord } from "./agreement-notice"
import type { MemoryIdentityContext } from "./context"

type NoticeInput<T> = (repo: GitMemoryRepo, sessionId: string, identity: string) => Promise<T | undefined>

export interface MemoryNoticeInputs {
  readonly resolveSoulNotice: NoticeInput<SoulNotice>
  readonly resolveAgreementsNotice: NoticeInput<readonly AgreementItem[]>
}

export function createMemoryNoticeInputs(input: {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly loadSettings: () => OmoMemorySettings
  readonly appendEntry?: (customType: string, data: AgreementFlaggedRecord) => void
}): MemoryNoticeInputs {
  const bound = (sessionId: string, identity: string): MemoryIdentityContext | undefined => {
    const context = input.resolveContext(sessionId)
    return context === undefined || context.identity !== identity ? undefined : context
  }
  return {
    resolveSoulNotice: async (repo, sessionId, identity) => {
      const context = bound(sessionId, identity)
      if (context === undefined) return undefined
      return consumeSoulNoticeDelta(repo, { noticesDir: context.identityPaths.notices, locksDir: context.identityPaths.locks })
    },
    resolveAgreementsNotice: async (repo, sessionId, identity) => {
      const context = bound(sessionId, identity)
      if (context === undefined || !agreementsEnabled(input.loadSettings(), identity)) return undefined
      const flagged = await consumeAgreementsNoticeDelta(repo, {
        noticesDir: context.identityPaths.notices,
        locksDir: context.identityPaths.locks,
      })
      for (const item of flagged) {
        input.appendEntry?.(AGREEMENT_FLAGGED_ENTRY_TYPE, { id: item.id, text: item.text, n: item.n, by: item.by })
      }
      return flagged.length === 0 ? undefined : flagged
    },
  }
}

function agreementsEnabled(settings: OmoMemorySettings, identity: string): boolean {
  return settings.agents[identity]?.agreements?.enabled ?? settings.agreements.enabled
}
