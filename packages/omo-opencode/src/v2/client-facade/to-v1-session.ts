import type { V2SessionInfo } from "../context-types"

/** A 2.x session in the 1.x `Session` shape the plugin reads (id, parent, directory, title, times). */
export function toV1Session(info: V2SessionInfo): Record<string, unknown> {
  return {
    id: info.id,
    slug: info.id,
    projectID: info.projectID,
    directory: info.location.directory,
    ...(info.parentID === undefined ? {} : { parentID: info.parentID }),
    title: info.title ?? "",
    version: "2",
    time: { created: info.time.created, updated: info.time.updated },
  }
}
