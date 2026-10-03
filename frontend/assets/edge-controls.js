/* Compatibility entry point for older HTML and cached links.
 * Controls now stay in their native layout; legacy hover/pin preferences
 * never move, hide or make controls inert.
 */
(() => {
  "use strict";
  document.documentElement.classList.remove("atlas-auto-hide");
  window.AtlasEdges = Object.freeze({
    refresh() {}, open() {}, close() {}, revealFor() {},
  });
})();
