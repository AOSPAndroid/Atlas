/* Knowledge Base articles: Markdown runbooks with live preview, tags, issue categories and
   Mermaid diagrams, plus "search everything" across articles, diagrams, Live Inbox requests and
   deployments. Draw.io diagrams stay available under the Diagrams tab. Markdown is rendered with
   marked and sanitised with DOMPurify; Mermaid loads only for articles that contain a diagram. */
(() => {
  const root = () => document.getElementById("knowledge");
  const meta = document.querySelector('meta[name="atlas-kb-assets"]');
  if (!root() || !meta || !window.AtlasKnowledge) return;
  const assets = meta.content.split(/\s+/).filter(Boolean);
  const asset = (name) => assets.find((url) => url.includes("/" + name + "-"));
  const readonly = () => !!window.AtlasReadOnly;
  const MODE_KEY = "atlas.kb.mode";
  const state = { articles: [], categories: [], current: null, editing: false, tag: "", query: "", everything: false, serial: 0 };
  const loaded = {};
  let ui = null, mermaidId = 0, searchTimer = 0, previewTimer = 0;

  const TEMPLATES = [
    ["Software install request", ["software"], [], "## When to use\nA user asks for an application to be installed.\n\n## Steps\n1. Check the request is approved.\n2. Find the package in **Packages** and confirm the Install script.\n3. Deploy from **Live Inbox → Install…** or add it to the queue.\n4. Ask the user to restart the application.\n\n## Notes\n- "],
    ["Slow or freezing PC", ["performance"], ["slow"], "## Checks\n- [ ] Health check: disk space and uptime\n- [ ] Performance scan: top CPU and memory processes\n- [ ] Pending reboot?\n\n## Fix\n1. \n\n## Escalate when\n- "],
    ["Outlook problem", ["outlook", "email"], ["outlook"], "## Symptoms\n- \n\n## Fix\n1. Close Outlook.\n2. Start it once with `outlook.exe /safe`.\n3. \n\n## Escalate when\n- "],
    ["VPN or network", ["network", "vpn"], ["network"], "## Checks\n- [ ] Machine replies to ping\n- [ ] VPN group in **Machine's AD groups**\n\n## Fix\n1. \n\n```mermaid\nflowchart TD\n  A[User cannot connect] --> B{Ping OK?}\n  B -->|Yes| C[Check VPN group]\n  B -->|No| D[Check network cable / Wi-Fi]\n```\n"],
    ["Printer", ["printing"], ["printer"], "## Checks\n- [ ] Printer queue\n- [ ] User's AD printer groups\n\n## Fix\n1. "],
    ["Locked account or password", ["account"], ["account"], "## Checks\n- [ ] **User's AD groups** → Account health: locked out? password expired?\n\n## Fix\n1. "],
    ["Blank article", [], [], ""],
  ];

  function load(url) {
    return (loaded[url] ||= new Promise((resolve, reject) => {
      const script = Object.assign(document.createElement("script"), { src: url });
      script.onload = resolve;
      script.onerror = () => { delete loaded[url]; reject(Error("Could not load " + url)); };
      document.head.append(script);
    }));
  }
  const markdownReady = () => window.marked && window.DOMPurify ? Promise.resolve()
    : Promise.all([load(asset("marked")), load(asset("dompurify"))]);
  async function mermaidReady() {
    if (!window.mermaid) await load(asset("mermaid"));
    if (!mermaidReady.done) {
      // Plain SVG text labels (no embedded HTML), so the sanitiser keeps them.
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", htmlLabels: false, flowchart: { htmlLabels: false } });
      mermaidReady.done = true;
    }
  }

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) if (child != null) node.append(child);
    return node;
  };
  const button = (label, onclick, extra = {}) => el("button", { type: "button", textContent: label, onclick, ...extra });
  // Search highlights arrive as \u0002…\u0003 markers; build <mark> elements instead of parsing HTML.
  function marked_(text) {
    const span = el("span");
    String(text || "").split(/(\u0002[^\u0003]*\u0003)/).forEach((part) => {
      if (part.startsWith("\u0002")) span.append(el("mark", { textContent: part.slice(1, -1) }));
      else if (part) span.append(document.createTextNode(part));
    });
    return span;
  }
  const date = (value) => value ? new Date(value).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "";
  const label = (id) => state.categories.find((c) => c.id === id)?.label || id;
  const api = (url, options) => window.AtlasClient.request(url, options);
  const slug = (title) => (String(title).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").slice(0, 60) || "article") + "-" + Date.now().toString(36);

  async function render(markdown, target) {
    await markdownReady();
    target.innerHTML = window.DOMPurify.sanitize(window.marked.parse(String(markdown || ""), { gfm: true }));
    for (const link of target.querySelectorAll("a[href]")) Object.assign(link, { target: "_blank", rel: "noopener noreferrer" });
    const blocks = [...target.querySelectorAll("pre > code.language-mermaid")];
    if (!blocks.length) return;
    try { await mermaidReady(); }
    catch { blocks.forEach((code) => code.parentElement.before(el("p", { className: "kb-note", textContent: "Diagram viewer unavailable; showing its text." }))); return; }
    for (const code of blocks) {
      try {
        const { svg } = await window.mermaid.render("kb-mermaid-" + ++mermaidId, code.textContent);
        const figure = el("div", { className: "kb-mermaid" });
        figure.innerHTML = window.DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
        if (code.isConnected) code.parentElement.replaceWith(figure);
      } catch (error) {
        code.parentElement.before(el("p", { className: "kb-note", textContent: "Diagram error: " + String(error.message || error).split("\n")[0] }));
      }
    }
  }

  function setMode(mode) {
    root().dataset.kbMode = mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch {}
    ui?.tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.mode === mode)));
    if (mode === "diagrams") window.dispatchEvent(new Event("resize"));
  }

  function install() {
    const host = root();
    if (!host || host.querySelector(".kb-articles")) return;
    const tabs = [button("Articles", () => setMode("articles")), button("Diagrams", () => setMode("diagrams"))];
    tabs[0].dataset.mode = "articles"; tabs[1].dataset.mode = "diagrams";
    tabs.forEach((tab) => tab.setAttribute("role", "tab"));
    const bar = el("div", { className: "kb-modes", role: "tablist" }, ...tabs);
    bar.setAttribute("aria-label", "Knowledge Base views");
    const search = el("input", { type: "search", placeholder: "Search articles…", maxLength: 300 });
    search.setAttribute("aria-label", "Search the Knowledge Base");
    const everything = el("input", { type: "checkbox" });
    const scope = el("label", { className: "kb-scope", title: "Also search past Live Inbox requests, deployments and diagrams" }, everything, " Everything");
    const templates = el("select");
    templates.setAttribute("aria-label", "New article from template");
    templates.append(el("option", { value: "", textContent: "New article…" }), ...TEMPLATES.map(([name], i) => el("option", { value: String(i), textContent: name })));
    if (window.AtlasAssistant && !readonly()) templates.append(el("option", { value: "assistant", textContent: "Draft from notes with the Assistant…" }),
      el("option", { value: "import", textContent: "Import knowledge from folders…" }));
    templates.disabled = readonly();
    const tagsBox = el("div", { className: "kb-tag-filter" });
    const drafts = button("", () => reviewQueue(), { className: "kb-drafts-button", hidden: true });
    const list = el("ul", { className: "kb-article-results" });
    list.setAttribute("aria-label", "Articles");
    const status = el("p", { className: "kb-note", role: "status" });
    const view = el("article", { className: "kb-article-view" });
    view.setAttribute("aria-live", "polite");
    const aside = el("aside", { className: "kb-article-list" }, el("div", { className: "kb-article-search" }, search, scope), templates, drafts, tagsBox, status, list);
    const section = el("section", { className: "kb-articles" }, aside, view);
    host.prepend(bar, section);
    ui = { tabs, search, everything, templates, tagsBox, list, status, view, drafts };
    search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = search.value.trim(); refreshList(); }, 200); });
    everything.onchange = () => { state.everything = everything.checked; search.placeholder = everything.checked ? "Search articles, requests, deployments, notes…" : "Search articles…"; refreshList(); };
    templates.onchange = () => {
      if (templates.value === "assistant") { templates.value = ""; return draftFromNotes(); }
      if (templates.value === "import") { templates.value = ""; return importView(); }
      const t = TEMPLATES[Number(templates.value)]; templates.value = ""; if (t) edit({ title: t[0] === "Blank article" ? "" : t[0], tags: t[1], categories: t[2], markdown: t[3], revision: 0 }, true);
    };
    let mode = "articles";
    try { mode = localStorage.getItem(MODE_KEY) || "articles"; } catch {}
    setMode(mode);
    if (readonly()) {
      view.replaceChildren(el("p", { className: "kb-note", textContent: "Articles are stored in Atlas Admin. Use the Diagrams tab for local drafts here." }));
      return;
    }
    refresh();
  }

  async function refresh(select) {
    try {
      const [{ articles }, { categories }] = await Promise.all([api("/api/knowledge/articles"), state.categories.length ? { categories: state.categories } : api("/api/knowledge/article-categories")]);
      state.articles = articles || []; state.categories = categories || [];
    } catch (error) { ui.status.textContent = error.message; return; }
    renderTags(); refreshList(); refreshDrafts();
    if (select) open(select);
    else if (!state.current && !state.editing) welcome();
  }

  function welcome() {
    ui.view.replaceChildren(el("div", { className: "kb-welcome" },
      el("h2", { textContent: "Knowledge Base" }),
      el("p", { textContent: state.articles.length ? "Choose an article, search, or start a new one from a template." : "Write your first runbook: choose New article… and pick a template." }),
      el("p", { className: "kb-note", textContent: "Articles linked to an issue category are suggested automatically in Live Inbox for matching requests." })));
  }

  function renderTags() {
    const counts = {};
    for (const a of state.articles) for (const t of a.tags) counts[t] = (counts[t] || 0) + 1;
    const tags = Object.keys(counts).sort((a, b) => a.localeCompare(b));
    ui.tagsBox.replaceChildren(...tags.map((tag) => {
      const b = button(`${tag} ${counts[tag]}`, () => { state.tag = state.tag === tag ? "" : tag; renderTags(); refreshList(); });
      b.setAttribute("aria-pressed", String(state.tag === tag));
      return b;
    }));
  }

  async function refreshList() {
    const serial = ++state.serial;
    if (!state.query) {
      const shown = state.articles.filter((a) => !state.tag || a.tags.includes(state.tag));
      ui.status.textContent = `${shown.length} article${shown.length === 1 ? "" : "s"}${state.tag ? " tagged " + state.tag : ""}`;
      ui.list.replaceChildren(...shown.map((a) => item("article", a.id, a.title, a.excerpt, a.updated, a.tags)));
      return;
    }
    const kinds = state.everything ? "article,diagram,inbox,deployment,file" : "article";
    try {
      const { results } = await api(`/api/search-everything?q=${encodeURIComponent(state.query)}&kinds=${kinds}&limit=40`);
      if (serial !== state.serial) return;
      ui.status.textContent = `${results.length} result${results.length === 1 ? "" : "s"} for “${state.query}”`;
      ui.list.replaceChildren(...results.map((r) => item(r.kind, r.ref, r.title, r.snippet, r.at, r.extra?.tags || [], r)));
    } catch (error) { if (serial === state.serial) ui.status.textContent = error.message; }
  }

  const KIND = { article: "Article", diagram: "Diagram", inbox: "Request", deployment: "Deployment", file: "Note" };
  function item(kind, ref, title, text, at, tags, result) {
    const open_ = button("", () => openResult(kind, ref, result));
    open_.className = "kb-result";
    open_.append(el("span", { className: "kb-result-top" }, el("span", { className: "kb-kind kb-kind-" + kind, textContent: KIND[kind] }), el("strong", {}, marked_(title)), el("small", { textContent: date(at) })),
      el("span", { className: "kb-result-text" }, marked_(text)));
    if (tags?.length) open_.append(el("span", { className: "kb-result-tags", textContent: tags.join(" · ") }));
    if (kind === "article" && state.current?.id === ref) open_.setAttribute("aria-current", "true");
    return el("li", {}, open_);
  }

  function openResult(kind, ref, result) {
    if (kind === "article") return open(ref);
    if (kind === "diagram") { setMode("diagrams"); return original.show(ref); }
    if (kind === "inbox") { page("inbox"); return window.dispatchEvent(new CustomEvent("atlas:inbox-open", { detail: { id: Number(ref) } })); }
    if (kind === "file") return openFile(ref);
    const x = result?.extra || {};
    state.current = null;
    ui.view.replaceChildren(el("div", { className: "kb-deployment" },
      el("h2", {}, marked_(result?.title || "Deployment")),
      el("dl", {}, ...[["Machine", x.target], ["Package", x.package], ["Action", x.action], ["State", x.state], ["Started", result?.at], ["Finished", x.finished]]
        .flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: v || "—" })])),
      x.target && !readonly() ? button("Select this machine in Workspace", () => { page("workspace"); setTarget(x.target, "Knowledge Base search", false); }) : null));
  }

  async function open(id) {
    if (state.editing && !confirm("Discard the changes to this article?")) return;
    state.editing = false;
    let article;
    try { article = await api("/api/knowledge/articles/" + encodeURIComponent(id)); }
    catch (error) { ui.status.textContent = error.message; return; }
    state.current = article;
    const body = el("div", { className: "kb-markdown" });
    const actions = el("div", { className: "kb-article-actions" },
      button("Edit", () => edit(article)), button("Copy text", () => navigator.clipboard?.writeText(article.markdown).then(() => toast?.("Article copied"))),
      button("Delete", () => remove(article)));
    ui.view.replaceChildren(el("header", { className: "kb-article-head" },
      el("h2", { textContent: article.title }),
      el("p", { className: "kb-article-meta" },
        ...article.categories.map((c) => el("span", { className: "kb-category", textContent: label(c) })),
        ...article.tags.map((t) => el("span", { className: "kb-tag", textContent: t })),
        el("small", { textContent: "Updated " + date(article.updated) })), actions), body);
    refreshList();
    await render(article.markdown, body);
  }

  function edit(article, isNew = false, review = null) {
    state.editing = true;
    const draft = { ...article, id: article.id || null };
    const title = el("input", { value: draft.title || "", maxLength: 180, placeholder: "Article title", required: true });
    title.setAttribute("aria-label", "Article title");
    const tags = el("input", { value: (draft.tags || []).join(", "), placeholder: "Tags, separated by commas" });
    tags.setAttribute("aria-label", "Tags");
    const cats = el("fieldset", { className: "kb-categories" }, el("legend", { textContent: "Suggest in Live Inbox for" }),
      ...state.categories.map((c) => el("label", {}, el("input", { type: "checkbox", value: c.id, checked: (draft.categories || []).includes(c.id) }), " " + c.label)));
    const text = el("textarea", { value: draft.markdown || "", spellcheck: true, placeholder: "Write in Markdown: ## headings, - lists, 1. steps, `code`, ```mermaid diagrams" });
    text.setAttribute("aria-label", "Article text (Markdown)");
    const preview = el("div", { className: "kb-markdown kb-preview" });
    preview.setAttribute("aria-label", "Preview");
    const message = el("p", { className: "kb-note", role: "status" });
    const update = () => { clearTimeout(previewTimer); previewTimer = setTimeout(() => render(text.value, preview), 250); };
    text.addEventListener("input", update);
    const wrap = (before, after = before, placeholder = "text") => () => {
      const { selectionStart: s, selectionEnd: e, value } = text, chosen = value.slice(s, e) || placeholder;
      text.setRangeText(before + chosen + after, s, e, "end"); text.focus(); update();
    };
    const line = (prefix) => () => {
      const s = text.value.lastIndexOf("\n", text.selectionStart - 1) + 1;
      text.setRangeText(prefix, s, s, "end"); text.focus(); update();
    };
    const insert = (snippet) => () => { text.setRangeText(snippet, text.selectionStart, text.selectionEnd, "end"); text.focus(); update(); };
    const tools = el("div", { className: "kb-md-tools", role: "toolbar" },
      button("H2", line("## "), { title: "Heading" }), button("B", wrap("**"), { title: "Bold" }), button("I", wrap("_"), { title: "Italic" }),
      button("• List", line("- ")), button("1. Steps", line("1. ")), button("☐ Check", line("- [ ] ")), button("Code", wrap("`")),
      button("Table", insert("\n| Check | Result |\n| --- | --- |\n|  |  |\n")),
      button("Diagram", insert("\n```mermaid\nflowchart TD\n  A[Problem] --> B{Check}\n  B -->|Yes| C[Fix]\n  B -->|No| D[Escalate]\n```\n")),
      button("Link", wrap("[", "](https://)", "link text")));
    tools.setAttribute("aria-label", "Formatting");
    const save = async () => {
      const payload = { title: title.value.trim(), markdown: text.value, revision: draft.revision || 0,
        tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean),
        categories: [...cats.querySelectorAll("input:checked")].map((c) => c.value) };
      if (!payload.title) { message.textContent = "Give the article a title."; title.focus(); return; }
      if (review?.draftId) {  // an imported draft: publishing marks it done in the review queue
        try {
          const { article: id } = await post(`/api/knowledge/drafts/${review.draftId}/publish`, payload);
          state.editing = false; toast?.("Article published"); await refresh(id);
        } catch (error) { message.textContent = error.message; }
        return;
      }
      const id = draft.id || slug(payload.title);
      try {
        const saved = await api("/api/knowledge/articles/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        Object.assign(draft, payload, { id, revision: saved.revision });
        state.editing = false;
        toast?.("Article saved");
        await refresh(id);
      } catch (error) { message.textContent = error.message; }
    };
    const cancel = () => { state.editing = false; draft.id ? open(draft.id) : (state.current = null, welcome()); };
    const form = el("form", { className: "kb-article-editor", onsubmit: (e) => { e.preventDefault(); save(); } },
      el("div", { className: "kb-editor-fields" }, title, tags), cats, tools,
      el("div", { className: "kb-editor-split" }, text, preview),
      el("div", { className: "kb-article-actions" }, el("button", { type: "submit", className: "primary", textContent: review?.draftId ? "Publish" : isNew ? "Create article" : "Save" }), button("Cancel", cancel), message));
    form.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } });
    if (review) form.prepend(reviewPanel(review, text, update));
    ui.view.replaceChildren(form);
    update();
    (draft.title ? text : title).focus();
  }

  async function remove(article) {
    if (!confirm(`Delete the article “${article.title}”? This cannot be undone.`)) return;
    try {
      await api(`/api/knowledge/articles/${encodeURIComponent(article.id)}?revision=${article.revision}`, { method: "DELETE" });
      state.current = null; toast?.("Article deleted"); await refresh(); welcome();
    } catch (error) { ui.status.textContent = error.message; }
  }

  // Local Assistant: notes and files -> a draft article, checked line by line against the notes.
  const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function openFile(path) {
    if (state.editing && !confirm("Discard the changes to this article?")) return;
    state.editing = false; state.current = null;
    let file;
    try { file = await post("/api/assistant/file", { path }); }
    catch (error) { ui.status.textContent = error.message; return; }
    ui.view.replaceChildren(el("div", { className: "kb-file" },
      el("header", { className: "kb-article-head" }, el("h2", { textContent: file.name }),
        el("p", { className: "kb-article-meta" }, el("small", { textContent: file.path + (file.modified ? " · " + date(file.modified * 1000) : "") })),
        el("div", { className: "kb-article-actions" },
          button("Draft article from this file", () => draftFromNotes({ files: [{ path: file.path, name: file.name }] }), { className: "primary" }),
          button("Copy text", () => navigator.clipboard?.writeText(file.text).then(() => toast?.("Text copied"))))),
      el("pre", { className: "kb-file-text", textContent: file.text + (file.truncated ? "\n\n[Only the beginning of this file is shown]" : "") })));
  }

  function draftFromNotes(prefill = {}) {
    if (state.editing && !confirm("Discard the changes to this article?")) return;
    state.editing = false; state.current = null;
    const chosen = new Map((prefill.files || []).map((f) => [f.path, f.name]));
    const title = el("input", { value: prefill.title || "", maxLength: 180, placeholder: "Title (optional)" });
    title.setAttribute("aria-label", "Article title (optional)");
    const notes = el("textarea", { value: prefill.notes || "", rows: 10, spellcheck: true,
      placeholder: "Paste rough notes, a chat with the fix, or an email thread. The Assistant only uses what is here and in the files you choose." });
    notes.setAttribute("aria-label", "Notes");
    const picked = el("p", { className: "kb-picked" });
    const browser = el("div", { className: "kb-file-browser" });
    const message = el("p", { className: "kb-note", role: "status" });
    const status = el("p", { className: "kb-note kb-assistant-status" });
    const showStatus = (s) => { status.textContent = window.AtlasAssistant.describe(s); };
    window.AtlasAssistant.status().then(showStatus);
    const renderPicked = () => picked.replaceChildren(...(chosen.size ? [...chosen].map(([path, name]) =>
      el("span", { className: "kb-tag" }, name + " ", button("×", () => { chosen.delete(path); renderPicked(); browse(browser.dataset.path || ""); }, { title: "Remove " + name, className: "kb-chip-remove" })))
      : [el("span", { className: "kb-note", textContent: "No files chosen." })]));
    async function browse(path) {
      browser.dataset.path = path;
      let list;
      try { list = await post("/api/assistant/files", { path }); }
      catch (error) { browser.replaceChildren(el("p", { className: "kb-note", textContent: error.message }), button("Assistant settings", () => window.AtlasAssistant.openSettings())); return; }
      if (!list.items.length && !path) {
        browser.replaceChildren(el("p", { className: "kb-note", textContent: "No notes folders yet. Add them in Assistant settings to pick files here." }), button("Assistant settings", () => window.AtlasAssistant.openSettings()));
        return;
      }
      const rows = list.items.map((item) => {
        if (item.folder) return el("li", {}, button(item.name + " ›", () => browse(item.path), { className: "kb-folder", title: "Open folder " + item.name }));
        const box = el("input", { type: "checkbox", checked: chosen.has(item.path) });
        box.onchange = () => {
          if (box.checked && chosen.size >= 10) { box.checked = false; message.textContent = "Choose up to 10 files."; return; }
          box.checked ? chosen.set(item.path, item.name) : chosen.delete(item.path); renderPicked();
        };
        return el("li", {}, el("label", {}, box, " " + item.name, el("small", { textContent: " " + date(item.modified * 1000) })));
      });
      browser.replaceChildren(el("p", { className: "kb-browser-path" }, path ? button("↑ Up", () => browse(list.parent || "")) : null, el("small", { textContent: path || "Notes folders" })),
        el("ul", {}, ...rows));
    }
    const submit = el("button", { type: "submit", className: "primary", textContent: "Draft article" });
    const form = el("form", { className: "kb-assistant-form", onsubmit: async (event) => {
      event.preventDefault();
      if (!notes.value.trim() && !chosen.size) { message.textContent = "Paste some notes or choose a file first."; return; }
      submit.disabled = true;
      const started = Date.now();
      const tick = setInterval(() => { message.textContent = `Drafting… ${Math.round((Date.now() - started) / 1000)} s. The model writes the draft, then Atlas checks every line against your notes.`; }, 500);
      try {
        const draft = await post("/api/assistant/draft-article", { notes: notes.value, files: [...chosen.keys()], title: title.value.trim() });
        clearInterval(tick);
        edit({ title: draft.title, markdown: draft.markdown, tags: draft.tags, categories: draft.categories, revision: 0 }, true, draft);
      } catch (error) {
        clearInterval(tick); message.textContent = error.message; submit.disabled = false;
        window.AtlasAssistant.status().then(showStatus);
      }
    } },
      el("header", { className: "kb-article-head" }, el("h2", { textContent: "Draft an article from notes" }),
        el("div", { className: "kb-article-actions" }, status, button("Assistant settings", () => window.AtlasAssistant.openSettings()))),
      title, notes, el("h3", { textContent: "Files from your notes folders" }), picked, browser,
      el("div", { className: "kb-article-actions" }, submit, button("Cancel", () => welcome()), message));
    ui.view.replaceChildren(form);
    renderPicked(); browse("");
    notes.focus();
  }

  function reviewPanel(draft, text, update) {
    const flagged = draft.checks.filter((c) => !c.minor), minor = draft.checks.filter((c) => c.minor);
    const items = el("ul", {}, ...flagged.map((check) => {
      const line = el("li", {}, el("strong", { textContent: check.section + ": " }), check.text, el("small", { textContent: " — " + check.reasons.join("; ") }));
      const index = text ? text.value.indexOf(check.text) : -1;
      if (index >= 0) line.append(" ", button("Remove from draft", () => {
        const start = text.value.lastIndexOf("\n", index) + 1, end = text.value.indexOf("\n", index);
        text.value = text.value.slice(0, start) + text.value.slice(end < 0 ? text.value.length : end + 1);
        line.remove(); update();
      }));
      return line;
    }));
    const panel = el("section", { className: "kb-review" + (flagged.length ? " kb-review-warn" : "") },
      el("p", {}, el("strong", { textContent: flagged.length ? `Check ${flagged.length} line${flagged.length === 1 ? "" : "s"} before saving` : "Every line matches your notes" }),
        el("small", { textContent: ` · Drafted by ${draft.model || "the local model"} in ${draft.seconds} s from ${draft.sources.join(", ")}. Review it like any draft.` })),
      flagged.length ? items : null);
    if (draft.dropped.length) panel.append(el("p", { className: "kb-note", textContent: `Left out because they are not in your notes as written: ${draft.dropped.map((d) => d.text).join(" · ")}` }));
    if (minor.length) panel.append(el("p", { className: "kb-note", textContent: `${minor.length} line${minor.length === 1 ? "" : "s"} quote the notes with small differences (typos or OCR).` }));
    if (draft.cut) panel.append(el("p", { className: "kb-note", textContent: "Long notes were shortened to fit the model. Check that nothing important is missing." }));
    return panel;
  }

  // Bulk import from notes folders (for example all of F:\) into a review queue.
  async function refreshDrafts() {
    if (!window.AtlasAssistant || readonly() || !ui) return;
    try {
      const s = await api("/api/knowledge/import");
      const pending = s.drafts?.pending || 0, running = s.state === "running" || s.state === "paused";
      ui.drafts.hidden = !pending && !running;
      ui.drafts.textContent = running ? `Importing… ${s.done}/${s.total} · ${pending} to review` : `Review imported drafts (${pending})`;
      return s;
    } catch { ui.drafts.hidden = true; }
  }
  const duration = (seconds) => seconds == null ? "" : seconds < 90 ? `${Math.round(seconds)} s` : seconds < 5400 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`;

  async function importView() {
    if (state.editing && !confirm("Discard the changes to this article?")) return;
    state.editing = false; state.current = null;
    const settings = await window.AtlasAssistant.status();
    const folder = el("select");
    folder.setAttribute("aria-label", "Folder to import");
    folder.append(...(settings.folders || []).map((f) => el("option", { value: f, textContent: f })));
    const sub = el("input", { placeholder: "Optional: a folder inside it, e.g. F:\\IT\\Runbooks", spellcheck: false });
    sub.setAttribute("aria-label", "Only this folder inside it");
    const since = el("input", { type: "date" });
    since.setAttribute("aria-label", "Only files changed since");
    const limit = el("input", { type: "number", min: 0, value: 0 });
    limit.setAttribute("aria-label", "Stop after this many files (0 for all)");
    const types = el("div", { className: "kb-import-types" });
    const summary = el("p", { className: "kb-note", role: "status" });
    const progress = el("section", { className: "kb-import-progress" });
    const body = () => ({ folder: sub.value.trim() || folder.value, since: since.value ? new Date(since.value).getTime() / 1000 : 0,
      types: [...types.querySelectorAll("input:checked")].map((t) => t.value), limit: Number(limit.value) || 0 });
    const scan = async () => {
      summary.textContent = "Counting files…";
      try {
        const plan = await post("/api/knowledge/import/plan", { ...body(), types: [] });
        // Logs and data exports start unticked; tick them to include them anyway.
        const chosen = new Set(types.children.length ? body().types : plan.suggested_types || Object.keys(plan.by_type));
        types.replaceChildren(...Object.entries(plan.by_type).map(([type, count]) => el("label", {},
          el("input", { type: "checkbox", value: type, checked: chosen.has(type) }), ` ${type} ${count.toLocaleString()}`)));
        const each = plan.seconds_per_file;
        summary.textContent = `${plan.files.toLocaleString()} files, ${plan.new.toLocaleString()} not imported yet` +
          (plan.done_before ? ` (${plan.done_before.toLocaleString()} already done or unchanged).` : ".") +
          (plan.new ? each ? ` About ${duration(plan.new * each)} at ${each} s per file.` : " Expect about 10–20 s per file on an 8 GB graphics card, plus files that are skipped quickly." : "");
      } catch (error) { summary.textContent = error.message; }
    };
    const start = async () => {
      try { await post("/api/knowledge/import/start", body()); watch(); }
      catch (error) { summary.textContent = error.message; }
    };
    const control = (action) => async () => { try { show(await post("/api/knowledge/import/" + action, {})); } catch (error) { summary.textContent = error.message; } };
    const show = (s) => {
      const active = s.state === "running" || s.state === "paused" || s.state === "stopping";
      const files = s.files || {};
      progress.replaceChildren(
        el("p", {}, el("strong", { textContent: active ? (s.state === "paused" ? "Paused" : s.state === "stopping" ? "Stopping after this file…" : "Importing") : (s.message || "No import running") }),
          active ? ` · ${s.done.toLocaleString()} of ${s.total.toLocaleString()} files` : "",
          active && s.eta_seconds ? ` · about ${duration(s.eta_seconds)} left` : "",
          active && s.current ? el("small", { textContent: " · " + s.current }) : null),
        active ? el("progress", { max: s.total || 1, value: s.done }) : null,
        el("p", { className: "kb-note", textContent: `This run: ${s.drafted} drafted, ${s.skipped} skipped, ${s.failed} failed. ` +
          `All imports: ${files.drafted || 0} drafted, ${(files.skipped || 0) + (files.duplicate || 0)} skipped, ${files.failed || 0} failed · ${(s.drafts?.pending || 0)} drafts to review.` }),
        el("div", { className: "kb-article-actions" },
          s.state === "running" ? button("Pause", control("pause")) : null, s.state === "paused" ? button("Resume", control("resume")) : null,
          active && s.state !== "stopping" ? button("Stop", control("stop")) : null,
          s.drafts?.pending ? button(`Review ${s.drafts.pending} drafts`, () => reviewQueue(), { className: "primary" }) : null));
      startButton.disabled = active;
    };
    let timer = 0;
    const watch = async () => {
      clearTimeout(timer);
      if (!form.isConnected) return;
      const s = await refreshDrafts();
      if (s) show(s);
      if (s && s.state !== "idle") timer = setTimeout(watch, 2000);
    };
    const startButton = button("Start import", start, { className: "primary" });
    const form = el("div", { className: "kb-import" },
      el("header", { className: "kb-article-head" }, el("h2", { textContent: "Import knowledge from your notes folders" }),
        el("p", { className: "kb-note", textContent: "The Assistant reads each file, skips what is not IT knowledge (logs, exports, duplicates, very short files) and turns the rest into drafts checked line by line against the file. Drafts wait in a review queue; nothing is published until you choose. Files already imported are skipped unless they changed. You can keep using Atlas: your own Assistant requests go first." })),
      settings.folders?.length ? el("div", { className: "kb-import-fields" },
        el("label", {}, "Folder", folder), el("label", {}, "Inside it (optional)", sub), el("label", {}, "Changed since (optional)", since), el("label", {}, "Stop after (files, 0 = all)", limit))
        : el("p", {}, "No notes folders yet. ", button("Assistant settings", () => window.AtlasAssistant.openSettings()), " Add F:\\ or the folders with your notes, then come back."),
      el("div", { className: "kb-article-actions" }, button("Count files", scan), startButton, button("Review drafts", () => reviewQueue())), types, summary, progress);
    ui.view.replaceChildren(form);
    if (settings.folders?.length) scan();
    watch();
  }

  async function reviewQueue() {
    if (state.editing && !confirm("Discard the changes to this article?")) return;
    state.editing = false; state.current = null;
    let list;
    try { list = (await api("/api/knowledge/drafts")).drafts; }
    catch (error) { ui.status.textContent = error.message; return; }
    const clean = list.filter((d) => !d.flags).length;
    const items = el("ul", { className: "kb-draft-list" }, ...list.map((d) => el("li", {}, button("", () => openDraft(d.id), { className: "kb-result" }))));
    items.querySelectorAll("button").forEach((b, i) => {
      const d = list[i];
      b.append(el("span", { className: "kb-result-top" }, el("span", { className: "kb-kind " + (d.flags ? "kb-kind-flagged" : "kb-kind-clean"), textContent: d.flags ? `${d.flags} to check` : "Clean" }),
        el("strong", { textContent: d.title }), el("small", { textContent: date(d.created) })), el("span", { className: "kb-result-text", textContent: d.path }));
    });
    const publishClean = async () => {
      if (!confirm(`Publish ${clean} draft${clean === 1 ? "" : "s"} whose lines all match their files? You can still edit or delete them later.`)) return;
      try { const r = await post("/api/knowledge/drafts/publish-clean", {}); toast?.(`${r.published} articles published`); await refresh(); reviewQueue(); }
      catch (error) { ui.status.textContent = error.message; }
    };
    ui.view.replaceChildren(el("div", { className: "kb-review-queue" },
      el("header", { className: "kb-article-head" }, el("h2", { textContent: `Imported drafts to review (${list.length})` }),
        el("div", { className: "kb-article-actions" }, clean ? button(`Publish ${clean} clean draft${clean === 1 ? "" : "s"}`, publishClean, { className: "primary" }) : null,
          button("Import settings", () => importView()))),
      list.length ? items : el("p", { className: "kb-note", textContent: "Nothing to review. Start an import from New article… → Import knowledge from folders…" })));
  }

  async function openDraft(id) {
    let d;
    try { d = await api("/api/knowledge/drafts/" + id); }
    catch (error) { ui.status.textContent = error.message; return; }
    const body = el("div", { className: "kb-markdown" });
    const review = { ...d.review, draftId: d.id };
    const act = (path, done) => async () => { try { await post(path, {}); toast?.(done); await refresh(); reviewQueue(); } catch (error) { ui.status.textContent = error.message; } };
    ui.view.replaceChildren(el("header", { className: "kb-article-head" },
      el("h2", { textContent: d.title }),
      el("p", { className: "kb-article-meta" }, ...d.categories.map((c) => el("span", { className: "kb-category", textContent: label(c) })),
        ...d.tags.map((t) => el("span", { className: "kb-tag", textContent: t })), el("small", { textContent: "From " + d.path })),
      el("div", { className: "kb-article-actions" },
        button("Publish", act(`/api/knowledge/drafts/${d.id}/publish`, "Article published"), { className: "primary" }),
        button("Edit, then publish", () => edit({ title: d.title, markdown: d.markdown, tags: d.tags, categories: d.categories, revision: 0 }, true, review)),
        button("Reject", act(`/api/knowledge/drafts/${d.id}/reject`, "Draft rejected")),
        button("Open the file", () => openFile(d.path)), button("Back to the list", () => reviewQueue()))),
      reviewPanel(review, null, () => {}), body);
    await render(d.markdown, body);
  }

  // Wrap the existing Knowledge Base entry points; diagrams keep working exactly as before.
  const original = { open: window.AtlasKnowledge.open, show: window.AtlasKnowledge.show };
  window.AtlasKnowledge.open = async (...args) => { const result = await original.open(...args); install(); return result; };
  window.AtlasKnowledge.show = async (id) => {
    if (String(id).startsWith("article:")) {
      page("knowledge"); await window.AtlasKnowledge.open(); setMode("articles");
      return open(String(id).slice(8));
    }
    if (String(id).startsWith("file:")) {
      page("knowledge"); await window.AtlasKnowledge.open(); setMode("articles");
      return openFile(String(id).slice(5));
    }
    setMode("diagrams");
    return original.show(id);
  };
  window.AtlasKnowledgeArticles = { install, open, edit, refresh, render, setMode, state, draftFromNotes, openFile, importView, reviewQueue, openDraft };
})();
