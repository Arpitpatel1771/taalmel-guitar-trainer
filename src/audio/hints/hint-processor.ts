// AudioWorklet that does no analysis: it batches the input into blocks and sends them straight
// to the analysis Worker over a MessagePort handed in by the main thread, so the main thread
// never touches the samples. Self-contained (no imports) so Vite can bundle it standalone,
// loaded like envelope-processor via `?worker&url`.
/// <reference path="../worklet-types.d.ts" />

const BLOCK = 1024;

class HintProcessor extends AudioWorkletProcessor {
  private out: MessagePort | null = null;
  private buf = new Float32Array(BLOCK);
  private fill = 0;

  constructor(options?: unknown) {
    super(options);
    this.port.onmessage = (ev: MessageEvent<{ port?: MessagePort }>) => {
      if (ev.data.port) this.out = ev.data.port;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    const first = channels?.[0];
    if (!first || !this.out) return true;
    for (let i = 0; i < first.length; i++) {
      let s = first[i];
      if (channels.length > 1) s = (s + channels[1][i]) * 0.5;
      this.buf[this.fill++] = s;
      if (this.fill === BLOCK) {
        // `currentTime` is the start of this render quantum; the block ends at sample i of it.
        const endTime = currentTime + (i + 1) / sampleRate;
        const block = this.buf;
        this.out.postMessage({ samples: block, endTime }, [block.buffer]);
        this.buf = new Float32Array(BLOCK);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor("hint-processor", HintProcessor);
