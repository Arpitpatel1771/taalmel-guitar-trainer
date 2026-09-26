import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as storage from "./storage";
import { App } from "./ui/App";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./ui/tokens.css";
import "./ui/styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Could not find #root element to mount Taalmel.");
}

createRoot(rootEl).render(
  <StrictMode>
    <App storage={storage} />
  </StrictMode>,
);
