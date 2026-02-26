export interface ThinkModeState {
  requested: boolean
  modelSwitched: boolean
  variantSet: boolean
  providerID?: string
  modelID?: string
}

interface ModelRef {
  providerID: string
  modelID: string
}

interface MessageWithModel {
  model?: ModelRef
}
