export interface ThinkModeState {
  requested: boolean
  modelSwitched: boolean
  thinkingConfigInjected: boolean
  providerID?: string
  modelID?: string
}

export interface ModelRef {
  providerID: string
  modelID: string
}

export interface MessageWithModel {
  model?: ModelRef
}

export interface ThinkModeInput {
  parts: Array<{ type: string; text?: string }>
  message: MessageWithModel
}
