// The huddle surface as the gateway's voice pipeline sees it.
//
// Thin by design: the driver owns the call, and this is the shape the voice core binds to. Its one
// real job is honesty about what a huddle can do - the media plane mixes every participant, so
// speaker ids are "roster" (the platform's word for who is talking) and never "exact".

import { HuddleDriver } from "./driver"
import type { AudioFrame, CallEvent, CallKey, JoinRequest, SampleRate, VoiceCapabilities, VoiceSurfaceAdapter } from "./voice-contract"
import type { SurfaceKey } from "../../adapter/contract"

export type SlackHuddleAdapterOptions = { readonly maxCallMinutes?: number | null }

const sameCall = (a: CallKey, b: CallKey): boolean => a.call_id === b.call_id && a.chat_id === b.chat_id && a.account_id === b.account_id

export class SlackHuddleAdapter implements VoiceSurfaceAdapter {
  readonly platform = "slack" as const
  private readonly driver: HuddleDriver
  private readonly maxCallMinutes: number | null

  constructor(driver: HuddleDriver, options: SlackHuddleAdapterOptions = {}) {
    this.driver = driver
    this.maxCallMinutes = options.maxCallMinutes ?? null
  }

  voiceCapabilities(): VoiceCapabilities {
    return { voice_in: true, voice_out: true, speaker_ids: "roster", max_call_minutes: this.maxCallMinutes }
  }

  join(call: JoinRequest, signal: AbortSignal): Promise<CallKey> {
    // `announce` is deliberately unused: a voice adapter never posts. The pipeline announces the
    // call on the surface `textMirror` points at.
    return this.driver.join(call.chat_id, signal)
  }

  async leave(_call: CallKey): Promise<void> {
    await this.driver.leave()
  }

  onAudio(call: CallKey, sink: (frame: AudioFrame) => void): () => void {
    return this.driver.onAudio((frame) => {
      if (sameCall(frame.call, call)) sink(frame)
    })
  }

  onCallEvent(call: CallKey, sink: (event: CallEvent) => void): () => void {
    return this.driver.onEvent((event) => {
      if (sameCall(event.call, call)) sink(event)
    })
  }

  speak(_call: CallKey, pcm16: Int16Array, sample_rate: SampleRate, signal: AbortSignal): Promise<void> {
    return this.driver.speak(pcm16, sample_rate, signal)
  }

  /** The call's own thread, when the platform made one; otherwise the chat it belongs to. */
  textMirror(call: CallKey): SurfaceKey | null {
    return { platform: "slack", account_id: call.account_id, chat_id: call.chat_id, thread_id: this.driver.status().thread_id }
  }
}
