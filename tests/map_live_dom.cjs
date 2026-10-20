// Open maps (Admin or Demo) pick up seating changes in place; requests are simulated.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fixture, root } = require("./ui_fixture.cjs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const source = JSON.parse(fs.readFileSync(path.join(root, "atlas/official-data.json"), "utf8"));
  let desk = { ...source.records[0], name: "Christophe Duriez", occupancy: "assigned" };
  let version = { version: "10.2", live_plan: null }, states = 0;
  const f = await fixture({
    html: "atlas/official-index.html",
    url: "http://127.0.0.1:8771/",
    fetch: async (url) => {
      url = String(url);
      let data;
      if (url.includes("official-data.json")) data = { ...source, records: [desk] };
      else if (url === "/api/official/state") { states++; data = { records: [desk], legacy: [], mappings: {}, read_only: true }; }
      else if (url === "/api/official/version") data = version;
      else data = {};
      return { ok: true, json: async () => data };
    },
  });
  const { w } = f, d = w.document;
  const meta = d.createElement("meta"); meta.name = "atlas-mode"; meta.content = "viewer"; d.head.append(meta);
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.requestAnimationFrame = () => 1; w.cancelAnimationFrame = () => {};
  await f.map(); await sleep(50);
  const before = states;
  await w.AtlasLivePlan.check();
  assert.equal(states, before, "The first check only records the version");
  assert.equal(d.getElementById("mapSource").textContent, "Paris map · Europe-wide directory");
  desk = { ...desk, name: "Vacant desk", occupancy: "vacant" };
  version = { version: "11.2", live_plan: { at: "2026-10-20T09:15:00+00:00", source: "Hoche Project_20261020.xlsx" } };
  await w.AtlasLivePlan.check();
  assert.equal(states, before + 1, "A new version reloads the seating in place");
  assert.match(d.getElementById("mapSource").textContent, /^Live plan: Hoche Project_20261020\.xlsx · updated /);
  await w.AtlasLivePlan.check();
  assert.equal(states, before + 1, "Same version, no reload");
  assert.deepEqual(f.errors, []);
  w.close();
  console.log("PASS: open maps poll a small version marker, reload seating in place when it changes, and name the live plan");
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
