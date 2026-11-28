import type { ThreadToolResult } from "../contracts"
import type { GatewayStore } from "../gateway/store"

/**
 * Who opened each listed thread (#15221 row 25), from this device's gateway store, which holds both ends of every
 * creation it took part in: `created_by: { thread, device }` on each row it knows, nothing on the rest. `children_of`
 * keeps only the rows that thread opened. Like the backlog, parentage is a detail: a store that cannot be read leaves an
 * unfiltered listing whole and names why; a filtered one cannot be answered without it, so it fails as data.
 */
/** A read names the thread's opener and carries its metadata value when this device's store holds them; a store that cannot be read leaves the read whole and says why. */
export async function withReadParentage(
  store: Pick<GatewayStore, "threadOpener" | "threadMetadata">,
  read: ThreadToolResult,
): Promise<ThreadToolResult> {
  if (read.kind !== "ok" || !("thread" in read) || typeof read.thread !== "string") return read
  try {
    const [opener, metadata] = await Promise.all([store.threadOpener(read.thread), store.threadMetadata(read.thread)])
    return {
      ...read,
      ...(opener === undefined
        ? {}
        : {
            created_by: {
              thread: opener.creator_durable_id,
              ...(opener.creator_device === null ? {} : { device: opener.creator_device }),
            },
          }),
      ...(metadata === undefined ? {} : { metadata: metadata.value }),
    } as ThreadToolResult
  } catch (error) {
    const unread = { ...read, parentage_error: error instanceof Error ? error.message : String(error) }
    return unread as ThreadToolResult
  }
}

export async function withParentage(
  store: Pick<GatewayStore, "threadOpeners">,
  listed: ThreadToolResult,
  childrenOf: string | undefined,
): Promise<ThreadToolResult> {
  if (listed.kind !== "ok" || !("threads" in listed)) return listed
  let openers: Awaited<ReturnType<typeof store.threadOpeners>>
  try {
    openers = listed.threads.length === 0 ? {} : await store.threadOpeners(listed.threads.map((thread) => thread.thread))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (childrenOf !== undefined)
      return {
        kind: "error",
        error: {
          code: "host_unavailable",
          message: `children_of needs this device's record of who opened each thread, and it could not be read: ${reason}`,
          next_action: "List again without children_of, or retry once the gateway store answers.",
        },
      } as ThreadToolResult
    return { ...listed, parentage_error: reason } as ThreadToolResult
  }
  const threads = listed.threads
    .map((thread) => {
      const opener = openers[thread.thread]
      return opener === undefined
        ? thread
        : {
            ...thread,
            created_by: {
              thread: opener.creator_durable_id,
              ...(opener.creator_device === null ? {} : { device: opener.creator_device }),
            },
          }
    })
    .filter((thread) => childrenOf === undefined || ("created_by" in thread && thread.created_by.thread === childrenOf))
  return { ...listed, threads } as ThreadToolResult
}
