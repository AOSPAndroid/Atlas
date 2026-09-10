// Standard system cursors communicate map interaction states.
export function installMapCursor({ viewport, canvases }) {
  const styles = {
    default: "default",
    hover: "pointer",
    drag: "grabbing",
    place: "crosshair",
  };
  function set(element, state) {
    if (element.dataset.mapCursor === state) return;
    element.dataset.mapCursor = state;
    element.style.cursor = styles[state] || styles.default;
  }
  function reset() {
    for (const element of canvases) set(element, "default");
  }
  viewport.addEventListener("pointercancel", reset);
  window.addEventListener("blur", reset);
  window.addEventListener("pagehide", reset);
  reset();
  return { set, reset };
}
