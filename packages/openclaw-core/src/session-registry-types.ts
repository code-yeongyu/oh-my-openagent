export interface SessionMapping {
  sessionId: string
  tmuxSession: string
  tmuxPaneId: string
  projectPath: string
  platform: string
  messageId: string
  channelId?: string
  threadId?: string
  createdAt: string
}
