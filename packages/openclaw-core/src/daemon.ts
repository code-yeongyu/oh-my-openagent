import { pollLoop, logReplyListenerMessage } from "./reply-listener"

pollLoop().catch((err) => {
  logReplyListenerMessage(
    `FATAL: reply listener daemon crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
  )
  console.error(err)
  process.exit(1)
})
