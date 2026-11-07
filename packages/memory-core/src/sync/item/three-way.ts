// Text three-way merge on Loro: the base is one insert, each side is a whole-line diff of the
// base (updateBodyText, #12279), and merging the two sides keeps both sides' changes. Peers
// are fixed, so the result is deterministic. Used to carry a user's further typing (ours) onto the
// state an earlier capture of the same baseline already produced (theirs).

import { loadLoroRuntime } from "../../crdt/loro-runtime"

import { updateBodyText } from "./line-update"

export async function mergeText(base: string, ours: string, theirs: string): Promise<string> {
  if (ours === base || ours === theirs) return theirs
  if (theirs === base) return ours
  const { LoroDoc } = await loadLoroRuntime()
  const root = new LoroDoc()
  root.setPeerId("1")
  root.setRecordTimestamp(false)
  root.getText("t").insert(0, base)
  root.commit()
  const left = root.fork()
  const right = root.fork()
  try {
    left.setPeerId("2")
    updateBodyText(left.getText("t"), ours)
    left.commit()
    right.setPeerId("3")
    updateBodyText(right.getText("t"), theirs)
    right.commit()
    left.import(right.export({ mode: "update", from: root.oplogVersion() }))
    return left.getText("t").toString()
  } finally {
    left.free()
    right.free()
    root.free()
  }
}
