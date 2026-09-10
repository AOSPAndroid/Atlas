// Map interaction states use the same native cursor set as the rest of Atlas.
export function installMapCursor({ viewport, canvases }) {
  const cursor = window.AtlasCursor;
  cursor.install();
  function set(element, state, event) {
    if (element.dataset.mapCursor === state) return;
    element.dataset.mapCursor = state;
    element.style.cursor = cursor.styles[state] || cursor.styles.default;
    if (state === "hover" && event) cursor.pulse(event, true);
  }
  function reset() {
    cursor.clear();
    for (const element of canvases) set(element, "default");
  }
  viewport.addEventListener("pointerover", (event) => {
    const label = event.target.closest(".map-name");
    if (label && !label.contains(event.relatedTarget))
      cursor.pulse(event, true);
  });
  viewport.addEventListener("pointerleave", cursor.clear);
  viewport.addEventListener("pointercancel", reset);
  window.addEventListener("blur", reset);
  window.addEventListener("pagehide", reset);
  reset();
  return { set, clear: cursor.clear, reset };
}
