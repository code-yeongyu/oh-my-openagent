// Text three-way merge on Loro: the base is one insert, each side is a diff of the base
// (Text.update), and merging the two sides keeps both sides' changes. Peers are fixed, so
// the result is deterministic. Used to carry a user's further typing (ours) onto the
// state an earlier capture of the same baseline already produced (theirs).

import { loadLoroRuntime } from "../../crdt/loro-runtime"

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
    left.getText("t").update(ours)
    left.commit()
    right.setPeerId("3")
    right.getText("t").update(theirs)
    right.commit()
    left.import(right.export({ mode: "update", from: root.oplogVersion() }))
    return left.getText("t").toString()
  } finally {
    left.free()
    right.free()
    root.free()
  }
}
