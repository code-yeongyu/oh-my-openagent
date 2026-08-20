import {
  findBtwBoundaryMessageID,
  parseBtwQuestion,
} from "./btw-command-draft"
import {
  BTW_SIDE_METADATA_KEY,
  createBtwSideMetadata,
} from "./metadata"
import type {
  BtwCreateSessionInput,
  BtwPromptRef,
  BtwSideControllerDependencies,
} from "./tui-controller-types"

export type PreparedBtwSideStart = {
  parentSessionID: string
  originalDraft: string
  consumeDraft: boolean
  question: string
  createInput: BtwCreateSessionInput
}

export function prepareBtwSideStart(
  dependencies: BtwSideControllerDependencies,
  promptRef: BtwPromptRef,
): PreparedBtwSideStart | undefined {
  const parentSessionID = dependencies.getCurrentSessionID()
  if (!parentSessionID) {
    dependencies.showToast("BTW is unavailable before the session starts.")
    return undefined
  }
  const parentSession = dependencies.getSession(parentSessionID)
  const boundaryMessageID = findBtwBoundaryMessageID(
    dependencies.getMessages(parentSessionID),
  )
  if (!parentSession || !boundaryMessageID) {
    dependencies.showToast("BTW is unavailable before the session starts.")
    return undefined
  }
  if (promptRef.hasAttachments) {
    dependencies.showToast(
      "BTW supports text-only drafts. Remove attachments before starting BTW.",
    )
    return undefined
  }

  const originalDraft = promptRef.input
  const parsed = parseBtwQuestion(originalDraft)
  return {
    parentSessionID,
    originalDraft,
    consumeDraft: parsed.consumeDraft,
    question: parsed.question,
    createInput: {
      title: `BTW · ${parentSession.title}`,
      ...(parentSession.agent ? { agent: parentSession.agent } : {}),
      ...(parentSession.model
        ? {
            model: {
              providerID: parentSession.model.providerID,
              id: parentSession.model.id,
            },
          }
        : {}),
      metadata: {
        [BTW_SIDE_METADATA_KEY]: createBtwSideMetadata({
          parentSessionID,
          boundaryMessageID,
        }),
      },
    },
  }
}

