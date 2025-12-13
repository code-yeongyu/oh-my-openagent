export interface UltraworkModeState {
  /** Whether ultrawork keyword was detected */
  detected: boolean
  /** Whether context was injected */
  injected: boolean
}

export interface ModelRef {
  providerID: string
  modelID: string
}

export interface MessageWithModel {
  model?: ModelRef
}

export interface UltraworkModeInput {
  parts: Array<{ type: string; text?: string }>
  message: MessageWithModel
}
