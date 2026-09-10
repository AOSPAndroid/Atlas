// Native SVG cursors keep the pointer responsive, including on remote desktops.
// Only short, stationary feedback animates; there is no pointer-following loop.
const shapes = {
  default: ["M5 3 26 19 16.5 20 21.5 28 17.5 30 12.5 22 6 28Z", 5, 3, "grab"],
  hover: [
    "M10 16V5a2 2 0 0 1 4 0v9-3a2 2 0 0 1 4 0v3-1a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v6c0 5-3 8-7 8h-3c-3 0-5-2-7-5l-4-6a2 2 0 0 1 3-3l2 2Z",
    12,
    4,
    "pointer",
  ],
  drag: [
    "M9 17v-5a2 2 0 0 1 4 0v3-5a2 2 0 0 1 4 0v5-4a2 2 0 0 1 4 0v4-2a2 2 0 0 1 4 0v7c0 6-3 9-8 9h-2c-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-3Z",
    16,
    17,
    "grabbing",
  ],
  place: [
    "M14 3h4v8h-4ZM14 21h4v8h-4ZM3 14h8v4H3ZM21 14h8v4h-8ZM14 14h4v4h-4Z",
    16,
    16,
    "crosshair",
  ],
};
const cursors = Object.fromEntries(
  Object.entries(shapes).map(([state, [path, x, y, fallback]]) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34"><path d="${path}" fill="#00aeef" stroke="white" stroke-width="3.8" stroke-linejoin="round"/><path d="${path}" fill="#00aeef" stroke="#102c3d" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
    return [
      state,
      `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`,
    ];
  }),
);

export function installMapCursor({ viewport, canvases, reduced }) {
  const feedback = document.createElement("div");
  feedback.className = "atlas-cursor-feedback";
  feedback.setAttribute("aria-hidden", "true");
  feedback.hidden = true;
  viewport.append(feedback);
  viewport.style.setProperty("--atlas-map-pointer", cursors.hover);
  let animation = null;
  function clear() {
    animation?.cancel();
    animation = null;
    feedback.hidden = true;
  }
  function pulse(event, hover = false) {
    if (reduced() || event.pointerType === "touch" || !feedback.animate) return;
    clear();
    const bounds = viewport.getBoundingClientRect();
    feedback.style.left = event.clientX - bounds.left + "px";
    feedback.style.top = event.clientY - bounds.top + "px";
    feedback.hidden = false;
    const current = feedback.animate(
      [
        {
          transform: "translate(-50%, -50%) scale(.25)",
          opacity: hover ? 0.45 : 0.85,
        },
        {
          transform: `translate(-50%, -50%) scale(${hover ? 0.7 : 1.2})`,
          opacity: 0,
        },
      ],
      { duration: hover ? 230 : 430, easing: "cubic-bezier(.2,.7,.25,1)" },
    );
    animation = current;
    current.onfinish = () => {
      if (animation === current) clear();
    };
  }
  function set(element, state, event) {
    if (element.dataset.mapCursor === state) return;
    element.dataset.mapCursor = state;
    element.style.cursor = cursors[state] || cursors.default;
    if (state === "hover" && event) pulse(event, true);
  }
  function reset() {
    clear();
    for (const element of canvases) set(element, "default");
  }
  viewport.addEventListener("pointerdown", (event) => {
    if (
      event.button === 0 &&
      (canvases.includes(event.target) || event.target.closest(".map-name"))
    )
      pulse(event);
  });
  viewport.addEventListener("pointerover", (event) => {
    const label = event.target.closest(".map-name");
    if (label && !label.contains(event.relatedTarget)) pulse(event, true);
  });
  viewport.addEventListener("pointerleave", clear);
  viewport.addEventListener("pointercancel", reset);
  window.addEventListener("blur", reset);
  window.addEventListener("pagehide", reset);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) reset();
  });
  window.addEventListener("atlas-motion-change", () => {
    if (reduced()) clear();
  });
  reset();
  return { set, clear, reset };
}
