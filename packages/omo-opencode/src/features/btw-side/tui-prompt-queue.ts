import type { BtwPromptRef } from "./tui-controller-types"

export function createBtwPromptQueue() {
  const promptRefs = new Map<string, BtwPromptRef>()
  const pendingQuestions = new Map<string, string>()

  return {
    attach(sessionID: string, promptRef: BtwPromptRef | undefined): void {
      if (!promptRef) {
        promptRefs.delete(sessionID)
        return
      }
      promptRefs.set(sessionID, promptRef)
      const pendingQuestion = pendingQuestions.get(sessionID)
      if (pendingQuestion === undefined) return
      pendingQuestions.delete(sessionID)
      promptRef.set(pendingQuestion)
      promptRef.submit()
    },
    queue(sessionID: string, question: string): void {
      pendingQuestions.set(sessionID, question)
    },
    input(sessionID: string): string {
      return promptRefs.get(sessionID)?.input ?? ""
    },
    hasAttachments(sessionID: string): boolean {
      return promptRefs.get(sessionID)?.hasAttachments ?? false
    },
    clear(sessionID: string): void {
      promptRefs.delete(sessionID)
      pendingQuestions.delete(sessionID)
    },
  }
}

