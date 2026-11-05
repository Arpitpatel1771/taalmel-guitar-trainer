import { useEffect, useState } from "react";
import { getAudioContext } from "./context";
import { LevelMeter, type LevelReading } from "./inputLevel";
import { startLevelTap, type LevelSource } from "./levelTap";

const IDLE: LevelReading = { state: "waiting", peakDb: -Infinity, bars: 0 };

/**
 * Live input level for a mic that is already open: pass its MediaStream, or
 * an AudioNode such as MicInput.inputNode. Null (mic closed) gives the idle
 * reading and tears the tap down.
 */
export function useInputLevel(source: LevelSource | null): LevelReading {
  const [reading, setReading] = useState<LevelReading>(IDLE);
  useEffect(() => {
    if (!source) {
      setReading(IDLE);
      return;
    }
    const meter = new LevelMeter();
    const stop = startLevelTap(getAudioContext(), source, (db) => setReading(meter.push(db, performance.now())));
    return () => {
      stop();
      setReading(IDLE);
    };
  }, [source]);
  return reading;
}
