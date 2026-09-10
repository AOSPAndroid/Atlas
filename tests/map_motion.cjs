// Real map handlers with a deterministic clock; no network or remote actions.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { fixture, root } = require("./ui_fixture.cjs");

(async () => {
  for (const readOnly of [false, true]) {
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
    if (readOnly) {
      const meta = w.document.createElement("meta");
      meta.name = "atlas-mode";
      meta.content = "viewer";
      w.document.head.append(meta);
    }
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
    const motionControl = w.document.querySelector(
      ".atlas-motion-toggle input",
    );
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
    const captures = new Map();
    w.HTMLCanvasElement.prototype.setPointerCapture = function (id) {
      captures.set(id, this);
    };
    w.HTMLCanvasElement.prototype.hasPointerCapture = function (id) {
      return captures.get(id) === this;
    };
    w.HTMLCanvasElement.prototype.releasePointerCapture = function (id) {
      captures.delete(id);
      const event = new w.Event("lostpointercapture");
      Object.defineProperty(event, "pointerId", { value: id });
      this.dispatchEvent(event);
    };
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
    export {selectRecord, setFloor, setView, focusTarget, cameraMotion, inversePoint, projected, world};
    export function state(){return {...cam}}
    export function currentCanvas(){return canvas}
    export function setCamera(value){cam = {...cam, ...value}; draw()}
    export function selection(){return selected?.id}
  `);
    const close = (a, b) => {
      for (const key of Object.keys(a))
        assert(Math.abs(a[key] - b[key]) < 1e-8, key);
    };
    step(0);
    const people = data.records.filter(
      (r) => r.floor === 2 && r.kind === "desk",
    );
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
      new w.MouseEvent("pointerdown", {
        clientX: 400,
        clientY: 250,
        button: 0,
      }),
    );
    assert.equal(t.cameraMotion.active, false);
    assert.equal(t.currentCanvas().dataset.mapCursor, "drag");
    step(900);
    close(t.state(), interrupted);
    t.currentCanvas().dispatchEvent(
      new w.MouseEvent("pointerup", { button: 2 }),
    );
    assert.notEqual(t.currentCanvas().dataset.mapCursor, "drag");

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
    assert.equal(t.currentCanvas().dataset.mapCursor, "default");
    assert.equal(t.currentCanvas().style.cursor, "default");
    step(480);
    const uploadCount = uploads;
    w.document.querySelector("#rotate").click();
    for (let i = 0; i < 24; i++) step(16);
    assert.equal(uploads, uploadCount, "animation reuses WebGL geometry");
    assert.equal(frames.size, 0);

    const pointer = (type, x, y, options = {}, target = t.currentCanvas()) => {
      const event = new w.MouseEvent(type, {
        clientX: x,
        clientY: y,
        button: 0,
        cancelable: true,
        ...options,
      });
      Object.defineProperty(event, "pointerId", {
        value: options.pointerId || 1,
      });
      target.dispatchEvent(event);
    };
    // The grabbed point follows the pointer exactly, at different zooms and angles.
    for (const mode of ["plan", "3d"]) {
      t.setView(mode);
      for (const scale of [0.5, 2, 8]) {
        t.setCamera({ scale, yaw: mode === "3d" ? 1.1 : 0 });
        step(0);
        const start = [620, 220],
          end = [697, 271],
          grabbed = t.inversePoint(...start),
          before = t.state();
        const selection = t.selection();
        pointer("pointerdown", ...start);
        pointer("pointermove", 650, 240);
        // Changing Shift after the drag begins must not switch modes or jump.
        pointer("pointermove", ...end, { shiftKey: true });
        close(t.inversePoint(...end), grabbed);
        assert.equal(
          t.state().yaw,
          before.yaw,
          "left-drag pans without rotation",
        );
        assert.equal(t.state().tilt, before.tilt);
        assert.equal(t.state().scale, scale);
        pointer("pointerup", ...end);
        assert.equal(
          t.selection(),
          selection,
          "dragging does not select a desk",
        );
        assert.equal(captures.size, 0);
        step(0);
        assert.equal(frames.size, 0, "dragging adds no idle animation loop");
      }
    }

    t.setCamera({ scale: 2, yaw: 0.7, tilt: 0.9 });
    step(0);
    const pivot = [680, 210],
      floorPoint = t.inversePoint(...pivot),
      beforeOrbit = t.state();
    const orbitUploads = uploads;
    pointer("pointerdown", ...pivot, { shiftKey: true });
    pointer("pointermove", 740, 250, { shiftKey: false });
    close(t.inversePoint(...pivot), floorPoint);
    assert.notEqual(t.state().yaw, beforeOrbit.yaw);
    assert.notEqual(t.state().tilt, beforeOrbit.tilt);
    assert.notEqual(
      t.state().cx,
      beforeOrbit.cx,
      "rotation uses the grabbed point, not a fixed centre",
    );
    pointer("pointermove", 760, 2000);
    close(t.inversePoint(...pivot), floorPoint);
    assert(
      t.state().tilt < Math.PI / 2,
      "tilt stays above the floor without flipping",
    );
    pointer("pointermove", 760, -2000);
    close(t.inversePoint(...pivot), floorPoint);
    assert(t.state().tilt > 0, "tilt never reaches the singular horizon");
    pointer("pointerup", 760, -2000);
    step(0);
    assert.equal(
      uploads,
      orbitUploads,
      "manual rotation reuses cached geometry",
    );
    assert.match(
      w.document.querySelector("#hint").textContent,
      /Shift-drag to rotate/,
    );

    // Normal clicks retain selection; several tiny moves form a drag, not a click.
    t.setFloor(2);
    t.selectRecord(people[1].id);
    step(720);
    const clickPoint = t.projected(t.world(people[0])).slice(0, 2);
    pointer("pointerdown", ...clickPoint);
    pointer("pointerup", ...clickPoint);
    assert.equal(
      t.selection(),
      people[0].id,
      "a simple click still selects a desk",
    );
    step(720);
    const deskPoint = t.projected(t.world(people[0])).slice(0, 2);
    pointer("pointerdown", ...deskPoint);
    for (let delta = 1; delta <= 8; delta++)
      pointer("pointermove", deskPoint[0] + delta, deskPoint[1]);
    pointer("pointerup", deskPoint[0] + 8, deskPoint[1]);
    assert.equal(
      t.cameraMotion.active,
      false,
      "slow dragging is not mistaken for a click",
    );

    for (const interrupt of [
      "pointercancel",
      "lostpointercapture",
      "blur",
      "view",
      "floor",
    ]) {
      t.setView("3d");
      const oldCanvas = t.currentCanvas();
      pointer("pointerdown", 430, 310);
      pointer("pointermove", 450, 330);
      if (interrupt === "view") t.setView("plan");
      else if (interrupt === "floor") t.setFloor(4);
      else if (interrupt === "blur") w.dispatchEvent(new w.Event("blur"));
      else pointer(interrupt, 450, 330);
      const stopped = t.state();
      pointer("pointermove", 540, 400, {}, oldCanvas);
      pointer("pointerup", 540, 400, {}, oldCanvas);
      close(t.state(), stopped);
      assert.equal(captures.size, 0, interrupt + " releases capture");
      assert.notEqual(oldCanvas.dataset.mapCursor, "drag");
    }

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
  }
  console.log(
    "PASS: admin/viewer grab-to-pan, anchored 3D rotation, click/drag distinction, capture cleanup, animated focus, zoom anchoring, cached rendering and reduced motion",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
