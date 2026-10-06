const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { JSDOM, VirtualConsole } = require("jsdom");
const root = __dirname + "/../frontend/assets/";
const dom = new JSDOM(fs.readFileSync(root + "desktop.html", "utf8"), {
  url: "http://127.0.0.1:8771/assets/desktop.html",
  runScripts: "outside-only",
  pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(),
});
const w = dom.window,
  d = w.document;
Object.defineProperty(w, "innerWidth", { value: 1440, writable: true });
Object.defineProperty(d.querySelector("#desktopArea"), "clientWidth", {
  get: () => w.innerWidth,
});
Object.defineProperty(d.querySelector("#desktopArea"), "clientHeight", {
  value: 900,
});
w.AtlasUI = { motion: { isReduced: () => true } };
w.confirm = () => false;
const fallback = fs.readFileSync(root + "shared-ui.js", "utf8")
  .split('/* An on-demand index')[1].replace(/^.*?\*\//s, '');
w.eval(fallback);
d.dispatchEvent(new w.Event('DOMContentLoaded'));
assert.equal(d.querySelector('.atlas-action-fallback'), null,
  'Desktop shell uses its window controls without a duplicate, clipped action index');
w.eval(fs.readFileSync(root + "desktop.js", "utf8"));
const click = (s) => d.querySelector(s).click(),
  win = (id) => d.querySelector(`[data-app-window="${id}"]`);
assert.equal(
  d.querySelectorAll("iframe").length,
  0,
  "apps load only when opened",
);
click('[data-app="map"]');
const mapFrame = win("map").querySelector("iframe");
assert.equal(new URL(mapFrame.src).searchParams.get("atlasWindow"), "map");
click('[data-app="workspace"]');
click('[data-app="knowledge"]');
assert.equal(d.querySelectorAll("iframe").length, 3);
click('[data-app="map"]');
assert.equal(
  win("map").querySelector("iframe"),
  mapFrame,
  "reuse existing app state",
);
const bar = win("map").querySelector(".window-bar");
bar.dispatchEvent(
  new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
);
assert.equal(win("map").style.left, "55px");
bar.dispatchEvent(
  new w.MouseEvent("pointerdown", {
    clientX: 100,
    clientY: 100,
    button: 0,
    bubbles: true,
  }),
);
w.dispatchEvent(
  new w.MouseEvent("pointermove", { clientX: 200, clientY: 140 }),
);
w.dispatchEvent(new w.MouseEvent("pointerup"));
assert.equal(win("map").style.left, "155px");
assert.equal(d.querySelector("#dragShield").hidden, true);
const handle = win("map").querySelector('[data-edge="se"]'),
  width = parseFloat(win("map").style.width);
handle.dispatchEvent(
  new w.MouseEvent("pointerdown", {
    clientX: 100,
    clientY: 100,
    button: 0,
    bubbles: true,
  }),
);
w.dispatchEvent(new w.MouseEvent("pointermove", { clientX: 50, clientY: 70 }));
w.dispatchEvent(new w.MouseEvent("pointerup"));
assert.equal(parseFloat(win("map").style.width), width - 50);
click("#multitask");
assert.equal(
  [...d.querySelectorAll(".desktop-window")].filter((e) => !e.hidden).length,
  1,
);
click('[data-app="knowledge"]');
assert(win("map").hidden);
assert.equal(win("map").querySelector("iframe"), mapFrame);
click('[data-app-window="knowledge"] [data-window="minimize"]');
assert(win("knowledge").hidden);
click('[data-app="knowledge"]');
assert(!win("knowledge").hidden);
click("#multitask");
assert.equal(win("map").style.left, "155px", "floating geometry restored");
click('[data-app-window="knowledge"] [data-window="left"]');
assert.equal(win("knowledge").style.width, "720px");
w.dispatchEvent(
  new w.MessageEvent("message", {
    origin: "https://evil.test",
    source: mapFrame.contentWindow,
    data: {
      atlasDesktop: true,
      type: "open",
      url: "/installer?command=knowledge",
    },
  }),
);
assert.equal(d.querySelectorAll("iframe").length, 3);
click("#resetWindows");
assert.equal(win("map").style.left, "35px");
w.innerWidth = 500;
w.dispatchEvent(new w.Event("resize"));
assert(d.body.classList.contains("single-mode"));
assert.equal(
  [...d.querySelectorAll(".desktop-window")].filter((e) => !e.hidden).length,
  1,
);
assert.equal(
  JSON.parse(w.localStorage.getItem("atlas-desktop-settings")).multi,
  true,
  "compact layout preserves preference",
);
click("#home");
assert([...d.querySelectorAll(".desktop-window")].every((e) => e.hidden));
assert.equal(
  d.querySelectorAll("iframe").length,
  3,
  "minimize keeps monitoring contexts alive",
);
assert.equal(
  JSON.parse(w.localStorage.getItem("atlas-desktop-settings")).rects.map.x,
  35,
);
const exitDesktop=()=>w.dispatchEvent(new w.MessageEvent('message',{origin:w.location.origin,source:mapFrame.contentWindow,data:{atlasDesktop:true,type:'classic'}}));
assert.equal(d.querySelector('#desktopEnabled'),null,'mode switch is only in the command palette');
w.confirm=()=>false;exitDesktop();
assert.equal(w.localStorage.getItem('atlas-layout'),'desktop');
w.confirm=()=>true;exitDesktop();
assert.equal(w.localStorage.getItem('atlas-layout'),'classic','palette exit remembers classic layout');
w.close();
for (const [file, route] of [["desktop-utility.html", "/assets/desktop-utility.html?app=notes"], ["../index.html", "/installer?atlasWindow=workspace"]]) {
  const app = new JSDOM(fs.readFileSync(root + file, "utf8"), {
    url: "http://127.0.0.1:8771" + route, runScripts: "outside-only",
  });
  app.window.eval(fallback);
  app.window.document.dispatchEvent(new app.window.Event('DOMContentLoaded'));
  assert(app.window.document.querySelector('.atlas-action-fallback'),
    'utility and embedded app documents retain their own action index');
  app.window.close();
}
console.log(
  "PASS: lazy apps, retained frames, drag/resize, saved geometry, minimize, snap/reset, single-window and compact modes, rejected foreign messages",
);
