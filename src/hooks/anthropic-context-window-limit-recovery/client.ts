export type Client = {
  session: {
    messages: (opts: {
      path: { id: string }
      query?: { directory?: string }
    }) => Promise<unknown>
    summarize: (opts: {
      path: { id: string }
      body: { providerID: string; modelID: string }
      query: { directory: string }
    }) => Promise<unknown>
    revert: (opts: {
      path: { id: string }
      body: { messageID: string; partID?: string }
      query: { directory: string }
    }) => Promise<unknown>
    prompt_async: (opts: {
      path: { id: string }
      body: { parts: Array<{ type: string; text: string }> }
      query: { directory: string }
    }) => Promise<unknown>
  }
  tui: {
    showToast: (opts: {
      body: {
        title: string
        message: string
        variant: string
        duration: number
      }
    }) => Promise<unknown>
  }
}
