// All AI responses and records are fixtures: this test starts no model or scan.
const { JSDOM } = require("jsdom");
const { fixture: consoleFixture } = require("./ui_fixture.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function moduleFor(file, context, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const mod = new vm.SourceTextModule(fs.readFileSync(file, "utf8"), {
    context,
    identifier: file,
  });
  cache.set(file, mod);
  await mod.link((spec) =>
    moduleFor(path.resolve(path.dirname(file), spec), context, cache),
  );
  await mod.evaluate();
  return mod;
}
async function fixture({ readOnly = false, transport = true } = {}) {
  const dom = new JSDOM("<header></header>", {
      url: "http://127.0.0.1:8770/",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    }),
    w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  w.Headers = Headers;
  w.AbortController = AbortController;
  const calls = [],
    pending = [];
  let context = {},
    available = true;
  w.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/session")
      return { ok: true, json: async () => ({ token: "fixture-token" }) };
    if (url === "/api/assistant/status")
      return {
        ok: true,
        json: async () => ({
          available,
          model: "Fixture local model",
          reason: "Model files are missing.",
          setup: "Run Install_Atlas_Assistant.bat.",
        }),
      };
    if (url === "/api/assistant/ask")
      return new Promise((resolve) => pending.push({ resolve, options }));
    throw Error("Unexpected endpoint: " + url);
  };
  if (transport)
    vm.runInContext(
      fs.readFileSync(path.join(root, "frontend/assets/client.js"), "utf8"),
      dom.getInternalVMContext(),
    );
  const mod = await moduleFor(
    path.join(root, "atlas/command-palette.js"),
    dom.getInternalVMContext(),
  );
  const palette = mod.namespace.installCommandPalette({
    getRecords: () => [],
    onSelect() {
      throw Error("No map selection expected");
    },
    runCommand() {
      throw Error("No actions expected");
    },
    openPerson() {},
    openMachine() {},
    toast() {},
    triggerParent: w.document.querySelector("header"),
    readOnly,
    getAssistantContext: () => context,
  });
  const input = palette.root.querySelector("#atlas-command-input");
  const query = (s) => {
    input.value = s;
    input.dispatchEvent(
      new w.Event("input", { bubbles: true, composed: true }),
    );
  };
  const enter = () =>
    input.dispatchEvent(
      new w.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
      }),
    );
  const $ = (s) => palette.root.querySelector(s);
  return {
    dom,
    w,
    palette,
    calls,
    pending,
    query,
    enter,
    $,
    context(value) {
      context = value;
    },
    available(value) {
      available = value;
    },
    answer(
      index,
      answer = "Look at the existing evidence.",
      extra = {},
      ok = true,
    ) {
      pending[index].resolve({
        ok,
        status: ok ? 200 : 503,
        json: async () => ({ answer, ...extra }),
      });
    },
  };
}
(async () => {
  for (const transport of [true, false]) {
    const f = await fixture({ transport });
    await f.palette.open();
    assert.equal(
      f.calls.length,
      0,
      "opening the palette must not contact the assistant",
    );
    assert(f.$("[role=option]").textContent.includes("Ask Atlas"));
    f.enter();
    await settle();
    assert(f.palette.dialog.open, "assistant stays inside the palette");
    assert.equal(f.$("#atlas-command-input").getAttribute("role"), "textbox");
    assert.equal(
      f.$("#atlas-command-input").getAttribute("aria-controls"),
      null,
    );
    assert.equal(
      f.$("#atlas-command-input").getAttribute("aria-describedby"),
      "atlas-assistant-policy",
    );
    assert.equal(f.$(".assistant-transcript").getAttribute("role"), "log");
    f.$("#atlas-command-input").dispatchEvent(
      new f.w.KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        composed: true,
      }),
    );
    assert.equal(
      f.$("#atlas-command-input").getAttribute("aria-activedescendant"),
      null,
      "assistant typing cannot select hidden search results",
    );
    assert.equal(
      f.calls.filter((c) => c.url === "/api/assistant/status").length,
      1,
    );
    assert.equal(
      f.pending.length,
      0,
      "choosing Ask Atlas must not run inference",
    );
    assert(f.$(".assistant-policy").textContent.includes("Manual scans only"));
    f.context({
      machine: "PC-1",
      user_key: "id:1",
      scan_report: "PC-1 cached measurement: RAM 92%",
    });
    f.query("ask: Explain the slowness");
    await settle();
    assert.equal(
      f.pending.length,
      0,
      "typing and selecting context must not send a question",
    );
    assert(!f.$(".assistant-include").hidden);
    assert(
      !f.$(".assistant-include input").checked,
      "sharing cached scan text is explicit",
    );
    f.$(".assistant-include input").checked = true;
    f.$("[data-assistant-ask]").click();
    await settle();
    assert.equal(f.pending.length, 1);
    const req = f.pending[0],
      body = JSON.parse(req.options.body);
    assert.equal(
      new Headers(req.options.headers).get("X-Atlas-Token"),
      "fixture-token",
    );
    assert.equal(body.question, "Explain the slowness");
    assert.equal(body.machine, "PC-1");
    assert.equal(body.scan_report, "PC-1 cached measurement: RAM 92%");
    assert.deepEqual(body.history, []);
    f.enter();
    await settle();
    assert.equal(f.pending.length, 1, "one pending question only");
    f.answer(0, "<img src=x onerror=alert(1)>\nCheck paging.", {
      sources: [
        {
          label: "<script>Evidence</script>",
          detail: "Stored RAM measurement",
          excerpt:
            '<img src=x onerror="alert(1)">\n<script>alert(2)</script>\nRAM 92%\n' +
            "x".repeat(7000) +
            "TRUNCATED_SENTINEL",
        },
        {
          label: "Legacy source",
          detail: "Provenance without an excerpt remains supported.",
        },
      ],
      context_note: "No new machine checks.",
    });
    await settle();
    assert.equal(f.$(".assistant-transcript").children.length, 2);
    assert(f.$(".assistant-transcript").textContent.includes("<img src=x"));
    assert.equal(f.$(".assistant-transcript img"), null);
    assert.equal(f.$(".assistant-transcript script"), null);
    const excerpt = f.$(".assistant-source-excerpt");
    assert(excerpt.textContent.includes('<img src=x onerror="alert(1)">'));
    assert(excerpt.textContent.includes("<script>alert(2)</script>"));
    assert(excerpt.textContent.includes("RAM 92%"));
    assert(!excerpt.textContent.includes("TRUNCATED_SENTINEL"));
    assert(excerpt.textContent.length < 6600, "source display stays bounded");
    assert.equal(
      excerpt.tabIndex,
      0,
      "long source text can be scrolled using the keyboard",
    );
    const requestsBeforeExpand = f.calls.length;
    f.$(".assistant-source summary").click();
    await settle();
    assert(f.$(".assistant-source").open);
    assert.equal(
      f.calls.length,
      requestsBeforeExpand,
      "opening evidence never fetches or scans",
    );
    assert.equal(
      f.palette.root.querySelectorAll(".assistant-source").length,
      1,
      "sources without excerpts remain readable without empty expanders",
    );
    assert(
      f
        .$(".assistant-transcript details")
        .textContent.includes("Stored RAM measurement"),
    );
    assert(
      f
        .$(".assistant-feedback")
        .textContent.includes("No scans or database changes"),
    );
    for (let i = 1; i < 6; i++) {
      f.query("ask: Follow up " + i);
      f.enter();
      await settle();
      const history = JSON.parse(f.pending[i].options.body).history;
      assert(history.length <= 4);
      assert(history.every((message) => message.content.length <= 800));
      f.answer(
        i,
        i === 1
          ? "Detailed answer. ".repeat(200)
          : "Read the existing measurements.",
      );
      await settle();
    }
    assert.equal(
      f.$(".assistant-transcript").children.length,
      8,
      "visible history stays bounded",
    );
    f.query("ask: A pending question");
    f.enter();
    await settle();
    const cancelled = f.pending[6];
    f.palette.close();
    assert(cancelled.options.signal.aborted, "closing cancels the request");
    f.answer(6, "OBSOLETE ANSWER");
    await settle();
    assert(
      !f.$(".assistant-transcript").textContent.includes("OBSOLETE ANSWER"),
    );
    await f.palette.open("ask: ");
    await settle();
    f.query("ask: Old target");
    f.enter();
    await settle();
    f.context({ machine: "PC-2", user_key: "id:2" });
    f.palette.refreshContext();
    assert(
      f.pending[7].options.signal.aborted,
      "target changes immediately cancel an in-flight answer",
    );
    f.answer(7, "WRONG TARGET");
    await settle();
    assert.equal(f.$(".assistant-transcript").children.length, 0);
    assert(!f.$(".assistant-include input").checked);
    assert(
      f.$(".assistant-feedback").textContent.includes("Selection changed"),
    );
    f.query("ask: New target");
    f.enter();
    await settle();
    assert.equal(JSON.parse(f.pending[8].options.body).machine, "PC-2");
    assert.deepEqual(JSON.parse(f.pending[8].options.body).history, []);
    assert(!("scan_report" in JSON.parse(f.pending[8].options.body)));
    f.answer(8, "", { detail: "Offline model could not load." }, false);
    await settle();
    assert(f.$(".assistant-feedback").textContent.includes("could not load"));
    assert(
      !f.$("[data-assistant-ask]").disabled,
      "errors allow an explicit retry",
    );
    f.$("[data-assistant-clear]").click();
    assert.equal(f.$(".assistant-transcript").children.length, 0);
    assert(f.$(".assistant-feedback").textContent.includes("page's memory"));
    f.$("[data-assistant-back]").click();
    assert(!f.$("[role=listbox]").hidden);
    assert.equal(f.$("#atlas-command-input").getAttribute("role"), "combobox");
    assert.equal(
      f.$("#atlas-command-input").getAttribute("aria-controls"),
      "atlas-command-results",
    );
    assert.equal(
      f.$("#atlas-command-input").getAttribute("aria-describedby"),
      null,
    );
    f.available(false);
    f.query("ask: help");
    await settle();
    assert(f.$("[data-assistant-ask]").disabled);
    assert(
      f
        .$(".assistant-model")
        .textContent.includes("Install_Atlas_Assistant.bat"),
    );
    f.enter();
    await settle();
    assert.equal(f.pending.length, 9);
    f.palette.close();
    f.available(true);
    await f.palette.open("ask: ");
    await settle();
    f.query("ask: " + "x".repeat(1601));
    f.enter();
    await settle();
    assert.equal(f.pending.length, 9);
    assert(f.$(".assistant-feedback").textContent.includes("1,600"));
    f.query("ask: Explicit retry");
    f.enter();
    await settle();
    f.palette.dialog.dispatchEvent(new f.w.Event("cancel"));
    assert(
      f.pending[9].options.signal.aborted,
      "native Escape/cancel aborts inference",
    );
    f.palette.close();
    f.answer(9, "ESCAPED ANSWER");
    await settle();
    assert(
      !f.$(".assistant-transcript").textContent.includes("ESCAPED ANSWER"),
    );
    assert(
      f.calls.every((c) =>
        [
          "/api/assistant/status",
          "/api/assistant/ask",
          "/api/session",
        ].includes(c.url),
      ),
      "no scan, remote administration, or mutation endpoint can be called",
    );
    f.w.close();
  }
  // Exercise the real Console callback, including its independent Remote Admin field.
  const consoleCalls = [],
    consoleQuestions = [];
  const consoleUi = await consoleFixture({
    fetch: async (url, options = {}) => {
      consoleCalls.push(url);
      const reply = (data) => ({
        ok: true,
        status: 200,
        json: async () => data,
        headers: { get: () => null },
      });
      if (url === "/api/assistant/status")
        return reply({ available: true, model: "Fixture" });
      if (url === "/api/assistant/ask") {
        consoleQuestions.push(JSON.parse(options.body));
        return reply({ answer: "Saved fixture evidence.", sources: [] });
      }
      if (url === "/api/session") return reply({ token: "fixture-token" });
      if (url === "/api/palette/desks") return reply({ records: [] });
      if (url === "/api/health")
        return reply({
          identity: "Fixture",
          version: "test",
          users: 0,
          machines: 0,
        });
      return reply({
        users: [],
        machines: [],
        items: [],
        deployments: [],
        available: false,
      });
    },
  });
  await consoleUi.console();
  await consoleUi.run("sharedPaletteReady");
  await settle();
  consoleUi.run(
    "S.user={id:17,canonical_key:'uid:fixture-alice',name:'Alice Fixture'};setTarget('PC-A')",
  );
  async function askConsole() {
    await consoleUi.run(
      "sharedPalette.open('ask: Which saved machine is selected?')",
    );
    await settle();
    consoleUi.run(
      "sharedPalette.root.querySelector('[data-assistant-ask]').click()",
    );
    await settle();
    consoleUi.run("sharedPalette.close()");
  }
  await askConsole();
  assert.equal(consoleQuestions[0].machine, "PC-A");
  assert.equal(consoleQuestions[0].user_key, "uid:fixture-alice");
  const adminInput = consoleUi.w.document.querySelector("#adminPc");
  adminInput.value = "PC-B";
  adminInput.dispatchEvent(new consoleUi.w.Event("input", { bubbles: true }));
  await askConsole();
  assert.equal(consoleQuestions[1].machine, "PC-B");
  assert(
    !("user_key" in consoleQuestions[1]),
    "an independently entered machine must not inherit the workspace user",
  );
  assert.deepEqual(
    consoleQuestions[1].history,
    [],
    "a changed Remote Admin machine clears old conversation",
  );
  assert(!("scan_report" in consoleQuestions[1]));
  assert(
    !consoleCalls.some((url) =>
      /^\/api\/(machine-health|performance)\//.test(url),
    ),
    "opening Ask and changing targets do not start remote scans",
  );
  assert.equal(consoleUi.errors.length, 0, consoleUi.errors.join("\n"));
  consoleUi.w.close();
  const demo = await fixture({ readOnly: true });
  await demo.palette.open();
  assert(!demo.$("[role=listbox]").textContent.includes("Ask Atlas"));
  assert.equal(demo.$(".palette-assistant"), null);
  demo.query("ask: Explain");
  demo.enter();
  await settle();
  assert.equal(demo.calls.length, 0, "demo cannot contact assistant or scans");
  assert(demo.$("#atlas-command-status").textContent.includes("admin version"));
  demo.w.close();
  console.log(
    "PASS: explicit assistant button/Enter, no automatic inference or scans, authenticated shared/fallback transport, text-only answers and evidence, bounded history, stale-target isolation, cancellation, missing-model/error handling and demo exclusion.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
