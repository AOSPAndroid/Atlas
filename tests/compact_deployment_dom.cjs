// Deployment UI exercises use a simulated transport; no host is contacted.
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { fixture, root } = require("./ui_fixture.cjs");
const settle = () => new Promise((resolve) => setTimeout(resolve, 15));
(async () => {
  const writes = [];
  let slowSearch, submit, job;
  const row = (folder) => ({
    folder,
    display_name: "Application " + folder,
    version: "1",
  });
  const f = await fixture({
    fetch: async (url, options = {}) => {
      url = String(url);
      const reply = (data) => ({
        ok: true,
        status: 200,
        json: async () => data,
      });
      if (url === "/api/health")
        return reply({ identity: "FIXTURE", users: 0, machines: 0 });
      if (url === "/api/session") return reply({ token: "test" });
      if (url.includes("/palette/desks"))
        return { ...reply({ records: [] }), headers: { get: () => null } };
      if (url.startsWith("/api/catalog?")) {
        const term = new URL(url, "http://localhost").searchParams.get("term");
        if (term === "slow")
          return new Promise((resolve) => {
            slowSearch = () => resolve(reply({ items: [row("B")] }));
          });
        return reply({ items: (term ? [term] : ["A", "B"]).map(row) });
      }
      if (url.startsWith("/api/scripts?")) {
        const query = new URL(url, "http://localhost").searchParams;
        return reply({
          scripts: [query.get("package") + "_" + query.get("action") + ".ps1"],
        });
      }
      if (url === "/api/deploy") {
        writes.push(JSON.parse(options.body));
        return new Promise((resolve) => {
          submit = () => resolve(reply({ job: "test-job" }));
        });
      }
      if (url === "/api/job/test-job")
        return new Promise((resolve) => {
          job = (state) =>
            resolve(
              reply({
                state,
                events: [{ time: "12:00", message: "SIMULATED " + state }],
              }),
            );
        });
      return reply({ deployments: [], available: false, items: [] });
    },
  });
  await f.console();
  await settle();
  const { w, run } = f,
    doc = w.document;
  const style = doc.createElement("style");
  style.textContent = fs.readFileSync(
    path.join(root, "frontend/assets/atlas-theme.css"),
    "utf8",
  );
  doc.head.append(style);
  for (const id of ["fresh", "bulkFresh"]) {
    const control = doc.getElementById(id);
    assert.equal(control.getAttribute("role"), "switch");
    assert.equal(w.getComputedStyle(control).width, "36px");
    assert.equal(w.getComputedStyle(control).height, "22px");
    assert.equal(control.checked, false);
    control.click();
    assert.equal(
      control.checked,
      true,
      "native switch changes its checked state",
    );
    control.click();
    assert.equal(control.checked, false);
  }
  assert.equal(
    w.getComputedStyle(doc.getElementById("softwareCache")).width,
    "16px",
  );
  if (!doc.querySelector("#deploymentPanel").dataset.installed) {
    doc.dispatchEvent(new w.Event("DOMContentLoaded"));
    await settle();
  }
  const panel = doc.querySelector("#deploymentPanel"),
    picker = doc.querySelector("#packagePicker"),
    select = doc.querySelector("#pkg");
  const originalMedia = w.matchMedia;
  w.matchMedia = (query) =>
    query.includes("760px") ? { matches: false } : originalMedia(query);
  run("S.target='PC-A';syncDeploymentPanel()");
  assert.equal(panel.closest("aside").className, "console-sidebar");
  assert(!panel.hidden);
  assert(!doc.querySelector("#workspace #deploymentPanel"));
  assert.equal(select.value, "A");
  assert.equal(
    doc.querySelector("#packageSelection").textContent,
    "Application A · 1",
  );
  assert(doc.querySelector("#deploymentProgress").hidden);
  assert.equal(doc.querySelector("#log").textContent, "");
  assert(!doc.querySelector(".deployment-advanced").open);
  assert(doc.querySelector("#copyOnly").closest(".deployment-advanced"));

  picker.open = true;
  await settle();
  doc.querySelector("#pkgSearch").value = "B";
  await run("packages()");
  assert.equal(select.value, "B");
  select.dispatchEvent(new w.Event("change", { bubbles: true }));
  await settle();
  assert(picker.open, "keyboard selection stays open until committed");
  assert(
    doc.querySelector("#deploy").disabled,
    "browsing packages is not a deployment selection",
  );
  await run("deploy()");
  assert.equal(writes.length, 0);
  picker.dispatchEvent(
    new w.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  await settle();
  assert(!picker.open);
  assert.equal(select.value, "A", "Escape restores the committed package");
  assert.equal(doc.querySelector("#script").value, "A_Install.ps1");

  picker.open = true;
  await settle();
  doc.querySelector("#pkgSearch").value = "slow";
  const pendingSearch = run("packages()");
  run("cancelPackageChoice()");
  await settle();
  slowSearch();
  await pendingSearch;
  assert.equal(
    select.value,
    "A",
    "a cancelled search cannot replace the package",
  );

  picker.open = true;
  await settle();
  doc.querySelector("#pkgSearch").value = "B";
  await run("packages()");
  doc.querySelector("#choosePackage").click();
  await settle();
  assert(!picker.open);
  assert.equal(select.value, "B");
  assert.equal(
    doc.querySelector("#packageSelection").textContent,
    "Application B · 1",
  );
  doc.querySelector("#favBtn").click();
  assert.equal(
    doc.querySelector("#favBtn").getAttribute("aria-pressed"),
    "true",
  );
  picker.open = true;
  await settle();
  doc.querySelector("#pkgSearch").value = "A";
  await run("packages()");
  doc.querySelector('[data-recent="B"]').click();
  await settle();
  assert.equal(
    select.value,
    "B",
    "a favourite outside filtered results can be selected",
  );
  doc.querySelector('[data-deploy-action="Repair"]').click();
  await settle();
  assert.equal(doc.querySelector("#action").value, "Repair");
  assert.equal(doc.querySelector("#script").value, "B_Repair.ps1");
  assert.equal(
    doc
      .querySelector('[data-deploy-action="Repair"]')
      .getAttribute("aria-pressed"),
    "true",
  );

  doc.querySelector("#fresh").click();
  const deployment = run("deploy()");
  await settle();
  assert(doc.querySelector("#deploy").disabled);
  await run("deploy()");
  assert.equal(writes.length, 1, "submitting cannot create duplicate jobs");
  run("S.target='PC-B';syncDeploymentPanel()");
  submit();
  await deployment;
  await settle();
  assert.equal(writes[0].computer, "PC-A");
  assert.equal(writes[0].folder, "B");
  assert.equal(writes[0].action, "Repair");
  assert.equal(writes[0].script, "B_Repair.ps1");
  assert.equal(
    writes[0].fresh,
    true,
    "Fresh-copy choice reaches the deployment payload",
  );
  job("failed");
  await settle();
  assert(
    doc.querySelector("#deploymentProgress").hidden,
    "PC-A's result is not shown as PC-B's result",
  );
  run("S.target='PC-A';syncDeploymentPanel()");
  assert(!doc.querySelector("#deploymentProgress").hidden);
  assert.equal(doc.querySelector("#deploymentJobTarget").textContent, "PC-A");
  assert.equal(doc.querySelector("#deploymentState").textContent, "Failed");
  assert(doc.querySelector("#deploymentLog").open);
  assert.match(doc.querySelector("#log").textContent, /SIMULATED failed/);
  run("clearLookup()");
  assert(panel.hidden);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(f.errors.length, 0, f.errors.join("\n"));
  w.close();
  console.log(
    "PASS: sidebar deployment, searchable picker cancellation/favourites, action selection, immutable submission, duplicate prevention and target-specific progress",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
