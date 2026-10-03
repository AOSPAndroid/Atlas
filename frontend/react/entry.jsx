import React from "react";
import { createRoot } from "react-dom/client";
import { ActionsHub } from "./actions-hub.jsx";
import { installMotionBridge } from "./motion-bridge.js";
import "./styles.css";

// One small React island. Existing screens, APIs and large tables retain ownership.
function install() {
  const main = document.querySelector("main");
  if (
    !main ||
    !window.AtlasUI ||
    document.querySelector(".atlas-interactions-host")
  )
    return;
  window.AtlasReachableFallback?.destroy();
  const host = document.createElement("div");
  host.className = "atlas-interactions-host";
  host.dataset.atlasReact = "tools";
  const heading = main.querySelector(
    ":scope > .console-page-heading, :scope > .map-heading, :scope > header",
  );
  if (heading) heading.after(host);
  else main.prepend(host);
  const root = createRoot(host);
  root.render(<ActionsHub />);
  window.AtlasInteractions = { ready: true, ...installMotionBridge() };
  window.addEventListener(
    "pagehide",
    (event) => {
      if (!event.persisted) root.unmount();
    },
    { once: true },
  );
}
install();
