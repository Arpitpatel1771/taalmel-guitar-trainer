import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The linked @arpitpatel/drive-sync has its own node_modules/react; one React only.
  resolve: { dedupe: ["react", "react-dom"] },
  // ffmpeg.wasm spawns its own worker from inside the package; pre-bundling breaks that path.
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
