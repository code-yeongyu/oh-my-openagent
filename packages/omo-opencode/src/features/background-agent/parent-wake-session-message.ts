export type ParentWakeSessionMessage = {
  readonly info?: {
    readonly role?: string
    readonly finish?: string
    readonly error?: unknown
    readonly time?: {
      readonly created?: unknown
      readonly updated?: unknown
      readonly completed?: unknown
      readonly start?: unknown
      readonly end?: unknown
    }
  }
  readonly role?: string
  readonly finish?: string
  readonly error?: unknown
  readonly time?: {
    readonly created?: unknown
    readonly updated?: unknown
    readonly completed?: unknown
    readonly start?: unknown
    readonly end?: unknown
  }
  readonly parts?: readonly {
    readonly type?: string
    readonly text?: string
    readonly synthetic?: boolean
    readonly content?: unknown
    readonly time?: {
      readonly created?: unknown
      readonly updated?: unknown
      readonly completed?: unknown
      readonly start?: unknown
      readonly end?: unknown
    }
    readonly state?: {
      readonly status?: unknown
      readonly time?: {
        readonly created?: unknown
        readonly updated?: unknown
        readonly completed?: unknown
        readonly start?: unknown
        readonly end?: unknown
      }
    }
  }[]
}
