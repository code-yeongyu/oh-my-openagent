export interface AudioSample {
  id: string;
  lang: "it" | "en" | "it-en-mixed";
  wavPath: string;
  transcript_reference?: string;
}

export interface StageTiming {
  stt_first_token_ms: number;
  stt_complete_ms: number;
  tts_first_byte_ms: number;
  tts_first_audio_ms: number;
  end_to_end_ms: number;
}

export interface Percentiles {
  p50: number;
  p95: number;
}

export interface RunResult {
  perStage: {
    stt_first_token: Percentiles;
    stt_complete: Percentiles;
    tts_first_byte: Percentiles;
    tts_first_audio: Percentiles;
    end_to_end: Percentiles;
  };
  iterations: number;
  samples_used: number;
  timestamp_iso: string;
}

export interface SttPartial {
  kind: "partial";
  text: string;
  t_ms: number;
}

export interface SttFinal {
  kind: "final";
  text: string;
  t_ms: number;
}

export type SttEvent = SttPartial | SttFinal;

export interface SttStub {
  transcribe(sample: AudioSample): AsyncIterable<SttEvent>;
}

export interface TtsFirstByte {
  kind: "first_byte";
  t_ms: number;
}

export interface TtsAudioChunk {
  kind: "audio_chunk";
  t_ms: number;
  bytes?: Uint8Array;
}

export type TtsEvent = TtsFirstByte | TtsAudioChunk;

export interface TtsStub {
  synthesize(text: string): AsyncIterable<TtsEvent>;
}

export interface IterationError {
  iteration: number;
  sample_id: string;
  stage: "stt" | "tts" | "unknown";
  message: string;
}
