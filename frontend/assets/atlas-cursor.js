/* One native cursor set and short click feedback for every Atlas page. */
(() => {
  if (window.AtlasCursor) return;
  const shapes = {
    default: [
      "M5.5 4.4C4.8 3.8 4.2 4.2 4.3 5.2L5.5 25.9C5.6 27.2 6.3 27.5 7.2 26.6L12.1 22.1L16.3 29.5C16.8 30.4 17.5 30.6 18.4 30.1L21 28.7C21.9 28.2 22.1 27.5 21.5 26.5L17.3 19.5L24.2 19C25.6 18.9 25.9 18 24.8 17.1Z",
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
      const fill = line ? "none" : "white";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="34" viewBox="0 0 32 34"><g stroke-linecap="round" stroke-linejoin="round"><path d="${path}" fill="${fill}" stroke="#00aeef" stroke-width="${line ? 4.6 : 3}"/>${line ? `<path d="${path}" fill="none" stroke="white" stroke-width="1.6"/>` : ""}</g></svg>`;
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
