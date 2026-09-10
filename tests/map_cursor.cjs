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
  const feedback = w.document.querySelector(".atlas-cursor-feedback");
  w.AtlasUI.motion.isReduced = () => reduced;
  const event = { clientX: 110, clientY: 120, pointerType: "mouse" };
  for (const element of [canvas, second]) {
    assert.equal(element.dataset.mapCursor, "default");
    const svg = decodeURIComponent(element.style.cursor);
    assert(
      svg.includes("#00aeef") &&
        svg.includes('fill="white"') &&
        svg.includes('shape-rendering="crispEdges"'),
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
  assert.equal(measures, 0, "Cursor feedback does not measure page layout");
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
  assert.equal(feedback.style.left, "160px");
  assert.equal(feedback.style.top, "180px");
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
  assert.equal(animations.length, 4, "Map controls share the same feedback");
  const touch = new w.MouseEvent("pointerdown", { bubbles: true, button: 0 });
  Object.defineProperty(touch, "pointerType", { value: "touch" });
  canvas.dispatchEvent(touch);
  assert.equal(animations.length, 4, "No custom pointer feedback for touch");
  reduced = true;
  w.dispatchEvent(new w.Event("atlas-motion-change"));
  assert(feedback.hidden);
  assert(animations[3].cancelled);
  canvas.dispatchEvent(
    new w.MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  cursor.set(canvas, "place", event);
  assert.equal(animations.length, 4);
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
  assert.equal(w.document.querySelectorAll(".atlas-cursor-feedback").length, 1);
  assert.equal(frames, 0, "Cursor never starts a rendering loop");
  // The same service covers controls outside the map and inside shadow dialogs.
  const outside = w.document.createElement("button");
  w.document.body.append(outside);
  const clicks = () => animations.length;
  const send = (target) =>
    target.dispatchEvent(
      new w.MouseEvent("pointerdown", {
        bubbles: true,
        composed: true,
        button: 0,
        clientX: 12,
        clientY: 24,
      }),
    );
  let before = clicks();
  send(outside);
  assert.equal(clicks(), before + 1);
  const input = w.document.createElement("input");
  w.document.body.append(input);
  before = clicks();
  send(input);
  outside.disabled = true;
  send(outside);
  assert.equal(
    clicks(),
    before,
    "Text entry and disabled controls do not flash",
  );
  const host = w.document.createElement("div");
  w.document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = "<dialog open><button>Run</button><input></dialog>";
  before = clicks();
  send(shadow.querySelector("button"));
  assert.equal(clicks(), before + 1);
  before = clicks();
  send(shadow.querySelector("input"));
  assert.equal(clicks(), before);
  f.run(
    fs.readFileSync(path.join(root, "frontend/assets/atlas-cursor.js"), "utf8"),
  );
  outside.disabled = false;
  before = clicks();
  send(outside);
  assert.equal(
    clicks(),
    before + 1,
    "Installing twice does not double click feedback",
  );
  assert.equal(w.document.querySelectorAll(".atlas-cursor-feedback").length, 1);
  for (const kind of ["default", "hover", "text", "disabled"])
    assert(
      w.document.documentElement.style
        .getPropertyValue("--atlas-cursor-" + kind)
        .includes("00aeef"),
    );
  w.dispatchEvent(new w.Event("scroll"));
  assert(feedback.hidden);
  assert.equal(f.errors.length, 0, f.errors.join("\n"));
  w.close();
  console.log(
    "PASS: shared branded cursors, console/shadow dialog clicks, text/disabled/touch exclusions, idempotence, no pointer loop, reduced motion and cleanup",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
