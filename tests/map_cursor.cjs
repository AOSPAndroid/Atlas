const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { fixture, root } = require("./ui_fixture.cjs");

(async () => {
  const f = await fixture({ html: "atlas/official-index.html" });
  const { w } = f,
    viewport = w.document.querySelector("#viewport");
  const canvas = w.document.querySelector("#canvas"),
    second = w.document.createElement("canvas");
  viewport.append(second);
  let reduced = false,
    frames = 0,
    measures = 0;
  w.requestAnimationFrame = () => ++frames;
  viewport.getBoundingClientRect = () => {
    measures++;
    return { left: 10, top: 20 };
  };
  const animations = [];
  w.HTMLElement.prototype.animate = function (keyframes, options) {
    const animation = {
      keyframes,
      options,
      cancelled: false,
      cancel() {
        this.cancelled = true;
      },
    };
    animations.push(animation);
    return animation;
  };
  const module = new vm.SourceTextModule(
    fs.readFileSync(path.join(root, "atlas/map-cursor.js"), "utf8"),
    { context: f.context },
  );
  await module.link(() => {
    throw Error("Cursor must not load dependencies");
  });
  await module.evaluate();
  const cursor = module.namespace.installMapCursor({
    viewport,
    canvases: [canvas, second],
    reduced: () => reduced,
  });
  const feedback = viewport.querySelector(".atlas-cursor-feedback");
  const event = { clientX: 110, clientY: 120, pointerType: "mouse" };
  for (const element of [canvas, second]) {
    assert.equal(element.dataset.mapCursor, "default");
    const svg = decodeURIComponent(element.style.cursor);
    assert(
      svg.includes("#00aeef") &&
        svg.includes('stroke="white"') &&
        svg.includes('stroke="#102c3d"'),
    );
  }
  for (let i = 0; i < 100; i++) cursor.set(canvas, "default", event);
  assert.equal(frames, 0);
  assert.equal(measures, 0);
  assert.equal(animations.length, 0);
  cursor.set(canvas, "hover", event);
  assert.equal(animations.length, 1);
  assert(!feedback.hidden);
  for (let i = 0; i < 100; i++) cursor.set(canvas, "hover", event);
  assert.equal(
    animations.length,
    1,
    "Holding hover never creates an animation loop",
  );
  assert.equal(measures, 1, "Pointer movement does not measure another layout");
  canvas.dispatchEvent(
    new w.MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: 160,
      clientY: 180,
    }),
  );
  assert(animations[0].cancelled);
  assert.equal(animations.length, 2);
  animations[0].onfinish();
  assert(!feedback.hidden, "An old finish cannot hide new feedback");
  assert.equal(feedback.style.left, "150px");
  assert.equal(feedback.style.top, "160px");
  animations[1].onfinish();
  assert(feedback.hidden);
  const label = w.document.createElement("button");
  label.className = "map-name";
  viewport.append(label);
  label.dispatchEvent(
    new w.MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  assert.equal(animations.length, 3, "Name labels share map feedback");
  const control = w.document.querySelector("#zoom-in");
  control.dispatchEvent(
    new w.MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  assert.equal(animations.length, 3, "Map controls keep standard behaviour");
  const touch = new w.MouseEvent("pointerdown", { bubbles: true, button: 0 });
  Object.defineProperty(touch, "pointerType", { value: "touch" });
  canvas.dispatchEvent(touch);
  assert.equal(animations.length, 3, "No custom pointer feedback for touch");
  reduced = true;
  w.dispatchEvent(new w.Event("atlas-motion-change"));
  assert(feedback.hidden);
  assert(animations[2].cancelled);
  canvas.dispatchEvent(
    new w.MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  cursor.set(canvas, "place", event);
  assert.equal(animations.length, 3);
  assert(
    canvas.style.cursor.includes("crosshair"),
    "The coloured cursor remains with motion off",
  );
  reduced = false;
  cursor.set(canvas, "hover", event);
  cursor.set(canvas, "drag");
  assert(canvas.style.cursor.includes("grabbing"));
  w.dispatchEvent(new w.Event("blur"));
  assert(feedback.hidden);
  assert.equal(canvas.dataset.mapCursor, "default");
  cursor.set(canvas, "hover", event);
  viewport.dispatchEvent(new w.Event("pointerleave"));
  assert(feedback.hidden);
  assert.equal(viewport.querySelectorAll(".atlas-cursor-feedback").length, 1);
  assert.equal(frames, 0, "Cursor never starts a rendering loop");
  assert.equal(f.errors.length, 0, f.errors.join("\n"));
  w.close();
  console.log(
    "PASS: native branded cursors, bounded hover/click feedback, no pointer loop, controls/touch unchanged, reduced motion and cleanup",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
