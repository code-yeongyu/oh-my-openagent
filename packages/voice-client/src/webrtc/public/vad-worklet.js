class VadWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._frameSize = Math.floor(sampleRate * 0.04);
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);
    while (this._buf.length >= this._frameSize) {
      const frame = new Float32Array(this._buf.splice(0, this._frameSize));
      this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor("vad-worklet", VadWorklet);
