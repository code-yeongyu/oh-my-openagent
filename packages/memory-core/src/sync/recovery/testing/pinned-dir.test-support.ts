import { creatorAnchor } from "../../crypto/anchor.ts"
import { appendEntries, emptyChain } from "../../crypto/chain.ts"
import { createRejectionCounter } from "../../crypto/rejection.ts"
import { pinTrustAnchor } from "../../crypto/trust-pin.ts"
import { freshStateDir, type World } from "./world.test-support.ts"

/** A fresh state dir holding the trust pin the account's creator would hold: a member device's pin. */
export const pinnedDir = async (world: World): Promise<string> => {
  const dir = freshStateDir()
  const walked = await appendEntries(
    emptyChain(world.account, creatorAnchor(world.account, world.owner.keyring)),
    world.server.chain(world.account),
    createRejectionCounter(),
  )
  if (!walked.ok || walked.state.pin === null) throw new Error("no pin candidate")
  await pinTrustAnchor(dir, world.account, walked.state.pin)
  return dir
}
