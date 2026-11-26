import { streamCall, threadCall, valueCall } from "../call-spec"
import * as input from "../inputs/threads-control"
import * as read from "../inputs/threads-read"
import type * as result from "../results/threads"

// The threads namespace (first-party design 6.1, 6.2). A key is a registry row's `sdk`.
export const THREAD_CALLS = {
  "threads.list": threadCall<result.ThreadListResult>()(read.ThreadsList),
  "threads.resolve": threadCall<result.ThreadResolveResult>()(read.ThreadsResolve),
  "threads.read": threadCall<result.ThreadReadResult>()(read.ThreadsRead),
  "threads.readAfterWait": threadCall<result.ThreadReadAfterWaitResult>()(read.ThreadsReadAfterWait),
  "threads.receipt": threadCall<result.ThreadReceiptResult>()(read.ThreadsReceipt),
  "threads.entries": threadCall<result.ThreadEntriesResult>()(read.ThreadsEntries),
  "threads.messages": threadCall<result.ThreadMessagesResult>()(read.ThreadsMessages),
  "threads.get": threadCall<result.ThreadGetResult>()(read.ThreadsGet),
  "threads.wait": threadCall<result.ThreadWaitResult>()(read.ThreadsWait),
  "threads.follow": streamCall<result.ThreadFollowEvent, result.ThreadFollowOutcome>()(read.ThreadsFollow),
  "threads.locate": threadCall<result.ThreadLocateResult>()(read.ThreadsLocate),
  "threads.send": threadCall<result.ThreadSendResult>()(input.ThreadsSend),
  "threads.sendAndFollow": streamCall<result.ThreadFollowEvent, result.ThreadFollowOutcome>()(
    input.ThreadsSendAndFollow,
  ),
  "threads.create": threadCall<result.ThreadCreateResult>()(input.ThreadsCreate),
  "threads.interrupt": threadCall<result.ThreadInterruptResult>()(input.ThreadsInterrupt),
  "threads.close": threadCall<result.ThreadCloseResult>()(input.ThreadsClose),
  "threads.unload": threadCall<result.ThreadUnloadResult>()(input.ThreadsUnload),
  "threads.release": valueCall<result.ThreadReleaseResult>()(input.ThreadsRelease),
  "threads.adopt": threadCall<result.ThreadAdoptResult>()(input.ThreadsAdopt),
  "threads.setModel": threadCall<result.ThreadSetModelResult>()(input.ThreadsSetModel),
  "threads.setReasoning": threadCall<result.ThreadSetReasoningResult>()(input.ThreadsSetReasoning),
  "threads.rename": threadCall<result.ThreadRenameResult>()(input.ThreadsRename),
  "threads.aliases.resolve": threadCall<result.ThreadAliasResolveResult>()(input.ThreadsAliasesResolve),
  "threads.aliases.set": threadCall<result.ThreadAliasSetResult>()(input.ThreadsAliasesSet),
  "threads.aliases.clear": threadCall<result.ThreadAliasClearResult>()(input.ThreadsAliasesClear),
  "threads.archive": threadCall<result.ThreadArchiveResult>()(input.ThreadsArchive),
  "threads.handoff": threadCall<result.ThreadHandoffResult>()(input.ThreadsHandoff),
  "threads.extensions.register": valueCall<{ readonly version: number }>()(input.ThreadsExtensionsRegister),
  "threads.extensions.call": valueCall<unknown>()(input.ThreadsExtensionsCall),
} as const
