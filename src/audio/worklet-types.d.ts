// Minimal ambient declarations for the AudioWorkletGlobalScope. TypeScript's
// bundled "DOM" lib does not ship AudioWorklet processor types (those live in
// separate, not-installed packages such as @types/audioworklet). This file
// declares just enough of the surface that envelope-processor.ts uses.
// Scoped to this module (src/audio) only; it does not affect files outside it
// beyond adding these (otherwise-unused) global names to the program.

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: unknown) => AudioWorkletProcessor
): void;

/** Sample rate of the enclosing AudioContext, available in worklet scope. */
declare const sampleRate: number;
/** Absolute sample frame count since the AudioContext was created. */
declare const currentFrame: number;
/** AudioContext.currentTime, available in worklet scope. */
declare const currentTime: number;
