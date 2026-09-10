/* One native cursor set and short click feedback for every Atlas page. */
(() => {
  if (window.AtlasCursor) return;
  const shapes = {
    default: [
      "M5.3 3.8C4.7 3.3 4.1 3.7 4.2 4.5L5.4 25.2C5.5 26.3 6.1 26.5 6.9 25.8L11.4 21.6L15.5 29C15.9 29.7 16.4 29.8 17.1 29.4L19.3 28.1C20 27.7 20.1 27.2 19.7 26.5L15.7 19.8L22 18.8C23.1 18.6 23.3 17.9 22.4 17.2Z",
      5,
      4,
      "default",
    ],
    hover: [
      "M10.5 16V5.8a2 2 0 0 1 4 0v7.1c.5-.7 1.1-1 1.8-1 1.1 0 2 .8 2 1.9v.5c.5-.6 1.1-.9 1.8-.9 1.2 0 2 .9 2 2v.5c.4-.4 1-.7 1.6-.7 1.1 0 1.9.9 1.9 2v4.1c0 4.4-2.7 7.7-6.8 7.7h-2.2c-2.6 0-4.4-1.3-6-3.7L6.3 19a2 2 0 0 1 2.9-2.6l1.3 1.2Z",
      12,
      5,
      "pointer",
    ],
    drag: [
      "M9 17v-5a2 2 0 0 1 4 0v3-5a2 2 0 0 1 4 0v5-4a2 2 0 0 1 4 0v4-2a2 2 0 0 1 4 0v7c0 6-3 9-8 9h-2c-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-3Z",
      16,
      17,
      "grabbing",
    ],
    place: [
      "M14.5 4h3v7h-3ZM14.5 21h3v7h-3ZM4 14.5h7v3H4ZM21 14.5h7v3h-7ZM14.5 14.5h3v3h-3Z",
      16,
      16,
      "crosshair",
    ],
    text: ["M12 6h8m-4 0v20m-4 0h8", 16, 16, "text", true],
    disabled: [
      "M16 6a10 10 0 1 0 0 20 10 10 0 1 0 0-20Zm-7 3 14 14",
      16,
      16,
      "not-allowed",
      true,
    ],
  };
  const styles = Object.fromEntries(
    Object.entries(shapes).map(([state, [path, x, y, fallback, line]]) => {
      const fill = line ? "none" : "url(#blue)";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="34" viewBox="0 0 32 34"><defs><linearGradient id="blue" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#53d4ff"/><stop offset=".48" stop-color="#00aeef"/><stop offset="1" stop-color="#008fc8"/></linearGradient></defs><g stroke-linecap="round" stroke-linejoin="round"><path d="${path}" fill="${fill}" stroke="white" stroke-width="${line ? 4.4 : 2.8}"/><path d="${path}" fill="${fill}" stroke="#12364a" stroke-width="${line ? 2.6 : 0.95}"/>${line ? `<path d="${path}" fill="none" stroke="#00aeef" stroke-width="1.4"/>` : ""}</g></svg>`;
      return [
        state,
        `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`,
      ];
    }),
  );
  for (const [state, value] of Object.entries(styles))
    document.documentElement.style.setProperty(
      `--atlas-cursor-${state}`,
      value,
    );
  document.documentElement.classList.add("atlas-cursor-ready");
  let feedback,
    animation = null;
  const reduced = () => window.AtlasUI?.motion.isReduced() ?? true;
  function install() {
    if (feedback || !document.body) return;
    feedback = document.createElement("div");
    feedback.className = "atlas-cursor-feedback";
    feedback.setAttribute("aria-hidden", "true");
    feedback.setAttribute("popover", "manual");
    feedback.hidden = true;
    document.body.append(feedback);
  }
  function clear() {
    animation?.cancel();
    animation = null;
    if (!feedback) return;
    if (feedback.hidePopover && feedback.matches(":popover-open"))
      feedback.hidePopover();
    feedback.hidden = true;
  }
  function pulse(event, hover = false) {
    if (reduced() || event.pointerType === "touch") return;
    install();
    if (!feedback?.animate) return;
    clear();
    feedback.style.left = event.clientX + "px";
    feedback.style.top = event.clientY + "px";
    feedback.hidden = false;
    // A manual popover lets feedback appear above modal dialogs without taking focus.
    feedback.showPopover?.();
    const current = feedback.animate(
      [
        {
          transform: "translate(-50%, -50%) scale(.3)",
          opacity: hover ? 0.35 : 0.65,
        },
        {
          transform: `translate(-50%, -50%) scale(${hover ? 0.75 : 1.1})`,
          opacity: 0,
        },
      ],
      { duration: hover ? 200 : 360, easing: "cubic-bezier(.2,.7,.25,1)" },
    );
    animation = current;
    current.onfinish = () => {
      if (animation === current) clear();
    };
  }
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      const target = event.composedPath()[0];
      if (
        target?.closest?.(
          ':disabled,[aria-disabled="true"],textarea,[contenteditable="true"],input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([type="file"])',
        )
      )
        return;
      pulse(event);
    },
    true,
  );
  for (const event of ["blur", "pagehide", "pointercancel", "scroll"])
    window.addEventListener(event, clear, { passive: true, capture: true });
  document.addEventListener("pointerleave", clear);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clear();
  });
  window.addEventListener("atlas-motion-change", () => {
    if (reduced()) clear();
  });
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
  window.AtlasCursor = { styles, install, pulse, clear };
})();
