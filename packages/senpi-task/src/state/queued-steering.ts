export function withDroppedSteeringNotice(message: string, count: number): string
export function withDroppedSteeringNotice(message: string | undefined, count: number): string | undefined
export function withDroppedSteeringNotice(message: string | undefined, count: number): string | undefined {
  if (count === 0) return message
  const notice = `${count} queued message${count === 1 ? " was" : "s were"} not delivered.`
  return message?.endsWith(notice) === true ? message : [message, notice].filter(Boolean).join("\n")
}
