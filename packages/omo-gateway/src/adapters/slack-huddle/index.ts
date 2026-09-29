// The Slack huddle voice surface: a browser-held call, a local API and websocket, and the adapter
// the gateway's voice pipeline binds to.

export { SlackHuddleAdapter, type SlackHuddleAdapterOptions } from "./adapter"
export { createVoiceAdapter, type HuddleFactoryOptions } from "./connect"
export { HuddleDriver, type HuddleControl, type HuddleDriverOptions, type HuddleState, type HuddleStatus, type SlackSession } from "./driver"
export { serveHuddle, type HuddleServer, type HuddleServerOptions } from "./server"
export { loadOrCreateToken, tokenPathFor } from "./token"
export { decodeAudioFrame, encodeAudioFrame, type WireAudio, WireFormatError } from "./wire"
export type { AudioFrame, CallEvent, CallKey, JoinRequest, SampleRate, Speaker, VoiceCapabilities, VoiceSurfaceAdapter } from "./voice-contract"
export { VoiceFatal, VoiceRefusal } from "./voice-contract"
export { sweepStaleProfiles } from "./browser-profile"
