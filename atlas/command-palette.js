import { COMMANDS } from "./command-registry.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const normalize = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export function installCommandPalette({
  getRecords,
  onSelect,
  toast,
  runCommand,
  openPerson,
  openMachine,
  prepare,
  triggerParent,
  replaceTrigger,
  readOnly = false,
  preferPersonDetails = false,
  getAssistantContext = () => ({}),
}) {
  const mount = document.createElement("span");
  mount.className = "atlas-palette-mount";
  if (replaceTrigger) replaceTrigger.replaceWith(mount);
  else triggerParent.prepend(mount);
  const root = mount.attachShadow({ mode: "open" });
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  sheet.href = "/command-palette.css?v=73";
  root.append(sheet);
  const trigger = document.createElement("button");
  trigger.id = "atlas-commands";
  trigger.innerHTML = "Search Atlas <kbd>Ctrl K</kbd>";
  trigger.setAttribute("aria-label", "Search Atlas commands (Ctrl+K)");
  root.append(trigger);
  const assistantTrigger = document.createElement("button");
  if (!readOnly) {
    assistantTrigger.id = "atlas-ask";
    assistantTrigger.type = "button";
    assistantTrigger.textContent = "Ask Atlas";
    assistantTrigger.setAttribute(
      "aria-label",
      "Ask Atlas about IT or using Atlas",
    );
    root.append(assistantTrigger);
  }
  const dialog = document.createElement("dialog");
  dialog.className = "atlas-palette";
  dialog.setAttribute("aria-label", "Search Atlas");
  dialog.innerHTML =
    '<div class="palette-input-row"><span aria-hidden="true">⌕</span><input id="atlas-command-input" placeholder="Search people, machines, desks or actions…" aria-label="Search people, machines, desks or actions" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="atlas-command-results" autocomplete="off"><button class="palette-close" aria-label="Close search">Esc</button></div><div id="atlas-command-status" role="status" aria-live="polite"></div><div id="atlas-command-results" role="listbox" aria-label="Atlas search results"></div><footer><span>↑ ↓ Navigate · Enter Open · Esc Close</span><span>Try person:, machine:, serial:, asset:, team:, location: or &gt; for actions</span></footer>';
  root.append(dialog);
  const input = dialog.querySelector("input"),
    list = dialog.querySelector("[role=listbox]"),
    status = dialog.querySelector("[role=status]");
  const searchPlaceholder = input.placeholder;
  const footer = dialog.querySelector("footer");
  if (!readOnly)
    footer.lastElementChild.textContent += " · ask: for the offline assistant";
  const searchHint = footer.innerHTML;
  const assistant = document.createElement("section");
  assistant.className = "palette-assistant";
  assistant.hidden = true;
  if (!readOnly) {
    assistant.setAttribute("aria-label", "Offline Atlas assistant");
    assistant.innerHTML =
      '<div class="assistant-heading"><strong>Ask Atlas</strong><span>Local · Offline</span></div><p id="atlas-assistant-policy" class="assistant-policy">Ask about IT, troubleshooting or how to use Atlas. Saved records and scan results are optional context. Manual scans only: the assistant cannot start scans, run actions or change the database.</p><p class="assistant-model" role="status" aria-live="polite"></p><p class="assistant-context"></p><div class="assistant-examples" role="group" aria-label="Example questions"><button type="button" data-assistant-example>Explain DNS</button><button type="button" data-assistant-example>How do I deploy a package?</button><button type="button" data-assistant-example>Troubleshoot a Windows share</button></div><label class="assistant-include"><input type="checkbox"> Include existing slowness results</label><div class="assistant-transcript" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions" tabindex="0"></div><p class="assistant-feedback" role="status" aria-live="polite"></p><div class="assistant-controls"><button type="button" data-assistant-back>Back to search</button><button type="button" data-assistant-clear>Clear conversation</button><button type="button" data-assistant-ask>Ask Atlas</button></div>';
    footer.before(assistant);
  }
  const assistantModel = assistant.querySelector(".assistant-model"),
    assistantContext = assistant.querySelector(".assistant-context"),
    transcript = assistant.querySelector(".assistant-transcript"),
    examples = assistant.querySelector(".assistant-examples"),
    feedback = assistant.querySelector(".assistant-feedback"),
    includeScan = assistant.querySelector('input[type="checkbox"]'),
    askButton = assistant.querySelector("[data-assistant-ask]");
  let assistantMode = false,
    assistantStatus = null,
    assistantController,
    assistantGeneration = 0,
    assistantInputVersion = 0,
    assistantReady = Promise.resolve(),
    assistantPending = false,
    conversation = [],
    contextKey = "",
    context = {};
  let rows = [],
    active = 0,
    generation = 0,
    timer,
    controller,
    previousFocus;
  const openConsole = (key, value) =>
    key === "person" ? openPerson(value) : openMachine(value);
  const actions = COMMANDS.filter((a) => !readOnly || a.viewer).map((a) => ({
    ...a,
    run: () => runCommand(a.id),
  }));
  function cancelAssistant() {
    assistantGeneration++;
    assistantController?.abort();
    assistantController = null;
    if (assistantPending && feedback)
      feedback.textContent = "Request cancelled. Ask again when ready.";
    assistantPending = false;
    if (askButton) updateAskButton();
  }
  function updateAskButton() {
    askButton.disabled = assistantPending || !assistantStatus?.available;
    askButton.textContent = assistantPending ? "Thinking…" : "Ask Atlas";
    includeScan.disabled = assistantPending || !context.scan_report;
    transcript.setAttribute("aria-busy", String(assistantPending));
  }
  function readContext() {
    const current = getAssistantContext() || {};
    return {
      machine: String(current.machine || "").slice(0, 64),
      user_key: String(current.user_key || "").slice(0, 180),
      scan_report: String(current.scan_report || "").slice(0, 6000),
    };
  }
  function keyFor(value) {
    return JSON.stringify([value.machine, value.user_key]);
  }
  function syncAssistantContext() {
    const current = readContext(),
      key = keyFor(current);
    if (contextKey && key !== contextKey) {
      if (assistantPending) cancelAssistant();
      conversation = [];
      transcript.replaceChildren();
      examples.hidden = false;
      includeScan.checked = false;
      feedback.textContent =
        "Selection changed. Conversation and scan selection cleared.";
    }
    contextKey = key;
    context = current;
    assistantContext.textContent = current.machine
      ? `Selected machine: ${current.machine}${current.user_key ? " · selected user included" : ""} · stored data only`
      : current.user_key
        ? "Selected user · stored data only"
        : "No machine or scan is required. You can also ask about a saved user or machine.";
    assistant.querySelector(".assistant-include").hidden = !current.scan_report;
    if (!current.scan_report) includeScan.checked = false;
    updateAskButton();
    return current;
  }
  async function assistantRequest(url, options = {}) {
    if (window.AtlasClient) return window.AtlasClient.request(url, options);
    const headers = { ...(options.headers || {}) };
    if (options.method === "POST") {
      const session = await fetch("/api/session", {
        signal: options.signal,
        cache: "no-store",
      });
      if (!session.ok) throw Error("Reload Atlas to establish a session.");
      headers["X-Atlas-Token"] = (await session.json()).token;
    }
    const response = await fetch(url, { ...options, headers });
    let data;
    try {
      data = await response.json();
    } catch {
      throw Error(`Assistant request failed (${response.status}).`);
    }
    if (!response.ok)
      throw Error(
        typeof data.detail === "string"
          ? data.detail
          : `Assistant request failed (${response.status}).`,
      );
    return data;
  }
  async function checkAssistant() {
    cancelAssistant();
    const request = assistantGeneration;
    assistantController = new AbortController();
    assistantStatus = null;
    assistantModel.textContent = "Checking local model availability…";
    updateAskButton();
    try {
      const data = await assistantRequest("/api/assistant/status", {
        signal: assistantController.signal,
      });
      if (request !== assistantGeneration || !dialog.open || !assistantMode)
        return;
      assistantStatus = data;
      assistantModel.textContent = data.available
        ? `${data.model || "Local model"} · ready when you ask`
        : [
            data.reason || "The offline model is not installed.",
            data.setup ||
              "Run Install_Atlas_Assistant.bat to prepare the offline assistant.",
          ]
            .filter(Boolean)
            .join(" ");
    } catch (error) {
      if (request !== assistantGeneration || error.name === "AbortError")
        return;
      assistantModel.textContent = error.message;
    } finally {
      if (request === assistantGeneration) updateAskButton();
    }
  }
  function showAssistant() {
    if (readOnly) {
      render(
        [],
        "The offline assistant is available in the admin version of Atlas.",
      );
      return;
    }
    const entering = !assistantMode;
    assistantMode = true;
    dialog.classList.add("assistant-open");
    dialog.setAttribute("aria-label", "Ask Atlas offline assistant");
    assistant.hidden = false;
    list.hidden = true;
    status.hidden = true;
    rows = [];
    input.removeAttribute("aria-activedescendant");
    input.setAttribute("role", "textbox");
    input.removeAttribute("aria-expanded");
    input.removeAttribute("aria-autocomplete");
    input.removeAttribute("aria-controls");
    input.setAttribute("aria-describedby", "atlas-assistant-policy");
    input.setAttribute("aria-label", "Ask the offline Atlas assistant");
    input.placeholder = "Ask any IT or Atlas question…";
    footer.textContent =
      "Enter or Ask Atlas sends your question · Esc cancels and closes · Answers can be incomplete; check the evidence.";
    syncAssistantContext();
    if (entering) assistantReady = checkAssistant();
  }
  function hideAssistant() {
    if (assistantMode) cancelAssistant();
    assistantMode = false;
    dialog.classList.remove("assistant-open");
    dialog.setAttribute("aria-label", "Search Atlas");
    assistant.hidden = true;
    list.hidden = false;
    status.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", "atlas-command-results");
    input.removeAttribute("aria-describedby");
    input.placeholder = searchPlaceholder;
    input.setAttribute(
      "aria-label",
      "Search people, machines, desks or actions",
    );
    footer.innerHTML = searchHint;
  }
  function addMessage(role, content, data = {}) {
    const message = document.createElement("article"),
      heading = document.createElement("strong"),
      body = document.createElement("p");
    message.className = "assistant-message assistant-" + role;
    heading.textContent = role === "user" ? "You" : "Atlas";
    body.textContent = content;
    message.append(heading, body);
    if (Array.isArray(data.sources) && data.sources.length) {
      const evidence = document.createElement("details"),
        summary = document.createElement("summary");
      summary.textContent = "Source evidence";
      evidence.append(summary);
      for (const source of data.sources.slice(0, 12)) {
        if (!source || typeof source !== "object") continue;
        const item = document.createElement("p");
        item.textContent = [source.label, source.detail]
          .filter(Boolean)
          .join(" · ");
        evidence.append(item);
        if (typeof source.excerpt === "string" && source.excerpt.trim()) {
          const facts = document.createElement("details"),
            toggle = document.createElement("summary"),
            excerpt = document.createElement("pre");
          facts.className = "assistant-source";
          toggle.textContent = "View supplied facts";
          toggle.setAttribute(
            "aria-label",
            "View supplied facts for " + (source.label || "this source"),
          );
          excerpt.className = "assistant-source-excerpt";
          excerpt.tabIndex = 0;
          excerpt.setAttribute("role", "region");
          excerpt.setAttribute("aria-label", "Supplied source facts");
          excerpt.textContent =
            source.excerpt.slice(0, 6500) +
            (source.excerpt.length > 6500
              ? "\n[Displayed excerpt shortened]"
              : "");
          facts.append(toggle, excerpt);
          evidence.append(facts);
        }
      }
      message.append(evidence);
    }
    if (data.context_note) {
      const note = document.createElement("small");
      note.textContent = data.context_note;
      message.append(note);
    }
    transcript.append(message);
    examples.hidden = true;
    while (transcript.children.length > 8)
      transcript.firstElementChild.remove();
    transcript.scrollTop = transcript.scrollHeight;
  }
  async function askAssistant() {
    if (readOnly || !assistantMode || assistantPending) return;
    const current = syncAssistantContext(),
      question = input.value.replace(/^\s*ask:\s*/i, "").trim();
    if (!question) {
      feedback.textContent =
        "Type an IT or Atlas question, then choose Ask Atlas.";
      input.focus();
      return;
    }
    if (question.length > 1600) {
      feedback.textContent = "Keep the question within 1,600 characters.";
      return;
    }
    if (!assistantStatus?.available) return;
    cancelAssistant();
    const request = assistantGeneration,
      selectedKey = contextKey;
    assistantController = new AbortController();
    assistantPending = true;
    feedback.textContent =
      "Generating locally. No machine scans are being started.";
    updateAskButton();
    addMessage("user", question);
    const payload = {
      question,
      history: conversation.slice(-4),
      ...(current.machine ? { machine: current.machine } : {}),
      ...(current.user_key ? { user_key: current.user_key } : {}),
      ...(includeScan.checked && current.scan_report
        ? { scan_report: current.scan_report }
        : {}),
    };
    try {
      const data = await assistantRequest("/api/assistant/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: assistantController.signal,
      });
      if (request !== assistantGeneration || !dialog.open || !assistantMode)
        return;
      if (keyFor(readContext()) !== selectedKey) {
        syncAssistantContext();
        return;
      }
      const answer = String(
        data.answer || "No answer was returned. Try a more specific question.",
      ).slice(0, 16000);
      addMessage("assistant", answer, data);
      conversation = [
        ...conversation,
        { role: "user", content: question.slice(0, 800) },
        { role: "assistant", content: answer.slice(0, 800) },
      ].slice(-4);
      feedback.textContent =
        "Answer ready · No scans or database changes performed.";
      if (input.value.replace(/^\s*ask:\s*/i, "").trim() === question)
        input.value = "";
    } catch (error) {
      if (request === assistantGeneration && error.name !== "AbortError")
        feedback.textContent = error.message;
    } finally {
      if (request === assistantGeneration) {
        assistantPending = false;
        updateAskButton();
      }
    }
  }
  if (!readOnly) {
    askButton.onclick = askAssistant;
    assistant.querySelector("[data-assistant-back]").onclick = () => {
      input.value = "";
      search();
      input.focus();
    };
    assistant.querySelector("[data-assistant-clear]").onclick = () => {
      assistantInputVersion++;
      if (assistantPending) cancelAssistant();
      conversation = [];
      transcript.replaceChildren();
      examples.hidden = false;
      includeScan.checked = false;
      feedback.textContent =
        "Conversation cleared. It is kept only in this page's memory.";
    };
    for (const button of assistant.querySelectorAll("[data-assistant-example]"))
      button.onclick = () => {
        assistantInputVersion++;
        input.value = button.textContent;
        input.focus();
      };
    document.addEventListener("input", () => {
      if (dialog.open && assistantMode) syncAssistantContext();
    });
    window.addEventListener("pagehide", cancelAssistant);
  }
  function invalidate() {
    generation++;
    clearTimeout(timer);
    controller?.abort();
  }
  function close() {
    invalidate();
    cancelAssistant();
    dialog.close();
  }
  function setActive(index) {
    active = rows.length ? (index + rows.length) % rows.length : 0;
    [...list.children].forEach((node, i) => {
      node.setAttribute("aria-selected", String(i === active));
      node.classList.toggle("selected", i === active);
    });
    if (rows.length) {
      input.setAttribute("aria-activedescendant", "atlas-command-" + active);
      list.children[active]?.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }
  function render(items, message) {
    rows = items;
    active = 0;
    list.innerHTML = rows
      .map(
        (r, i) =>
          `<div id="atlas-command-${i}" class="palette-result" role="option" aria-selected="false" data-index="${i}"><span class="palette-kind">${esc(r.kind)}</span><span><strong>${esc(r.title)}</strong><small>${esc(r.detail)}</small></span><span aria-hidden="true">${esc(r.shortcut || "↵")}</span></div>`,
      )
      .join("");
    status.textContent =
      message ||
      (!rows.length
        ? "No matches. Try a name, account, hostname or desk number."
        : `${rows.length} results`);
    setActive(0);
  }
  async function choose(index) {
    const row = rows[index];
    if (!row) return;
    if (row.id === "assistant" || row.id === "assistant-question") {
      assistantInputVersion++;
      input.value = "ask: " + (row.question || "");
      search();
      input.focus();
      if (row.question) {
        // Choosing this question is the explicit submit action. Editing, closing
        // or changing the selection while availability loads cancels that intent.
        const request = assistantGeneration,
          inputVersion = assistantInputVersion,
          selectedKey = keyFor(readContext());
        await assistantReady;
        if (
          dialog.open &&
          assistantMode &&
          request === assistantGeneration &&
          inputVersion === assistantInputVersion &&
          selectedKey === keyFor(readContext()) &&
          input.value.trim() === row.question
        )
          await askAssistant();
      }
      return;
    }
    if (row.person) {
      if (preferPersonDetails) {
        close();
        try {
          await openPerson(row.person);
        } catch (e) {
          toast(e.message);
        }
        return;
      }
      invalidate();
      const request = generation;
      status.textContent = "Finding mapped desks…";
      controller = new AbortController();
      try {
        const response = await fetch(
          "/api/palette/person/" + encodeURIComponent(row.person),
          { signal: controller.signal },
        );
        if (!response.ok)
          throw Error("Could not resolve this person. Try again.");
        const data = await response.json();
        if (request !== generation || !dialog.open) return;
        const desks = data.desks.filter((d) =>
          getRecords().some((r) => r.id === d.id),
        );
        if (desks.length === 1) {
          close();
          onSelect(desks[0].id);
          if (desks[0].match !== "confirmed account link")
            toast("Desk matched by name; account link is not confirmed.");
          return;
        }
        if (!desks.length) {
          close();
          await openConsole("person", row.person);
          return;
        }
        render(
          desks
            .map((d) => ({
              kind: "Desk",
              title: d.id,
              detail: `${row.title} · Floor ${d.floor} · ${d.match}`,
              run: () => onSelect(d.id),
            }))
            .concat({
              kind: "Person",
              title: "Open person details",
              detail: row.title,
              run: () => openConsole("person", row.person),
            }),
          "Multiple desk matches — choose a location.",
        );
      } catch (e) {
        if (e.name !== "AbortError" && request === generation)
          status.textContent = e.message;
      }
    } else {
      close();
      try {
        await row.run();
      } catch (e) {
        toast(e.message);
      }
    }
  }
  function search() {
    invalidate();
    const request = generation,
      raw = input.value.trim();
    if (/^ask:/i.test(raw)) {
      input.value = raw.replace(/^ask:\s*/i, "");
      showAssistant();
      return;
    }
    hideAssistant();
    const prefix = raw.match(/^(person|user|machine|desk|action):\s*/i);
    const kind = raw.startsWith(">") ? "action" : prefix?.[1]?.toLowerCase();
    const term = raw.startsWith(">")
      ? raw.slice(1).trim()
      : prefix
        ? raw.slice(prefix[0].length).trim()
        : raw;
    const q = normalize(term),
      words = q.split(/\s+/).filter(Boolean);
    const question =
      !readOnly &&
      !kind &&
      !/^[\w-]+:/.test(raw) &&
      raw.length >= 3 &&
      raw.length <= 1600 &&
      (/\?$/.test(raw) ||
        /^(how|why|what|when|where|which|who|can|could|should|would|is|are|does|do|help|explain|tell|troubleshoot|diagnose)\b.+\S/i.test(
          raw,
        ) ||
        (words.length >= 2 &&
          /\b(excel|outlook|windows|citrix|vpn|network|dns|cpu|memory|ram|disk|printer|powershell|atlas|deployment)\b/i.test(
            raw,
          )))
        ? [
            {
              id: "assistant-question",
              kind: "Ask Atlas",
              title: `Ask Atlas about “${raw.length > 120 ? raw.slice(0, 120) + "…" : raw}”`,
              detail:
                "Send this question to the offline IT assistant. No scans or actions are run.",
              question: raw,
            },
          ]
        : [];
    const matches = (text) => words.every((w) => normalize(text).includes(w));
    const local = [];
    if (!kind || kind === "action")
      local.push(...actions.filter((a) => matches(a.title + " " + a.keywords)));
    if (q && (!kind || kind === "desk"))
      local.push(
        ...getRecords()
          .filter((r) => matches([r.id, r.name, r.team, r.hostname].join(" ")))
          .sort(
            (a, b) =>
              (normalize(b.id) === q) - (normalize(a.id) === q) ||
              a.name.localeCompare(b.name),
          )
          .slice(0, 12)
          .map((r) => ({
            kind: "Desk",
            title: r.name === "Unconfirmed desk" ? r.id : r.name,
            detail: `${r.id} · Floor ${r.floor} · ${r.team}`,
            run: () => onSelect(r.id),
          })),
      );
    const remote = q.length >= 2 && kind !== "desk" && kind !== "action";
    render(
      // Keep Enter from opening a desk while a console name lookup is pending.
      remote && preferPersonDetails
        ? local.filter((row) => row.kind !== "Desk")
        : local,
      remote
        ? "Searching directory…"
        : q.length === 1 &&
            (!kind || ["user", "person", "machine"].includes(kind))
          ? "Type at least two characters for directory search."
          : "",
    );
    if (!remote) return;
    timer = setTimeout(async () => {
      controller = new AbortController();
      try {
        const query =
          (kind === "person" || kind === "user"
            ? "user:"
            : kind === "machine"
              ? "machine:"
              : "") + term;
        const response = await fetch(
          "/api/search?" + new URLSearchParams({ term: query }),
          { signal: controller.signal },
        );
        if (!response.ok)
          throw Error(
            "Directory unavailable. Map and action results are still available.",
          );
        const data = await response.json();
        if (request !== generation || !dialog.open) return;
        const people = data.users.slice(0, 10).map((u) => ({
          kind: "Person",
          title: u.full_name || u.name,
          detail: [u.user_name, u.email, u.location]
            .filter(Boolean)
            .join(" · "),
          person: "id:" + u.id,
        }));
        const machines = data.machines.slice(0, 10).map((m) => ({
          kind: "Machine",
          title: m.name,
          detail: [m.model_id, m.operational_status]
            .filter(Boolean)
            .join(" · "),
          run: () => openConsole("machine", m.name),
        }));
        render(
          preferPersonDetails
            ? [...people, ...machines, ...local, ...question]
            : [...local, ...people, ...machines, ...question],
          data.users.length > 10 || data.machines.length > 10
            ? "Showing the first directory matches. Refine your search for more."
            : "",
        );
      } catch (e) {
        if (e.name !== "AbortError" && request === generation && dialog.open)
          render([...local, ...question], e.message);
      }
    }, 180);
  }
  async function open(query = "", sourceDialog = null) {
    if (dialog.open) {
      if (typeof query === "string" && query) {
        assistantInputVersion++;
        input.value = query;
        search();
      }
      input.focus();
      return;
    }
    // Do not interrupt an existing edit/confirmation dialog.
    if (
      [...document.querySelectorAll("dialog[open]")].some(
        (existing) => existing !== sourceDialog,
      )
    )
      return;
    previousFocus =
      document.activeElement?.shadowRoot?.activeElement ||
      document.activeElement;
    dialog.showModal();
    assistantInputVersion++;
    input.value = typeof query === "string" ? query : "";
    search();
    input.focus();
    if (prepare) {
      try {
        await prepare();
        if (dialog.open && !assistantMode) search();
      } catch {
        if (dialog.open)
          status.textContent =
            "Map records unavailable. Directory and commands are still available.";
      }
    }
  }
  trigger.onclick = open;
  if (!readOnly) assistantTrigger.onclick = () => open("ask: ");
  input.oninput = () => {
    assistantInputVersion++;
    if (assistantMode) syncAssistantContext();
    else search();
  };
  dialog.querySelector(".palette-close").onclick = close;
  dialog.addEventListener("close", () => {
    invalidate();
    cancelAssistant();
    assistantMode = false;
    previousFocus?.focus();
  });
  dialog.addEventListener("cancel", () => {
    invalidate();
    cancelAssistant();
  });
  dialog.addEventListener("click", (e) => {
    const option = e.target.closest("[data-index]");
    if (option) choose(+option.dataset.index);
    else if (e.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (
        e.clientX < box.left ||
        e.clientX > box.right ||
        e.clientY < box.top ||
        e.clientY > box.bottom
      )
        close();
    }
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (assistantMode) {
      if (e.key === "Enter" && e.target === input) {
        e.preventDefault();
        askAssistant();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" && e.target === input) {
      e.preventDefault();
      choose(active);
    }
  });
  root.addEventListener("keydown", (e) => {
    if (dialog.open) e.stopPropagation();
  });
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      open();
    }
  });
  window.addEventListener("atlas-directory-search", (event) => {
    const person = event.target.closest?.(".atlas-person"),
      query = event.detail?.query;
    if (!person || typeof query !== "string" || !query.trim()) return;
    open(query, person.closest(".viewer-lookup-dialog"));
  });
  return {
    open,
    close,
    dialog,
    root,
    refreshContext: () => {
      if (!readOnly && assistantMode) syncAssistantContext();
    },
  };
}
