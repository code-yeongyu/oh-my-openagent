import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import type { BackgroundTaskArgs, BackgroundOutputArgs, BackgroundCancelArgs } from "./types"
import { BACKGROUND_TASK_DESCRIPTION, BACKGROUND_OUTPUT_DESCRIPTION, BACKGROUND_CANCEL_DESCRIPTION } from "./constants"
import { findNearestMessageWithFields, findFirstMessageWithAgent, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { consumeNewMessages } from "../../shared/session-cursor"
import { storeToolMetadata } from "../../features/tool-metadata-store"

// Re-export types and functions from modules
export { createBackgroundTask } from "./modules/background-task"
export { createBackgroundOutput } from "./modules/background-output"
export { createBackgroundCancel } from "./modules/background-cancel"
export type {
  BackgroundOutputMessage,
  BackgroundOutputMessagesResult,
  BackgroundOutputClient,
  BackgroundCancelClient,
  BackgroundOutputManager,
  FullSessionMessagePart,
  FullSessionMessage,
  ToolContextWithMetadata,
} from "./types"

// Legacy exports for backward compatibility - these will be removed once all imports are updated
export { formatDuration, truncateText, delay, formatMessageTime } from "./modules/utils"
export { getErrorMessage, isSessionMessage, extractMessages, extractToolResultText } from "./modules/message-processing"
export { formatTaskStatus, formatTaskResult, formatFullSession } from "./modules/formatters"
