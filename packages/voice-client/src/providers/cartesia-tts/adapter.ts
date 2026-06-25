import type { TtsEvent, TtsStub } from "../../harness/types";
import type { CartesiaTtsConfig } from "./types";

export type CartesiaTtsClientFactory = (config: CartesiaTtsConfig) => unknown;

export class CartesiaTtsAdapter implements TtsStub {
  constructor(
    private readonly _config: CartesiaTtsConfig,
    private readonly _clientFactory?: CartesiaTtsClientFactory,
  ) {}

  async *synthesize(_text: string, _options?: { signal?: AbortSignal }): AsyncIterable<TtsEvent> {}

  async *streamSynthesize(
    _textStream: AsyncIterable<string>,
    _options?: { signal?: AbortSignal },
  ): AsyncIterable<TtsEvent> {}

  resetContext(): void {}
}
