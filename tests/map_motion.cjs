// Real map handlers with a deterministic clock; no network or remote actions.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { fixture, root } = require("./ui_fixture.cjs");

(async () => {
  const data = JSON.parse(
    fs.readFileSync(path.join(root, "atlas/official-data.json"), "utf8"),
  );
  const f = await fixture({
    html: "atlas/official-index.html",
    url: "http://127.0.0.1:8892/",
    fetch: async (url) => {
      const desk = data.records.find((r) => String(url).includes(r.id));
      return {
        ok: true,
        json: async () =>
          String(url).includes("official-data.json")
            ? data
            : desk
              ? {
                  desk,
                  user: null,
                  candidates: [],
                  machines: [],
                  deployments: [],
                  match_method: "unmatched",
                }
              : {
                  records: data.records,
                  legacy: [],
                  mappings: {},
                  token: "test",
                },
      };
    },
  });
  const { w } = f;
  let clock = 0,
    id = 0,
    uploads = 0;
  const frames = new Map();
  assert.equal(
    w.AtlasUI.motion.isReduced(),
    true,
    "System respects reduced motion",
  );
  w.AtlasUI.motion.install(w.document.body);
  const motionControl = w.document.querySelector(".atlas-motion-toggle input");
  assert.equal(motionControl.checked, false);
  motionControl.click();
  assert.equal(
    w.AtlasUI.motion.isReduced(),
    false,
    "Explicit On overrides system preference",
  );
  assert.equal(w.localStorage.getItem("atlas-motion"), "full");
  assert.equal(w.document.documentElement.dataset.atlasMotion, "full");
  w.performance.now = () => clock;
  w.requestAnimationFrame = (fn) => {
    frames.set(++id, fn);
    return id;
  };
  w.cancelAnimationFrame = (key) => frames.delete(key);
  const step = (ms) => {
    clock += ms;
    const pending = [...frames];
    frames.clear();
    for (const [, fn] of pending) fn(clock);
  };
  const gl = new Proxy(
    {
      bufferData: () => uploads++,
      getShaderParameter: () => true,
      getProgramParameter: () => true,
    },
    { get: (o, k) => o[k] || (() => ({})) },
  );
  const ctx = new Proxy({}, { get: () => () => ({}) });
  w.HTMLCanvasElement.prototype.getContext = (type) =>
    type === "webgl" ? gl : type === "2d" ? ctx : null;
  w.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  w.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 650,
  });
  for (const [key, value] of [
    ["clientWidth", 900],
    ["clientHeight", 650],
  ])
    Object.defineProperty(w.HTMLCanvasElement.prototype, key, {
      get: () => value,
    });
  const t = await f.map(`
    export {selectRecord, setFloor, setView, focusTarget, cameraMotion, inversePoint};
    export function state(){return {...cam}}
    export function currentCanvas(){return canvas}
  `);
  const close = (a, b) => {
    for (const key of Object.keys(a))
      assert(Math.abs(a[key] - b[key]) < 1e-8, key);
  };
  step(0);
  const people = data.records.filter((r) => r.floor === 2 && r.kind === "desk");
  assert(people.length > 1);
  const initial = t.state();
  t.selectRecord(people[0].id);
  close(t.state(), initial);
  assert(t.cameraMotion.active);
  step(360);
  assert.notDeepEqual(t.state(), initial, "focus changes over time");
  assert.equal(frames.size, 1, "only one render callback owns camera motion");
  // A newer selection continues from the current position and owns the endpoint.
  const middle = t.state();
  t.selectRecord(people[1].id);
  close(t.state(), middle);
  const goal = t.focusTarget(people[1]);
  step(720);
  close(t.state(), goal);
  assert.equal(t.cameraMotion.active, false);
  assert.equal(frames.size, 0, "completed flight leaves no camera loop");

  t.selectRecord(people[0].id);
  step(100);
  const interrupted = t.state();
  t.currentCanvas().dispatchEvent(
    new w.MouseEvent("pointerdown", { clientX: 400, clientY: 250, button: 0 }),
  );
  assert.equal(t.cameraMotion.active, false);
  step(900);
  close(t.state(), interrupted);
  t.currentCanvas().dispatchEvent(new w.MouseEvent("pointerup", { button: 2 }));

  t.selectRecord(people[0].id);
  t.setFloor(4);
  assert.equal(
    t.cameraMotion.active,
    false,
    "floor change cancels old destination",
  );
  step(0);
  w.document.querySelector("#zoom-in").click();
  w.document.querySelector("#zoom-in").click();
  const zoomStart = t.state().scale;
  step(200);
  assert(
    Math.abs(t.state().scale - zoomStart * 1.25 ** 2) < 1e-8,
    "rapid zoom clicks accumulate",
  );

  const anchor = [330, 240],
    beforeAnchor = t.inversePoint(...anchor);
  t.currentCanvas().dispatchEvent(
    new w.WheelEvent("wheel", {
      clientX: anchor[0],
      clientY: anchor[1],
      deltaY: -100,
      cancelable: true,
    }),
  );
  step(200);
  const afterAnchor = t.inversePoint(...anchor);
  assert(
    Math.hypot(...beforeAnchor.map((n, i) => n - afterAnchor[i])) < 1e-8,
    "wheel zoom preserves cursor anchor",
  );

  t.setView("3d", true);
  step(480);
  const uploadCount = uploads;
  w.document.querySelector("#rotate").click();
  for (let i = 0; i < 24; i++) step(16);
  assert.equal(uploads, uploadCount, "animation reuses WebGL geometry");
  assert.equal(frames.size, 0);

  t.selectRecord(people[0].id);
  const reducedGoal = t.focusTarget(people[0]);
  motionControl.click();
  assert(
    [...w.document.querySelectorAll(".atlas-motion-toggle input")].every(
      (el) => !el.checked,
    ),
  );
  close(t.state(), reducedGoal);
  assert.equal(
    t.cameraMotion.active,
    false,
    "changing motion preference completes current flight",
  );
  t.selectRecord(people[1].id);
  close(t.state(), t.focusTarget(people[1]));
  assert.equal(t.cameraMotion.active, false, "reduced motion is immediate");
  step(0);
  assert.equal(frames.size, 0);
  assert.equal(
    w.localStorage.getItem("atlas-motion"),
    "reduce",
    "Off is remembered",
  );
  w.localStorage.setItem("atlas-motion", "full");
  w.dispatchEvent(new w.StorageEvent("storage", { key: "atlas-motion" }));
  assert(
    [...w.document.querySelectorAll(".atlas-motion-toggle input")].every(
      (el) => el.checked,
    ),
    "Switches follow changes in another tab",
  );
  await new Promise(setImmediate);
  assert.equal(f.errors.length, 0, f.errors.join("\n"));
  w.close();
  console.log(
    "PASS: animated focus, rapid replacement, pointer/floor interruption, zoom accumulation and anchor, cached rendering, reduced motion, idle loop shutdown",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
