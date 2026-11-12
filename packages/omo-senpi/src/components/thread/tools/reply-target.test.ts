import { describe, expect, test } from "bun:test"
import type { ThreadAddressEntry } from "../addressing"
import type { ThreadToolSurfaceOptions } from "./ports"
import { replyTargetMismatch } from "./reply-target"

// Amendment A4.3.1 of #13037: a reply approved for a consumed sender is delivered only to an entry with that sender's
// session id AND that sender's device. The resolvers already narrow to the sender's device, so this check is the second
// layer; it is pinned here directly.

type Sender = { readonly session_id: string; readonly name?: string; readonly device?: string }

const repliesTo = (senders: readonly Sender[]) =>
  ({
    callerReplySenders: () => senders,
    callerReplyTargets: () => senders.map((sender) => sender.session_id),
  }) as unknown as ThreadToolSurfaceOptions

const entry = (device?: string): ThreadAddressEntry => ({
  thread_id: "dur-sender",
  name: "sender",
  status: "live",
  cwd: "",
  created_at: "",
  updated_at: null,
  ...(device === undefined ? {} : { device }),
})

describe("replyTargetMismatch compares the device as well as the session id", () => {
  test("#given the sender came from device b #when the resolved entry has its session id on device c #then it is reply_target_mismatch", () => {
    expect(replyTargetMismatch(repliesTo([{ session_id: "dur-sender", device: "b" }]), "dur-sender", entry("c"), "here")).toMatchObject({
      code: "reply_target_mismatch",
      details: { resolved_thread_id: "dur-sender", device: "c" },
    })
  })

  test("#given the sender came from device b #when the resolved entry is its session on b #then it passes", () => {
    expect(
      replyTargetMismatch(repliesTo([{ session_id: "dur-sender", device: "b" }]), "dur-sender", entry("b"), "here"),
    ).toBeUndefined()
  })

  test("#given a sender on this device #when the resolved entry is its session here #then it passes, whether the device is absent or named as this one", () => {
    expect(replyTargetMismatch(repliesTo([{ session_id: "dur-sender" }]), "dur-sender", entry(), "here")).toBeUndefined()
    expect(
      replyTargetMismatch(repliesTo([{ session_id: "dur-sender", device: "here" }]), "dur-sender", entry(), "here"),
    ).toBeUndefined()
  })

  test("#given a sender on this device #when the resolved entry has its session id on another device #then it is reply_target_mismatch", () => {
    expect(replyTargetMismatch(repliesTo([{ session_id: "dur-sender" }]), "dur-sender", entry("b"), "here")).toMatchObject({
      code: "reply_target_mismatch",
    })
  })
})
