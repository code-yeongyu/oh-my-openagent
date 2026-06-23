export type InitScript = {
  name: string
  source: string
}

export type InitScriptRegistry = {
  register(script: InitScript): void
  list(): InitScript[]
  has(name: string): boolean
  clear(): void
}

export type AddInitScriptTarget = {
  addInitScript(source: string): Promise<unknown>
}
