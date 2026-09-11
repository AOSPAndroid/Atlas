// Native cursor images stay sharp without a pointer-following DOM layer or RAF.
export function installMapCursor({ viewport, canvases }) {
  function arrow(outline, fallback) {
    const shape = "M5 3 L5 24 L11 18 L16 28 L21 25.5 L16 16 L25 16 Z";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="${shape}" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="${shape}" fill="white" stroke="${outline}" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 5 3, ${fallback}`;
  }
  const styles = {
    default: arrow("#203445", "default"),
    hover: arrow("#007eae", "pointer"),
    drag: "grabbing",
    place: "crosshair",
  };
  viewport.style.setProperty("--atlas-map-arrow", styles.default);
  viewport.style.setProperty("--atlas-map-hover", styles.hover);
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
