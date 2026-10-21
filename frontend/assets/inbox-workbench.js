/* Live Inbox request tools: the person, their PCs (health, performance, groups, deployment,
   software, services, remote tools), group comparisons and Knowledge Base articles, shown beside
   the message instead of switching page. Anyone in the request is one click away, anyone else
   one lookup away. Nothing runs without a click; ending a process and rebooting still ask first.
   Remote Admin, Active Directory, Workspace and diagrams stay one click away, with a button back
   to Live Inbox. Support tools (support_tools.py): a PC check-up, a message on the PC's screen, a
   restart later, Group Policy refresh, account unlock, BitLocker recovery keys, shared notes on
   people and PCs, and a work log of what was done for the request, ready to paste in the ticket.
   Outside Live Inbox the same tools float over the page (window.AtlasTools.open): the clipboard
   history, right-click menus and anything else open them on a PC or a person without changing page. */
(() => {
  // [id, label, what it needs]
  const TABS = [
    ["person", "Person", "user"],
    ["health", "Health", "machine"],
    ["checkup", "Check-up", "machine"],
    ["performance", "Performance", "machine"],
    ["machine-groups", "PC groups", "machine"],
    ["user-groups", "User groups", "account"],
    ["deploy", "Deploy", "machine"],
    ["knowledge", "Knowledge", "document"],
    ["reply", "Reply", "message"],
    ["notes", "Notes", "any"],
  ];
  const MISSING = {
    user: "No Atlas person is selected. Choose someone in this request or look them up above.",
    machine: "No Windows PC is selected. Choose one in this request, in Person, or look it up above.",
    account: "This person has no AD account or email in Atlas.",
    document: "Choose an article under Knowledge Base or Seen before in the message.",
    message: "Select a message in Live Inbox to reply to it.",
    any: "Choose a message, a person or a PC first.",
  };
  // Reply templates; {first} {pc} {on} {package} {ticket} are filled from the message and the tools.
  const REPLIES = {
    en: [["done", "Done", "Hi {first},\n\nThis is done{on}. Let me know if anything still isn't working.\n\nKind regards,"],
      ["installed", "Installed", "Hi {first},\n\n{package} is now installed{on}. If it doesn't appear yet, restart the application or sign out and back in.\n\nKind regards,"],
      ["restart", "Please restart", "Hi {first},\n\nCould you please restart {pc} and let me know if the problem comes back?\n\nKind regards,"],
      ["details", "More details", "Hi {first},\n\nCould you send me your PC name (on the sticker on the machine) and a screenshot of the error, so I can look into it?\n\nKind regards,"],
      ["remote", "Remote session", "Hi {first},\n\nI'm going to connect to {pc} with Remote Assistance. Please accept the prompt when it appears on your screen.\n\nKind regards,"],
      ["ticket", "Ticket raised", "Hi {first},\n\nI've raised {ticket} for this; you'll get the updates from it.\n\nKind regards,"]],
    fr: [["done", "C'est fait", "Bonjour {first},\n\nC'est fait{on}. N'hésitez pas à me dire si quelque chose ne fonctionne toujours pas.\n\nCordialement,"],
      ["installed", "Installé", "Bonjour {first},\n\n{package} est maintenant installé{on}. S'il n'apparaît pas encore, redémarrez l'application ou fermez puis rouvrez votre session.\n\nCordialement,"],
      ["restart", "Redémarrer", "Bonjour {first},\n\nPourriez-vous redémarrer {pc} et me dire si le problème revient ?\n\nCordialement,"],
      ["details", "Plus d'infos", "Bonjour {first},\n\nPourriez-vous m'envoyer le nom de votre PC (sur l'étiquette de la machine) et une capture d'écran de l'erreur ?\n\nCordialement,"],
      ["remote", "Prise en main", "Bonjour {first},\n\nJe vais me connecter à {pc} en assistance à distance. Merci d'accepter la demande qui va s'afficher à l'écran.\n\nCordialement,"],
      ["ticket", "Ticket ouvert", "Bonjour {first},\n\nJ'ai ouvert {ticket} pour cette demande ; vous recevrez les mises à jour par ce biais.\n\nCordialement,"]],
  };
  const FRENCH = /\b(bonjour|merci|cordialement|svp|s'il vous pla[iî]t|pourriez|pouvez|ordinateur|mon poste|bonne journ[ée]e)\b/i;
  const TOOLS = [["msra", "MSRA"], ["cshare", "C$"], ["rdp", "Remote Desktop"], ["compmgmt", "Computer Management"]];
  const RECORD = [["Account", "user_name"], ["Email", "email"], ["Department", "department"], ["Job role", "job_role"], ["Location", "location"],
    ["Manager", "manager"], ["Business unit", "business_unit"], ["Employee number", "employee_number"], ["Start date", "start_date"], ["Last login", "last_login"]];
  const MEMBERSHIP = { Direct: 0, Primary: 1, Nested: 2 };
  // Message on screen presets: [button, text].
  const SCREEN = [["Connecting now", "IT support is connecting to your PC now to look at your request."],
    ["Save your work", "Please save your work: IT support will restart your PC in 10 minutes."],
    ["Please call us", "Please call the IT service desk when you see this message. Thank you."]];
  const LOG = "atlas.inbox.worklog";
  const state = { machine: "", user: null, tab: "health", done: {}, performance: null, groups: {}, docked: false,
    request: null, person: null, document: "", article: null, results: null, floating: false, context: null };
  let dock = null, home = null, back = null, inboxClick = false, lookupGeneration = 0, companionInfo = null;
  const drafts = new Map(), checkups = new Map();

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const account = (user) => user?.user_name || user?.email || "";
  const fullName = (user) => user?.full_name || user?.name || account(user);
  const machineName = (machine) => String(machine?.name || machine?.machine_name || "").toUpperCase();
  const windows = (machine) => window.AtlasUI?.supportsWindows ? window.AtlasUI.supportsWindows(machine) : true;
  const inbox = () => document.getElementById("inbox");
  // The Live Inbox message the tools work on; none while they float over another page.
  const req = () => (state.floating ? null : state.request);
  const pane = (tab) => dock.querySelector(`[data-work-pane="${tab}"]`);
  const number = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
  const percent = (value) => (number(value) === null ? "–" : Math.round(number(value)) + "%");
  const gib = (bytes) => (number(bytes) === null ? "–" : (number(bytes) / 1024 ** 3).toFixed(1));
  const tone = (value, warn, high) => (number(value) === null ? "" : value >= high ? "bad" : value >= warn ? "warn" : "good");
  const busy = (host, text) => { host.setAttribute("aria-busy", "true"); host.innerHTML = `<p class="inbox-work-muted" role="status">${esc(text)}</p>`; };
  const failed = (host, error) => { host.innerHTML = `<p class="inbox-work-error" role="alert">${esc(error.message)}</p><button type="button" data-work-rescan>Try again</button>`; };
  const post = (url, body, method = "POST") => window.AtlasClient.request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const plural = (count, word, many = word + "s") => `${count} ${count === 1 ? word : many}`;
  const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
  const clock = (value) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = (value) => (value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) : "");
  const adServer = () => document.getElementById("adServer")?.value.trim() || "";
  // Notes follow the directory person (canonical key) so they survive a directory rebuild.
  const noteKey = (user) => user?.canonical_key || (account(user) ? "account:" + account(user).toLowerCase() : "");
  const available = () => ({ machine: !!state.machine, user: !!state.user?.id, account: !!account(state.user), document: !!state.document,
    message: !!req()?.message, any: !!(state.machine || state.user?.id || req()?.message) });

  function build() {
    dock = document.createElement("aside");
    dock.id = "inboxWork";
    dock.className = "inbox-work";
    dock.hidden = true;
    dock.setAttribute("aria-label", "Request tools");
    dock.innerHTML = `<div class="inbox-work-head"><div><small data-work-where>Request tools · without leaving Live Inbox</small><h2 data-work-title></h2></div><button type="button" class="inbox-work-close" data-work-close aria-label="Close request tools" title="Close">×</button></div>
<div class="inbox-work-request" data-work-request hidden></div>
<form class="inbox-work-lookup" data-work-lookup role="search"><input type="search" name="term" placeholder="Look up anyone: name, account, email or PC" aria-label="Look up a person or PC" autocomplete="off" spellcheck="false" /><button type="submit">Find</button></form>
<div class="inbox-work-results" data-work-results hidden></div>
<div class="inbox-work-quick" role="group" aria-label="PC tools">${TOOLS.map(([id, label]) => `<button type="button" data-work-tool="${id}" data-needs="machine">${label}</button>`).join("")}<button type="button" data-work-software data-needs="machine">Software…</button><button type="button" data-work-services data-needs="machine">Services…</button><button type="button" data-work-specs data-needs="machine">Specs</button><button type="button" data-work-reboot data-needs="machine">Reboot…</button><button type="button" data-work-act="message" data-needs="machine">Message…</button><button type="button" data-work-act="restart" data-needs="machine">Restart later…</button><button type="button" data-work-gpupdate data-needs="machine" title="gpupdate /target:computer /force on the PC">GPUpdate</button><button type="button" data-work-workspace>Workspace ↗</button></div>
<div class="inbox-work-form" data-work-form hidden></div>
<div class="inbox-work-tabs" role="tablist" aria-label="Request tools">${TABS.map(([id, label]) => `<button type="button" role="tab" id="inboxWorkTab-${id}" data-work-tab="${id}" aria-controls="inboxWorkPane-${id}" aria-selected="false">${label}</button>`).join("")}</div>
${TABS.map(([id]) => `<section class="inbox-work-pane" role="tabpanel" id="inboxWorkPane-${id}" data-work-pane="${id}" aria-labelledby="inboxWorkTab-${id}" hidden></section>`).join("")}`;
    pane("health").innerHTML = "<div data-work-health></div>";
    dock.addEventListener("click", (event) => click(event).catch((error) => toast(error.message)));
    dock.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.floating && !event.target.closest("input,textarea,select")) close(); });
    // Floating tools sit left of an open drawer (clipboard, queue, deployments) so both stay usable.
    const drawers = new MutationObserver(avoidDrawers);
    document.querySelectorAll(".queue-drawer, .deployments-drawer").forEach((node) => drawers.observe(node, { attributes: true, attributeFilter: ["class"] }));
    window.addEventListener("resize", avoidDrawers);
    dock.addEventListener("input", (event) => {
      if (event.target.matches("[data-work-filter]")) filterGroups(event.target);
      if (event.target.matches("[data-work-reply]")) drafts.get(req().message.id).text = event.target.value;
      if (event.target.matches("[data-work-key-filter]")) filterKeys(event.target.value);
    });
    dock.addEventListener("change", (event) => {
      if (event.target.matches("[data-work-reply-all]")) drafts.get(req().message.id).all = event.target.checked;
      if (event.target.matches("[data-work-checkup-days]")) { state.checkupDays = Number(event.target.value); checkup().catch((error) => toast(error.message)); }
    });
    dock.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      if (form.matches("[data-work-lookup]")) lookup(form.elements.term.value).catch((error) => toast(error.message));
      if (form.matches("[data-work-compare-form]")) compare(form.elements.other.value).catch((error) => toast(error.message));
      const run = form.matches("[data-work-send-message]") ? sendMessage : form.matches("[data-work-schedule-restart]") ? scheduleRestart
        : form.matches("[data-work-note]") ? saveNote : form.matches("[data-work-log-add]") ? addLog : null;
      if (run) whileBusy(form, () => run(form));
    });
  }

  /** Opens the tools beside the Live Inbox message, or floating over any other page. A missing
   *  machine or user keeps the current one; a different person without a machine gets their own PC
   *  once their record has loaded. detail.context ({label, title, people, machines, log}) lists
   *  who and what the opener holds (a clipboard item), one click each. False only in the viewer. */
  function open(detail = {}, tab = "health", mode = "show") {
    if (window.AtlasReadOnly) return false;
    if (!dock) build();
    place();
    if (detail.context !== undefined) state.context = detail.context;
    else if (!state.floating) state.context = null;
    const user = detail.user === undefined ? state.user : detail.user;
    const samePerson = (user?.id ?? account(user)) === (state.user?.id ?? account(state.user));
    const machine = detail.machine === undefined ? (samePerson ? state.machine : "") : String(detail.machine || "").toUpperCase();
    if (detail.document) state.document = detail.document;
    use(machine, user);
    dock.hidden = false;
    renderRequest();
    show(tab, mode);
    // Message on screen… and Restart later… from a menu open their form straight away.
    if (detail.form && state.machine) actionForm(detail.form);
    // Their record, desk and PCs, ready in Person; it also picks their PC when none was given.
    if (user?.id && tab !== "person" && state.done.person !== user.id) loadPerson();
    return true;
  }

  function use(machine, user) {
    invalidateLookup();
    if (machine !== state.machine) {
      const host = dock.querySelector("[data-work-health]");
      if (host) window.AtlasHealth?.cancel(host);
      state.machine = machine;
      state.performance = null;
      state.checkup = null;
      state.keys = null;
      for (const tab of ["health", "checkup", "performance", "machine-groups"]) delete state.done[tab];
      pane("health").innerHTML = "<div data-work-health></div>";
      for (const tab of ["checkup", "performance", "machine-groups"]) pane(tab).replaceChildren();
      closeForm();
    }
    if ((user?.id ?? account(user)) !== (state.user?.id ?? account(state.user))) {
      delete state.done["user-groups"];
      delete state.done.person;
      state.person = null;
      pane("user-groups").replaceChildren();
      pane("person").replaceChildren();
    }
    state.user = user;
    dock.querySelector("[data-work-title]").textContent = [machine || "No Windows PC", fullName(user)].filter(Boolean).join(" · ");
    refreshTabs();
    dock.querySelectorAll('[data-needs="machine"]').forEach((button) => { button.disabled = !machine; });
    renderRequest();
  }

  // Beside the message in Live Inbox; elsewhere a panel over the page, which stays open as you move
  // between pages until it is closed.
  function place() {
    const grid = inbox()?.classList.contains("active") && document.querySelector("#liveInbox .inbox-grid");
    // React owns .inbox-grid's two columns and never re-orders them, so the panel stays the last child.
    if (grid) { if (dock.parentNode !== grid) grid.append(dock); }
    else if (dock.parentNode !== document.body) document.body.append(dock);
    state.floating = !grid;
    dock.classList.toggle("inbox-work-floating", state.floating);
    dock.setAttribute("aria-label", state.floating ? "Tools" : "Request tools");
    dock.querySelector("[data-work-where]").textContent = state.floating ? "Tools · over this page, nothing changes page" : "Request tools · without leaving Live Inbox";
    avoidDrawers();
  }

  function avoidDrawers() {
    if (!dock || !state.floating) return;
    const width = Math.max(0, ...[...document.querySelectorAll(".queue-drawer.open, .deployments-drawer.open")].map((node) => node.getBoundingClientRect().width));
    dock.style.right = width && innerWidth - width >= 500 ? `${Math.round(width) + 8}px` : "";
  }

  function refreshTabs() {
    const have = available();
    for (const [tab, , needs] of TABS) {
      const button = dock.querySelector(`[data-work-tab="${tab}"]`);
      button.disabled = !have[needs];
      button.title = have[needs] ? "" : MISSING[needs];
    }
  }

  // Buttons of a form stay disabled while it is sent, so a double click never sends it twice.
  async function whileBusy(form, run) {
    const buttons = [...form.querySelectorAll("button:not(:disabled)")];
    buttons.forEach((button) => { button.disabled = true; });
    try { await run(); } catch (error) { toast(error.message); } finally { buttons.forEach((button) => { button.disabled = false; }); }
  }

  function show(tab, mode = "show") {
    const needs = TABS.find(([id]) => id === tab)?.[2];
    if (!needs) return;
    state.tab = tab;
    dock.querySelectorAll("[data-work-tab]").forEach((button) => {
      const selected = button.dataset.workTab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.classList.toggle("active", selected);
    });
    dock.querySelectorAll("[data-work-pane]").forEach((section) => { section.hidden = section.dataset.workPane !== tab; });
    if (!available()[needs]) return note(tab, MISSING[needs]);
    if (tab === "person") return mode === "scan" || state.done.person !== state.user.id ? loadPerson() : undefined;
    if (tab === "health") return health(mode);
    if (tab === "checkup") return mode === "scan" || state.done.checkup !== state.machine ? checkup() : undefined;
    if (tab === "notes") return renderNotes(mode);
    if (tab === "performance") return mode === "scan" || state.done.performance !== state.machine ? performance() : undefined;
    if (tab === "machine-groups" || tab === "user-groups") {
      const kind = tab === "user-groups" ? "user" : "computer", id = kind === "user" ? account(state.user) : state.machine;
      return mode === "scan" || state.done[tab] !== kind + ":" + id ? groups(kind, id) : undefined;
    }
    if (tab === "knowledge") return mode === "scan" || state.done.knowledge !== state.document ? knowledge() : undefined;
    if (tab === "deploy") { target(); return dockDeployment(); }
    if (tab === "reply") return renderReply();
  }

  // The Atlas Companion, for what only the operator's own session can do (Outlook, Teams, links).
  async function companion(kind) {
    if (!companionInfo || Date.now() - companionInfo.at > 10000) {
      try { companionInfo = { at: Date.now(), data: await window.AtlasClient.request("/api/companion", { atlasSilent: true }) }; }
      catch { companionInfo = { at: Date.now(), data: {} }; }
    }
    return !!(companionInfo.data.online && (companionInfo.data.capabilities || []).includes(kind));
  }
  const ask = (kind, args, wait = 10) => post("/api/companion/commands", { kind, args, wait });

  // Teams and mail links open in the operator's own Teams and Outlook when the Companion runs.
  async function openLink(url) {
    if (await companion("open.url")) {
      const result = await ask("open.url", { url }, 8);
      if (result.state === "failed" || result.state === "expired") throw Error(result.error || "The link did not open.");
      return toast("Opened in your session");
    }
    window.open(url, "_blank", "noopener");
  }
  const teamsLink = (kind, email, message) => `https://teams.microsoft.com/l/${kind}/0/0?users=${encodeURIComponent(email)}${message ? "&message=" + encodeURIComponent(message) : ""}`;

  function firstName(detail) {
    const user = detail.match?.user, name = String(user?.full_name || user?.name || detail.message.sender_name || "").trim();
    // "Lair de Gourmont, Amaury Pierre Marie" and "DUPONT Marie": the given name, not the surname.
    if (name.includes(",")) return name.split(",")[1].trim().split(/\s+/)[0] || "";
    const words = name.split(/\s+/).filter(Boolean);
    return words.find((word) => word !== word.toUpperCase()) || words[0] || "";
  }

  function fill(template, detail, lang) {
    const pc = state.machine || requestEntries().machines[0]?.name || "";
    const text = `${detail.message.subject || ""}\n${detail.message.body || ""}`;
    const ticket = (text.match(/\b(?:INC|RITM|REQ|SCTASK|CHG)\d{6,10}\b/i) || [""])[0].toUpperCase();
    const fr = lang === "fr";
    const values = { first: firstName(detail), pc: pc || (fr ? "votre PC" : "your PC"), on: pc ? (fr ? " sur " : " on ") + pc : "",
      package: detail.analysis?.packages?.[0]?.display_name || (fr ? "L'application" : "The application"), ticket: ticket || (fr ? "un ticket" : "a ticket") };
    return template.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "").replace(/^(Hi|Bonjour) ,/m, "$1,");
  }

  function renderReply() {
    const detail = req(), host = pane("reply"), message = detail.message, id = message.id;
    const draft = drafts.get(id) || { lang: FRENCH.test(`${message.subject} ${message.body}`) ? "fr" : "en", text: "", all: false };
    drafts.set(id, draft);
    const teams = message.channel === "teams" && message.content_kind === "notification";
    const email = detail.match?.user?.email || message.sender_address;
    const heading = teams ? `Teams chat with ${esc(fullName(detail.match?.user) || message.sender_name)}`
      : `To ${esc(message.sender_name || message.sender_address)}${message.sender_address ? " &lt;" + esc(message.sender_address) + "&gt;" : ""} · ${esc(/^re:/i.test(message.subject || "") ? message.subject : "RE: " + (message.subject || ""))}`;
    host.innerHTML = `<div class="inbox-work-toolbar"><small>${heading}</small><span role="group" aria-label="Language">${["en", "fr"].map((lang) => `<button type="button" data-work-lang="${lang}" aria-pressed="${draft.lang === lang}">${lang.toUpperCase()}</button>`).join("")}</span></div>
<div class="inbox-work-templates" role="group" aria-label="Reply templates">${REPLIES[draft.lang].map(([key, label]) => `<button type="button" data-work-template="${key}">${esc(label)}</button>`).join("")}</div>
<textarea data-work-reply rows="9" aria-label="Reply text" placeholder="Choose a template above or write your reply.">${esc(draft.text)}</textarea>
<div class="inbox-work-toolbar"><span>${message.outlook ? `<button type="button" class="primary" data-work-reply-outlook>Open reply in Outlook</button><label><input type="checkbox" data-work-reply-all${draft.all ? " checked" : ""}> Reply all</label>` : ""}${teams && email ? '<button type="button" class="primary" data-work-reply-teams>Reply in Teams chat</button>' : ""}${!message.outlook && !teams && email ? '<button type="button" data-work-reply-mail>New email in Outlook</button>' : ""}<button type="button" data-work-reply-copy>Copy</button></span></div>
<p class="inbox-work-muted" data-work-reply-status>${message.outlook ? "Outlook opens the reply with this text above the original email; you check it and press Send." : teams ? "Teams opens a chat with this text ready to send." : "This email did not come through the Atlas Companion: copy the text, or open a new email."}</p>`;
  }

  async function sendReply(how) {
    const detail = req(), message = detail.message, draft = drafts.get(message.id), note = pane("reply").querySelector("[data-work-reply-status]");
    const text = draft.text.trim();
    if (!text && how !== "outlook") return toast("Write the reply first.");
    note.textContent = "Opening…";
    try {
      if (how === "outlook") {
        const result = await ask("outlook.reply", { message_id: message.id, text, reply_all: draft.all });
        if (result.state === "failed" || result.state === "expired") throw Error(result.error || "Outlook did not open the reply.");
        note.textContent = result.state === "done" ? "Reply opened in Outlook: check it and press Send." : "Sent to the Atlas Companion; Outlook will open the reply.";
        if (text) logWork("Reply prepared in Outlook");
        return;
      }
      const email = detail.match?.user?.email || message.sender_address;
      const subject = /^re:/i.test(message.subject || "") ? message.subject : "RE: " + (message.subject || "");
      await openLink(how === "teams" ? teamsLink("chat", email, text) : `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`);
      note.textContent = how === "teams" ? "Teams chat opened with your reply ready to send." : "New email opened.";
      logWork(how === "teams" ? "Reply prepared in Teams chat" : "Reply prepared in a new email");
    } catch (error) {
      note.textContent = error.message;
    }
  }

  function note(tab, text) {
    pane(tab).innerHTML = `<p class="inbox-work-muted">${esc(text)}</p>`;
  }

  // Atlas's current target follows the panel, so Workspace, Remote Admin and deployment agree.
  function target() {
    if (!state.machine) throw Error("No Windows PC is selected for this request.");
    if (S.target !== state.machine) setTarget(state.machine, "Live inbox request", false);
    if (S.target !== state.machine) throw Error(`${state.machine} is inventory only; Windows tools need a PC.`);
  }

  // Everyone and every PC in the selected message, one click each.
  function requestEntries() {
    if (state.context) return { people: state.context.people || [], machines: state.context.machines || [] };
    const detail = req();
    if (!detail) return { people: [], machines: [] };
    const sender = detail.match?.user, named = (detail.analysis?.people || []).filter((p) => !p.ambiguous);
    const people = [...(sender ? [{ user: sender, label: fullName(sender), role: "sender" }] : []), ...named.map((p) => ({ user: p, label: fullName(p), role: "named" }))];
    const machines = [];
    const add = (machine, owner) => {
      const name = machineName(machine);
      if (name && windows(machine) && !machines.some((m) => m.name === name)) machines.push({ name, owner });
    };
    (detail.analysis?.machines || []).forEach((m) => add(m, m.linked ? sender : undefined));
    (detail.machines || []).forEach((m) => add(m, sender));
    named.forEach((p) => (p.machines || []).forEach((m) => add(m, p)));
    return { people, machines };
  }

  function renderRequest() {
    const host = dock?.querySelector("[data-work-request]");
    if (!host) return;
    const { people, machines } = requestEntries();
    host.hidden = people.length + machines.length < 2;
    host.innerHTML = `<small>${esc(state.context?.label || "In this request")}</small>${people.map((p, i) => `<button type="button" data-work-person="${i}" aria-pressed="${p.user.id === state.user?.id}" title="${{ sender: "Sender", named: "Named in the message" }[p.role] || "In the copied text"}">${esc(p.label)}${p.role === "sender" ? " · sender" : ""}</button>`).join("")}${machines.map((m, i) => `<button type="button" data-work-machine="${i}" aria-pressed="${m.name === state.machine}" data-kind="machine">${esc(m.name)}</button>`).join("")}`;
  }

  async function loadPerson() {
    const user = state.user, host = pane("person"), id = user?.id;
    if (!id) return;
    state.done.person = id;
    busy(host, `Loading ${fullName(user)}…`);
    try {
      const data = await window.AtlasClient.request(`/api/inbox/person/${encodeURIComponent(id)}`);
      if (state.done.person !== id) return;
      if (!data?.user) throw Error(`${fullName(user)} is no longer in the Atlas directory.`);
      state.person = data;
      state.user = { ...user, ...data.user };
      renderPerson();
      const who = noteKey(state.user);
      if (who) window.AtlasClient.request("/api/support/notes?" + new URLSearchParams({ user: who }), { atlasSilent: true }).then((notes) => {
        if (state.done.person !== id || state.person !== data || !notes?.user) return;
        data.note = notes.user;
        renderPerson();
      }).catch(() => {});
      // A person opened without a PC gets their own.
      const pc = (data.machines || []).find(windows);
      if (!state.machine && pc) {
        use(machineName(pc), state.user);
        if (state.tab !== "person" && TABS.find(([tab]) => tab === state.tab)[2] === "machine") show(state.tab);
      }
    } catch (error) {
      if (state.done.person !== id) return;
      delete state.done.person;
      failed(host, error);
    } finally {
      host.removeAttribute("aria-busy");
    }
  }

  function renderPerson() {
    const { user, machines = [], desks = [], deployments = [], note: pinned } = state.person, host = pane("person");
    const requests = (state.person.requests || []).filter((request) => request.id !== req()?.message?.id);
    const rows = RECORD.filter(([, key]) => user[key]).map(([label, key]) => [label, user[key]]);
    if (desks.length) rows.splice(Math.min(rows.length, 5), 0, ["Desk", desks.map((desk) => `${desk.id} (floor ${desk.floor})${/name/.test(desk.match || "") ? " · name match" : ""}`).join(", ")]);
    const links = user.email ? [["chat", "Teams chat"], ["call", "Teams call"], ["mail", "Email"]].map(([kind, label]) => `<button type="button" data-work-link="${kind}">${label}</button>`).join("") : "";
    host.innerHTML = `<div class="inbox-work-toolbar"><b>${esc(fullName(user))}</b><span>${links}<button type="button" data-work-copy-person>Copy summary</button><button type="button" data-work-tab-link="user-groups"${account(user) ? "" : " disabled"}>User groups</button></span></div>
${pinned?.text ? `<div class="inbox-work-pinned"><small>Note${pinned.updated ? " · " + esc(day(pinned.updated)) : ""}</small><p>${esc(pinned.text)}</p><button type="button" data-work-tab-link="notes">Edit</button></div>` : ""}
<dl class="inbox-work-record">${rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>
<div class="inbox-work-toolbar"><b>PCs and devices (${machines.length})</b></div>
${machines.length ? `<ul class="inbox-work-machines">${machines.map((m) => {
      const name = machineName(m), pc = windows(m);
      return `<li data-work-device="${esc(name)}"${name === state.machine ? ' aria-current="true"' : ""}><span><b>${esc(name)}</b><small>${esc([m.device_kind, m.model_id || m.model_category, m.match_type, m.operational_status].filter(Boolean).join(" · "))}</small></span>${pc
        ? `<span><button type="button" data-work-use="${esc(name)}" data-then="health">Health</button><button type="button" data-work-use="${esc(name)}" data-then="performance">Performance</button><button type="button" data-work-use="${esc(name)}" data-then="deploy">Deploy</button></span>`
        : '<small>Inventory only</small>'}</li>`;
    }).join("")}</ul>` : '<p class="inbox-work-muted">No linked device in Atlas.</p>'}
${requests.length ? `<div class="inbox-work-toolbar"><b>Other requests in Live Inbox (${requests.length})</b></div><ul class="inbox-work-history">${requests.map((request) => `<li><button type="button" data-work-open-message="${esc(request.id)}"><span>${esc(request.subject || "(no subject)")}</span><small>${esc(day(request.received_at))}</small></button></li>`).join("")}</ul>` : ""}
${deployments.length ? `<div class="inbox-work-toolbar"><b>Recent deployments to their PCs (${deployments.length})</b></div><ul class="inbox-work-history">${deployments.map((job) => `<li><span><span>${esc(job.package || "Script")} · ${esc(job.action || "")}</span><small>${esc(job.target)} · ${esc(day(job.started))}</small></span><small data-state="${esc(String(job.state || "").toLowerCase())}">${esc(job.state || "")}</small></li>`).join("")}</ul>` : ""}`;
  }

  function health(mode) {
    const host = pane("health").querySelector("[data-work-health]"), pc = state.machine;
    const current = () => state.machine === pc && !dock.hidden;
    if (mode === "scan") { state.done.health = pc; return window.AtlasHealth.scan(host, pc, current); }
    if (state.done.health === pc && mode !== "quick") return;
    state.done.health = pc;
    return window.AtlasHealth.quick(host, pc, current);
  }

  // One-click check-up (scripts/support_diagnose.ps1): who is signed in, uptime, crashes and blue
  // screens, a pending restart, the last updates and the network, with what stands out first.
  async function checkup() {
    const host = pane("checkup"), pc = state.machine, days = state.checkupDays || 7, key = pc + ":" + days;
    state.done.checkup = pc;
    busy(host, `Checking ${pc}: sign-ins, crashes, pending restart, updates and network… up to a minute.`);
    // Switching PC and back while it runs waits for the same check-up instead of starting a second.
    let run = checkups.get(key);
    if (!run) {
      run = window.AtlasClient.request(`/api/diagnose/${encodeURIComponent(pc)}?days=${days}`);
      checkups.set(key, run);
      run.finally(() => checkups.delete(key)).catch(() => {});
    }
    try {
      const data = await run;
      if (state.machine !== pc || state.done.checkup !== pc) return;
      state.checkup = { pc, data };
      renderCheckup();
      const found = findings(data);
      logWork(`Check-up of ${pc} (${plural(data.days, "day")}): ${found.length ? found.map(([, text]) => text).join("; ") : "nothing stands out"}`);
    } catch (error) {
      if (state.machine !== pc || state.done.checkup !== pc) return;
      delete state.done.checkup;
      failed(host, error);
    } finally {
      // A check-up still running for the PC now selected keeps its busy state.
      if (state.done.checkup === pc || !checkups.size) host.removeAttribute("aria-busy");
    }
  }

  const wireless = (adapter) => /wi-?fi|wireless|wlan|802\.11/i.test(`${adapter.name} ${adapter.description}`);
  const vpn = (adapter) => /vpn|virtual|anyconnect|globalprotect|zscaler|pangp|fortinet|tap-/i.test(`${adapter.name} ${adapter.description}`);

  function findings(data) {
    const out = [], session = data.session || {}, events = data.events || {}, restart = data.pending_reboot || {}, updates = data.updates || {};
    const network = list(data.network), period = `in ${plural(data.days, "day")}`;
    if (restart.pending) out.push(["bad", `Restart pending: ${list(restart.reasons).join(", ")}`]);
    if (number(session.uptime_hours) >= 7 * 24) out.push(["warn", `Not restarted for ${Math.floor(session.uptime_hours / 24)} days`]);
    if (events.bluescreens?.count) out.push(["bad", `${plural(events.bluescreens.count, "blue screen")} ${period}`]);
    if (events.unexpected_shutdowns?.count) out.push(["warn", `${plural(events.unexpected_shutdowns.count, "unexpected shutdown")} ${period} (power loss or freeze)`]);
    if (events.disk_errors?.count) out.push(["bad", `${plural(events.disk_errors.count, "disk error")} ${period}: check the drive`]);
    for (const app of list(events.app_problems).filter((a) => a.crashes + a.hangs >= 3).slice(0, 3))
      out.push(["warn", `${app.app}: ${plural(app.crashes, "crash", "crashes")}, ${plural(app.hangs, "hang")}`]);
    if (updates.last_installed && Date.now() - Date.parse(updates.last_installed) > 45 * 86400000) out.push(["warn", `No update installed since ${day(updates.last_installed)}`]);
    if (list(session.users).length > 1) out.push(["warn", `${list(session.users).length} people signed in: ${list(session.users).join(", ")}`]);
    if (data.network !== null && network.length && !network.some((adapter) => list(adapter.gateway).length)) out.push(["warn", "No default gateway: the PC is not on a network"]);
    for (const adapter of network.filter((a) => !wireless(a) && !vpn(a) && number(a.speed_mbps) !== null && a.speed_mbps < 1000 && a.speed_mbps > 0))
      out.push(["warn", `${adapter.name} at ${adapter.speed_mbps} Mbps: check the cable or the dock`]);
    return out;
  }

  function renderCheckup() {
    const { pc, data } = state.checkup, host = pane("checkup"), session = data.session || {}, events = data.events || {};
    const restart = data.pending_reboot || {}, updates = data.updates || {}, network = list(data.network), found = findings(data);
    const uptime = number(session.uptime_hours), apps = list(events.app_problems), users = list(session.users);
    const crashes = (events.bluescreens?.count || 0) + (events.unexpected_shutdowns?.count || 0);
    const tiles = [
      ["Signed in", session.console_user ? String(session.console_user).split("\\").pop() : users.length ? String(users[0]).split("\\").pop() : "Nobody", users.length > 1 ? users.join(", ") : session.model || "", users.length > 1 ? "warn" : ""],
      ["Uptime", uptime === null ? "–" : uptime < 48 ? Math.round(uptime) + " h" : Math.floor(uptime / 24) + " days", session.last_boot ? "Since " + new Date(session.last_boot).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "", uptime === null ? "" : uptime >= 7 * 24 ? "warn" : "good"],
      ["Restart", data.pending_reboot ? (restart.pending ? "Pending" : "Not needed") : "–", list(restart.reasons).join(", "), data.pending_reboot ? (restart.pending ? "bad" : "good") : ""],
      ["Crashes", data.events ? String(crashes) : "–", data.events ? `${plural(events.bluescreens?.count || 0, "blue screen")} · ${events.unexpected_shutdowns?.count || 0} unexpected off` : "", data.events ? (events.bluescreens?.count ? "bad" : crashes ? "warn" : "good") : ""],
      ["Updates", updates.last_installed ? day(updates.last_installed) : "–", data.updates ? `${updates.last_30_days || 0} in the last 30 days` : "", updates.last_installed ? (Date.now() - Date.parse(updates.last_installed) > 45 * 86400000 ? "warn" : "good") : ""],
    ];
    host.innerHTML = `<div class="inbox-work-toolbar"><small>${esc(pc)} · checked ${esc(clock(data.checked_at || Date.now()))}${data.duration_ms ? " in " + Math.round(data.duration_ms / 1000) + " s" : ""}</small><span><label>Last <select data-work-checkup-days aria-label="Events from the last">${[1, 3, 7, 14, 30].map((n) => `<option value="${n}"${n === data.days ? " selected" : ""}>${plural(n, "day")}</option>`).join("")}</select></label><button type="button" data-work-rescan>Check again</button><button type="button" data-work-checkup-copy>Copy</button></span></div>
<div class="inbox-work-tiles">${tiles.map(([label, value, detail, level]) => `<div class="inbox-work-tile" data-tone="${level}" title="${esc(detail)}"><small>${esc(label)}</small><b>${esc(value)}</b><span>${esc(detail)}</span></div>`).join("")}</div>
${found.length ? `<ul class="inbox-work-findings" aria-label="What stands out">${found.map(([level, text]) => `<li data-tone="${level}">${esc(text)}</li>`).join("")}</ul>` : '<p class="inbox-work-chips"><span data-tone="good">Nothing stands out</span></p>'}
${restart.pending ? '<div class="inbox-work-toolbar"><small>A restart finishes installing what is waiting.</small><span><button type="button" data-work-act="restart">Restart later…</button><button type="button" data-work-act="message">Message…</button></span></div>' : ""}
${apps.length ? `<table class="inbox-work-processes inbox-work-apps"><thead><tr><th scope="col">Application</th><th scope="col">Crashes</th><th scope="col">Hangs</th><th scope="col">Last</th></tr></thead><tbody>${apps.map((app) => `<tr><td title="${esc(app.app)}">${esc(app.app || "Unknown")}</td><td data-tone="${app.crashes >= 3 ? "bad" : app.crashes ? "warn" : ""}">${esc(app.crashes)}</td><td data-tone="${app.hangs >= 3 ? "warn" : ""}">${esc(app.hangs)}</td><td>${esc(day(app.last))}</td></tr>`).join("")}</tbody></table>` : data.events ? `<p class="inbox-work-muted">No application crash or hang in the last ${plural(data.days, "day")}.</p>` : ""}
${network.length ? `<div class="inbox-work-toolbar"><b>Network (${network.length})</b></div><ul class="inbox-work-machines inbox-work-network">${network.map((adapter) => `<li><span><b>${esc(adapter.name)}</b><small>${esc(list(adapter.ip).filter((ip) => !ip.includes(":")).join(", ") || list(adapter.ip).join(", "))} · ${adapter.dhcp ? "DHCP" : "Static"}${adapter.suffix ? " · " + esc(adapter.suffix) : ""}</small><small>Gateway ${esc(list(adapter.gateway).join(", ") || "none")} · DNS ${esc(list(adapter.dns).join(", ") || "none")}</small></span><span><small>${number(adapter.speed_mbps) === null ? "" : esc(adapter.speed_mbps >= 1000 ? adapter.speed_mbps / 1000 + " Gbps" : adapter.speed_mbps + " Mbps")}</small><small>${esc(adapter.mac)}</small></span></li>`).join("")}</ul>` : ""}
${list(updates.recent).length ? `<details class="inbox-work-details"><summary>Latest updates (${list(updates.recent).length})</summary><dl>${list(updates.recent).map((update) => `<dt>${esc(update.kb)}</dt><dd>${esc(day(update.installed))} · ${esc(update.description)}</dd>`).join("")}</dl></details>` : ""}
${list(data.errors).length ? `<details class="inbox-work-details"><summary>Not checked (${list(data.errors).length})</summary><ul class="inbox-work-notes">${list(data.errors).map((text) => `<li>${esc(text)}</li>`).join("")}</ul></details>` : ""}`;
  }

  function checkupText() {
    const { pc, data } = state.checkup, session = data.session || {}, found = findings(data);
    return [`Check-up of ${pc}, ${new Date(data.checked_at || Date.now()).toLocaleString()} (last ${plural(data.days, "day")})`,
      session.console_user ? "Signed in: " + session.console_user : "", number(session.uptime_hours) === null ? "" : `Uptime: ${Math.floor(session.uptime_hours / 24)} days ${Math.round(session.uptime_hours % 24)} h`,
      ...(found.length ? found.map(([, text]) => "- " + text) : ["Nothing stands out."])].filter(Boolean).join("\n");
  }

  // PC actions: a message on screen and a restart later open a small form under the tools.
  function actionForm(kind) {
    const host = dock.querySelector("[data-work-form]"), pc = state.machine;
    if (!pc) return;
    if (!host.hidden && host.dataset.kind === kind) return closeForm();
    host.dataset.kind = kind;
    host.hidden = false;
    host.innerHTML = kind === "message"
      ? `<form data-work-send-message><div class="inbox-work-toolbar"><b>Message on ${esc(pc)}'s screen</b><button type="button" data-work-form-close aria-label="Close">×</button></div>
<div class="inbox-work-templates" role="group" aria-label="Ready messages">${SCREEN.map(([label], i) => `<button type="button" data-work-screen="${i}">${esc(label)}</button>`).join("")}</div>
<textarea name="text" rows="2" maxlength="255" required aria-label="Message text" placeholder="What everyone signed in to ${esc(pc)} sees, in a Windows message box"></textarea>
<div class="inbox-work-toolbar"><label>Show for <select name="seconds"><option value="60">1 minute</option><option value="300" selected>5 minutes</option><option value="900">15 minutes</option><option value="3600">1 hour</option></select></label><button type="submit" class="primary">Send to screen</button></div></form>`
      : `<form data-work-schedule-restart><div class="inbox-work-toolbar"><b>Restart ${esc(pc)} later</b><button type="button" data-work-form-close aria-label="Close">×</button></div>
<div class="inbox-work-toolbar"><span><label>In <select name="minutes">${[5, 15, 30, 60, 120].map((m) => `<option value="${m}"${m === 15 ? " selected" : ""}>${m < 60 ? m + " minutes" : m / 60 + " hour" + (m > 60 ? "s" : "")}</option>`).join("")}</select></label><label>or at <input type="time" name="at" aria-label="Restart at"></label></span></div>
<input name="message" maxlength="200" aria-label="Warning shown on the PC" value="IT support will restart your PC. Please save your work.">
<div class="inbox-work-toolbar"><small>Windows warns whoever is signed in and counts down.</small><span><button type="button" data-work-restart-cancel>Cancel a planned restart</button><button type="submit" class="primary">Schedule restart</button></span></div></form>`;
    host.querySelector("textarea, select").focus();
  }

  function closeForm() {
    const host = dock?.querySelector("[data-work-form]");
    if (!host) return;
    host.hidden = true;
    host.dataset.kind = "";
    host.replaceChildren();
  }

  async function sendMessage(form) {
    const text = form.elements.text.value.replace(/\s+/g, " ").trim();
    if (!text) return toast("Write the message first.");
    const result = await post("/api/support/message", { computer: state.machine, text, seconds: Number(form.elements.seconds.value) });
    logWork(`Message shown on ${result.computer}: "${text}"`);
    closeForm();
    toast(`Message sent to ${result.computer}'s screen`);
  }

  async function scheduleRestart(form) {
    const at = form.elements.at.value, message = form.elements.message.value.replace(/\s+/g, " ").trim();
    const result = await post("/api/support/restart", { computer: state.machine, message, ...(at ? { at } : { minutes: Number(form.elements.minutes.value) }) });
    const when = clock(Date.now() + result.seconds * 1000);
    logWork(`Restart of ${result.computer} planned for ${when}`);
    closeForm();
    toast(`${result.computer} restarts at ${when}. Restart later… → Cancel a planned restart stops it.`);
  }

  async function cancelRestart() {
    const result = await post("/api/support/restart/cancel", { computer: state.machine });
    logWork(`Planned restart of ${result.computer} cancelled`);
    closeForm();
    toast(`${result.computer}: any planned restart is cancelled`);
  }

  async function gpupdate() {
    const result = await post("/api/support/gpupdate", { computer: state.machine });
    logWork(`Group Policy refresh started on ${result.computer}`);
    toast(`Group Policy refresh started on ${result.computer}; it takes a minute or two.`);
  }

  async function performance() {
    const host = pane("performance"), pc = state.machine;
    state.done.performance = pc;
    busy(host, `Sampling CPU, memory, disk and processes on ${pc}… this can take up to a minute.`);
    try {
      const data = await window.AtlasClient.request(`/api/performance/${encodeURIComponent(pc)}?kind=overview`);
      if (state.machine !== pc) return;
      if (!data || data.ok === false || !Array.isArray(data.items)) throw Error(data?.error || `Atlas could not read performance counters on ${pc}.`);
      state.performance = { pc, data, sort: "CPU" };
      renderPerformance();
    } catch (error) {
      if (state.machine !== pc) return;
      delete state.done.performance;
      failed(host, error);
    } finally {
      host.removeAttribute("aria-busy");
    }
  }

  function renderPerformance() {
    const { pc, data, sort } = state.performance, s = data.summary || {}, host = pane("performance");
    const volume = (s.volumes || []).find((v) => /^C:/i.test(v.name || "")) || (s.volumes || [])[0];
    const disk = (s.disks || [])[0], latency = disk ? Math.max(number(disk.read_ms) || 0, number(disk.write_ms) || 0) : null;
    const used = number(s.total_memory_bytes) !== null && number(s.available_memory_bytes) !== null ? s.total_memory_bytes - s.available_memory_bytes : null;
    const uptime = number(s.uptime_seconds);
    const tiles = [
      ["CPU", percent(s.cpu_percent), s.logical_processors ? s.logical_processors + " logical processors" : "", tone(s.cpu_percent, 70, 85)],
      ["Memory", percent(s.memory_percent), used === null ? "" : `${gib(used)} of ${gib(s.total_memory_bytes)} GiB in use`, tone(s.memory_percent, 70, 80)],
      ["C: free", volume ? percent(volume.free_percent) : "–", volume ? `${gib(volume.free_bytes)} of ${gib(volume.total_bytes)} GiB free` : "", volume ? tone(100 - volume.free_percent, 80, 90) : ""],
      ["Disk", latency === null ? "–" : latency.toFixed(0) + " ms", disk ? `Read ${number(disk.read_ms)?.toFixed(0) ?? "–"} ms · write ${number(disk.write_ms)?.toFixed(0) ?? "–"} ms · queue ${disk.queue ?? "–"}` : "", tone(latency, 10, 20)],
      ["Uptime", uptime === null ? "–" : `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h`, s.os || "", uptime === null ? "" : uptime > 8 * 86400 ? "warn" : "good"],
    ];
    const notes = typeof performanceInsights === "function" ? performanceInsights(s) : [];
    const key = sort === "Memory" ? "MemoryBytes" : "CPU";
    const rows = [...data.items].sort((a, b) => (number(b[key]) ?? -1) - (number(a[key]) ?? -1)).slice(0, 12);
    host.innerHTML = `<div class="inbox-work-toolbar"><small>${esc(pc)} · sampled ${esc(new Date(data.checked_at || Date.now()).toLocaleTimeString())} · ${esc(data.total_processes ?? data.items.length)} processes</small><span><button type="button" data-work-rescan>Scan again</button><button type="button" data-work-admin>Remote Admin ↗</button></span></div>
<div class="inbox-work-tiles">${tiles.map(([label, value, detail, level]) => `<div class="inbox-work-tile" data-tone="${level}" title="${esc(detail)}"><small>${esc(label)}</small><b>${esc(value)}</b><span>${esc(detail)}</span></div>`).join("")}</div>
${notes.length ? `<details class="inbox-work-details" open><summary>What stands out (${notes.length})</summary><ul class="inbox-work-notes">${notes.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></details>` : '<p class="inbox-work-muted">No pressure found in this sample.</p>'}
<div class="inbox-work-toolbar"><b>Top processes</b><span role="group" aria-label="Sort processes">${["CPU", "Memory"].map((label) => `<button type="button" data-work-sort="${label}" aria-pressed="${sort === label}">By ${label === "CPU" ? label : label.toLowerCase()}</button>`).join("")}</span></div>
<table class="inbox-work-processes"><thead><tr><th scope="col">Process</th><th scope="col">PID</th><th scope="col">CPU</th><th scope="col">Memory</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map((row) => `<tr><td title="${esc(row.CommandLine || row.Process)}">${esc(row.Process)}</td><td>${esc(row.PID)}</td><td data-tone="${tone(row.CPU, 10, 25)}">${number(row.CPU) === null ? "–" : number(row.CPU).toFixed(1) + "%"}</td><td>${number(row.MemoryBytes) === null ? "–" : (row.MemoryBytes / 1024 ** 2 >= 1024 ? gib(row.MemoryBytes) + " GiB" : Math.round(row.MemoryBytes / 1024 ** 2) + " MB")}</td><td>${row.CanTerminate === false ? `<small title="${esc(row.BlockReason || "Protected process")}">Protected</small>` : `<button type="button" data-work-end="${esc(row.PID)}" aria-label="End ${esc(row.Process)} (PID ${esc(row.PID)})">End…</button>`}</td></tr>`).join("")}</tbody></table>
${(data.warnings || []).map((text) => `<p class="inbox-work-muted">${esc(text)}</p>`).join("")}`;
  }

  async function endProcess(pid) {
    const sample = state.performance, row = sample?.data.items.find((item) => String(item.PID) === pid);
    if (!row || sample.pc !== state.machine) return toast("The process list changed. Scan again first.");
    if (!confirm(`End ${row.Process} (PID ${row.PID}) on ${sample.pc}? Unsaved work in it will be lost.`)) return;
    const result = await post("/api/kill", { computer: sample.pc, value: String(row.PID), created: row.CreatedAt, name: row.Process });
    const problems = (result.results || []).filter((item) => item.state !== "terminated");
    if (result.count) logWork(`Ended ${row.Process} (PID ${row.PID}) on ${sample.pc}`);
    toast(`${sample.pc}: ${result.count || 0} ended${problems.length ? "; " + problems.map((item) => `${item.Process} (${item.PID}): ${item.message}`).join("; ") : result.count ? "" : "; it is no longer running"}`);
    if (result.count && state.machine === sample.pc) await performance();
  }

  const adLookup = (kind, identity) => post("/api/active-directory/lookup", { kind, identity, server: document.getElementById("adServer")?.value.trim() || "" });

  async function groups(kind, id) {
    const tab = kind === "user" ? "user-groups" : "machine-groups", host = pane(tab), key = kind + ":" + id;
    state.done[tab] = key;
    busy(host, `Looking up ${id} in Active Directory…`);
    try {
      const result = await adLookup(kind, id);
      if (state.done[tab] !== key) return;
      state.groups[tab] = { kind, id, result };
      renderGroups(tab);
    } catch (error) {
      if (state.done[tab] !== key) return;
      delete state.done[tab];
      failed(host, error);
    } finally {
      host.removeAttribute("aria-busy");
    }
  }

  const shown = (value) => (value === true ? "Yes" : value === false ? "No" : value === null || value === undefined || value === "" ? "–" : typeof value === "object" ? JSON.stringify(value) : String(value));
  const groupList = (list) => `<ul class="inbox-work-groups">${list.map((group) => `<li data-group="${esc(String(group.name).toLowerCase())}" title="${esc(group.description || group.dn || "")}"><span>${esc(group.name)}</span><small data-membership="${esc(group.membership)}">${esc(group.membership || "")}</small><small>${esc([group.category, group.scope].filter(Boolean).join(" · "))}</small></li>`).join("")}</ul>`;

  function renderGroups(tab) {
    const { kind, id, result } = state.groups[tab], details = result.details || {}, host = pane(tab);
    // Only the checks AD returned are reported; computers have no lock-out or password fields.
    const checks = [
      ["Enabled", (v) => v === false, "Disabled", "enabled"],
      ["Locked out", (v) => v === true, "Locked out", "not locked"],
      ["Password expired", (v) => v === true, "Password expired", "password valid"],
      ["Account expiration", (v) => !!v && Date.parse(v) < Date.now(), "Account expired", "not expired"],
    ].filter(([field]) => field in details);
    const problems = checks.filter(([field, bad]) => bad(details[field])).map(([, , label]) => label);
    const expires = Date.parse(details["Password expires"] || ""), left = Number.isFinite(expires) ? Math.floor((expires - Date.now()) / 86400000) : null;
    const expiry = left === null || details["Password expired"] === true ? ""
      : `<span data-tone="${left < 0 ? "bad" : left <= 7 ? "warn" : "good"}" title="${esc(new Date(expires).toLocaleString())}">${left < 0 ? "Password expired" : left === 0 ? "Password expires today" : `Password expires in ${plural(left, "day")}`}</span>`;
    const locked = kind === "user" && details["Locked out"] === true;
    const list = [...(result.groups || [])].sort((a, b) => (MEMBERSHIP[a.membership] ?? 3) - (MEMBERSHIP[b.membership] ?? 3) || String(a.name).localeCompare(String(b.name)));
    const count = (type) => list.filter((group) => group.membership === type).length;
    // Colleagues in the request are offered for "same access as…".
    const others = kind === "user" ? requestEntries().people.filter((p) => account(p.user) && account(p.user) !== account(state.user)) : [];
    host.innerHTML = `<div class="inbox-work-toolbar"><small>${esc(kind === "user" ? "Account" : "Computer")} ${esc(details.Account || details.Name || id)} · ${esc(result.server || "default domain")}</small><span><button type="button" data-work-rescan>Look up again</button><button type="button" data-work-ad>Active Directory ↗</button></span></div>
<p class="inbox-work-chips">${problems.length ? problems.map((label) => `<span data-tone="bad">${esc(label)}</span>`).join("") : checks.length ? `<span data-tone="good">${esc(checks.map(([, , , good]) => good).join(" · "))}</span>` : ""}${expiry}${locked ? '<button type="button" class="primary" data-work-unlock>Unlock account</button>' : ""}</p>
<details class="inbox-work-details"><summary>${kind === "user" ? "Account" : "Computer"} details (${Object.keys(details).length})</summary><dl>${Object.entries(details).map(([field, value]) => `<dt>${esc(field)}</dt><dd>${esc(shown(value))}</dd>`).join("")}</dl></details>
${kind === "computer" ? '<div class="inbox-work-bitlocker" data-work-bitlocker><div class="inbox-work-toolbar"><b>BitLocker recovery</b><button type="button" data-work-bitlocker-show>Show recovery keys</button></div></div>' : ""}
${kind === "user" ? `<form class="inbox-work-compare" data-work-compare-form><b>Compare with</b>${others.map((p) => `<button type="button" data-work-compare-with="${esc(account(p.user))}">${esc(p.label)}</button>`).join("")}<input name="other" placeholder="Account or email" aria-label="Compare groups with" autocomplete="off" /><button type="submit">Compare</button></form><div data-work-compare-result></div>` : ""}
<div class="inbox-work-toolbar"><b>${list.length} groups</b><small>${count("Direct")} direct · ${count("Primary")} primary · ${count("Nested")} nested</small></div>
<div class="inbox-work-filter"><input type="search" data-work-filter placeholder="Filter groups" aria-label="Filter groups" autocomplete="off" /><button type="button" data-work-copy>Copy names</button></div>
${groupList(list)}
<p class="inbox-work-muted" data-work-hidden hidden></p>
${(result.warnings || []).map((text) => `<p class="inbox-work-muted">${esc(text)}</p>`).join("")}`;
    if (kind === "computer" && state.keys?.pc === state.machine) renderKeys();
  }

  // "Same access as…": groups the colleague has that this person lacks, and the other way round.
  async function compare(identity) {
    identity = String(identity || "").trim();
    const base = state.groups["user-groups"], host = pane("user-groups").querySelector("[data-work-compare-result]");
    if (!identity || !base || !host) return;
    busy(host, `Looking up ${identity} in Active Directory…`);
    try {
      const other = await adLookup("user", identity);
      if (state.groups["user-groups"] !== base) return;
      const names = (result) => new Set((result.groups || []).map((group) => String(group.name).toLowerCase()));
      const mine = names(base.result), theirs = names(other);
      const missing = (other.groups || []).filter((group) => !mine.has(String(group.name).toLowerCase()) && group.membership !== "Primary");
      const extra = (base.result.groups || []).filter((group) => !theirs.has(String(group.name).toLowerCase()) && group.membership !== "Primary");
      const label = other.details?.Name || other.details?.Account || identity, me = fullName(state.user);
      host.innerHTML = `<div class="inbox-work-toolbar"><b>${esc(label)} has, ${esc(me)} lacks (${missing.length})</b>${missing.length ? '<button type="button" data-work-copy-missing>Copy</button>' : ""}</div>
${missing.length ? groupList(missing).replace('class="inbox-work-groups"', 'class="inbox-work-groups" data-compare="missing"') : '<p class="inbox-work-muted">Nothing missing.</p>'}
<details class="inbox-work-details"><summary>Only ${esc(me)} has (${extra.length})</summary>${groupList(extra)}</details>
<p class="inbox-work-muted">${mine.size - extra.length} group${mine.size - extra.length === 1 ? "" : "s"} in common.</p>`;
      state.missing = missing.map((group) => group.name);
    } catch (error) {
      host.innerHTML = `<p class="inbox-work-error" role="alert">${esc(error.message)}</p>`;
    } finally {
      host.removeAttribute("aria-busy");
    }
  }

  function filterGroups(input) {
    const host = input.closest("[data-work-pane]"), term = input.value.trim().toLowerCase();
    let hidden = 0;
    host.querySelectorAll(":scope > .inbox-work-groups [data-group]").forEach((row) => { row.hidden = !!term && !row.dataset.group.includes(term); hidden += row.hidden; });
    const note = host.querySelector("[data-work-hidden]");
    note.hidden = !hidden;
    note.textContent = hidden ? `${hidden} group${hidden === 1 ? "" : "s"} hidden by the filter.` : "";
  }

  async function knowledge() {
    const id = state.document, host = pane("knowledge");
    state.done.knowledge = id;
    if (!String(id).startsWith("article:")) {
      host.innerHTML = '<p class="inbox-work-muted">This Knowledge Base entry is a diagram; it opens in the diagram viewer.</p><button type="button" data-work-kb-open>Open diagram ↗</button>';
      return;
    }
    busy(host, "Opening the article…");
    try {
      const article = await window.AtlasClient.request("/api/knowledge/articles/" + encodeURIComponent(id.slice(8)));
      if (state.done.knowledge !== id) return;
      state.article = article;
      const tags = Array.isArray(article.tags) ? article.tags : [];
      host.innerHTML = `<div class="inbox-work-toolbar"><b>${esc(article.title)}</b><span><button type="button" data-work-kb-copy>Copy text</button><button type="button" data-work-kb-open>Knowledge Base ↗</button></span></div>${tags.length ? `<p class="inbox-work-muted">${esc(tags.join(" · "))}</p>` : ""}<div class="kb-markdown inbox-work-article"></div>`;
      const body = host.querySelector(".inbox-work-article");
      if (window.AtlasKnowledgeArticles?.render) await window.AtlasKnowledgeArticles.render(article.markdown, body);
      else body.textContent = article.markdown;
    } catch (error) {
      if (state.done.knowledge !== id) return;
      delete state.done.knowledge;
      failed(host, error);
    } finally {
      host.removeAttribute("aria-busy");
    }
  }

  // Notes: shared notes on the person and the PC (kept by Atlas), and this request's work log
  // (kept in this browser), which "Copy for ticket" turns into text for the ticket.
  async function renderNotes(mode) {
    const host = pane("notes"), who = noteKey(state.user), pc = state.machine, key = `${who}|${pc}|${logId()}`;
    if (mode !== "scan" && state.done.notes === key && host.querySelector("[data-work-log]")) return renderLog();
    state.done.notes = key;
    busy(host, "Loading notes…");
    try {
      const data = who || pc ? await window.AtlasClient.request("/api/support/notes?" + new URLSearchParams({ user: who, machine: pc })) : {};
      if (state.done.notes !== key) return;
      const box = (kind, id, label, value) => (id ? `<form class="inbox-work-note" data-work-note="${kind}" data-key="${esc(id)}"><div class="inbox-work-toolbar"><b>${esc(label)}</b><small data-work-note-status>${value ? esc(`Saved ${day(value.updated)} ${clock(value.updated)}${value.by ? " by " + value.by : ""}`) : "Shared with everyone using Atlas Admin"}</small></div><textarea name="text" rows="3" maxlength="4000" aria-label="${esc(label)}" placeholder="${kind === "user" ? "Preferences, VIP, recurring problems, who to call…" : "Hardware swaps, known faults, special setup…"}">${esc(value?.text || "")}</textarea><div class="inbox-work-toolbar"><span></span><button type="submit">Save note</button></div></form>` : "");
      host.innerHTML = `${box("user", who, `Note on ${fullName(state.user)}`, data.user)}${box("machine", pc, `Note on ${pc}`, data.machine)}<section class="inbox-work-pane" data-work-log></section>`;
      renderLog();
    } catch (error) {
      if (state.done.notes !== key) return;
      delete state.done.notes;
      failed(host, error);
    } finally {
      host.removeAttribute("aria-busy");
    }
  }

  async function saveNote(form) {
    const kind = form.dataset.workNote, key = form.dataset.key, text = form.elements.text.value.trim();
    const result = await post("/api/support/notes", { kind, key, text }, "PUT");
    form.querySelector("[data-work-note-status]").textContent = result.note ? `Saved ${clock(result.note.updated)}${result.note.by ? " by " + result.note.by : ""}` : "Note removed";
    if (kind === "user" && state.person && noteKey(state.person.user) === key) { state.person.note = result.note; renderPerson(); }
  }

  function worklog() {
    try { return JSON.parse(localStorage.getItem(LOG)) || {}; } catch { return {}; }
  }
  const logId = () => String(state.context?.log || req()?.message?.id || "general");

  // What was done from these tools, for the message on screen; the latest 100 requests are kept.
  function logWork(text) {
    const all = worklog(), id = logId();
    (all[id] ||= []).push({ at: new Date().toISOString(), text });
    const ids = Object.keys(all);
    for (const old of ids.slice(0, Math.max(0, ids.length - 100))) delete all[old];
    try { localStorage.setItem(LOG, JSON.stringify(all)); } catch { /* Private window: the log lasts until the page is reloaded. */ }
    renderLog();
  }

  function renderLog() {
    const host = dock && pane("notes").querySelector("[data-work-log]");
    if (!host) return;
    const entries = worklog()[logId()] || [], message = req()?.message;
    host.innerHTML = `<div class="inbox-work-toolbar"><b>Work log${message ? " for this request" : state.context ? " for this copy" : ""} (${entries.length})</b><span><button type="button" class="primary" data-work-log-copy>Copy for ticket</button>${entries.length ? '<button type="button" data-work-log-clear>Clear</button>' : ""}</span></div>
${entries.length ? `<ol class="inbox-work-log">${entries.map((entry) => `<li><time datetime="${esc(entry.at)}">${esc(clock(entry.at))}</time><span>${esc(entry.text)}</span></li>`).join("")}</ol>` : '<p class="inbox-work-muted">Check-ups, messages, restarts, unlocks, BitLocker keys and replies done from these tools are listed here.</p>'}
<form class="inbox-work-lookup" data-work-log-add><input name="text" maxlength="300" placeholder="Add a line: called the user, problem confirmed…" aria-label="Add to the work log" autocomplete="off" /><button type="submit">Add</button></form>`;
  }

  async function addLog(form) {
    const text = form.elements.text.value.replace(/\s+/g, " ").trim();
    if (!text) return;
    logWork(text);
    pane("notes").querySelector("[data-work-log-add] input")?.focus();
  }

  function ticketText() {
    const message = req()?.message, user = req()?.match?.user || state.user, entries = worklog()[logId()] || [];
    return [message ? `Request: ${message.subject || "(no subject)"}` : state.context?.title ? `About: ${state.context.title}` : "",
      message ? `From: ${message.sender_name || message.sender_address}${message.received_at ? ", " + new Date(message.received_at).toLocaleString() : ""}` : "",
      user ? `User: ${[fullName(user), user.user_name].filter((value, i, all) => value && all.indexOf(value) === i).join(" · ")}` : "",
      state.machine ? `PC: ${state.machine}` : "",
      entries.length ? "\nWork done:\n" + entries.map((entry) => `${clock(entry.at)}  ${entry.text}`).join("\n") : ""].filter(Boolean).join("\n");
  }

  // Unlock the account the User groups lookup shows as locked out, then look it up again.
  async function unlock() {
    const base = state.groups["user-groups"], identity = base.result.details?.Account || base.id;
    const result = await post("/api/support/unlock", { identity, server: adServer() });
    const name = result.account || identity;
    if (result.locked) return toast(`${name} is still locked out: the domain controller may not have replicated yet. Try again in a minute.`);
    logWork(`AD account ${name} unlocked`);
    toast(`${name} is unlocked`);
    if (state.groups["user-groups"] === base) await groups("user", base.id);
  }

  // BitLocker recovery keys of the selected PC, from Active Directory: the PC can be offline.
  async function bitlocker() {
    const pc = state.machine, host = pane("machine-groups").querySelector("[data-work-bitlocker]");
    if (!host) return;
    busy(host, `Reading the BitLocker recovery keys of ${pc} in Active Directory…`);
    try {
      const result = await post("/api/support/bitlocker", { computer: pc, server: adServer() });
      if (state.machine !== pc) return;
      state.keys = { pc, keys: [...list(result.keys)].sort((a, b) => String(b.created).localeCompare(String(a.created))) };
      renderKeys();
    } catch (error) {
      if (state.machine !== pc) return;
      host.innerHTML = `<p class="inbox-work-error" role="alert">${esc(error.message)}</p><button type="button" data-work-bitlocker-show>Try again</button>`;
    } finally {
      host.removeAttribute("aria-busy");
    }
  }

  function renderKeys() {
    const host = pane("machine-groups").querySelector("[data-work-bitlocker]"), { pc, keys } = state.keys;
    if (!host) return;
    host.innerHTML = `<div class="inbox-work-toolbar"><b>BitLocker recovery keys (${keys.length})</b>${keys.length > 1 ? '<input type="search" data-work-key-filter placeholder="Key ID on the screen" aria-label="Find the key by the ID shown on the PC" autocomplete="off" spellcheck="false" />' : ""}</div>
${keys.length ? `<ul class="inbox-work-keys">${keys.map((key, i) => `<li data-key-id="${esc(String(key.id).replace(/[^0-9a-f]/gi, "").toUpperCase())}"><span><b>${esc(String(key.id).slice(0, 8).toUpperCase())}</b><small>${esc(day(key.created))}</small></span><code>${halves(key.password)}</code><button type="button" data-work-key-copy="${i}" aria-label="Copy recovery key ${esc(String(key.id).slice(0, 8))}">Copy</button></li>`).join("")}</ul>
<p class="inbox-work-muted">Match the first 8 characters of the Key ID on the BitLocker screen, then read out the 48 digits.</p>` : `<p class="inbox-work-muted">Active Directory has no BitLocker recovery key for ${esc(pc)}: its key may be kept in Intune or MBAM.</p>`}`;
  }

  // The 48 digits wrap between their two halves, never inside a group of six.
  const halves = (password) => {
    const groups = String(password || "").split("-");
    return groups.length === 8 ? `<span>${esc(groups.slice(0, 4).join("-"))}-</span><span>${esc(groups.slice(4).join("-"))}</span>` : esc(password);
  };

  function filterKeys(value) {
    const term = String(value || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
    pane("machine-groups").querySelectorAll("[data-key-id]").forEach((row) => {
      const match = !!term && row.dataset.keyId.startsWith(term);
      row.hidden = !!term && !match;
      row.toggleAttribute("data-match", match);
    });
  }

  function invalidateLookup() {
    lookupGeneration++;
    state.results = null;
    const host = dock?.querySelector("[data-work-results]");
    if (host) { host.hidden = true; host.removeAttribute("aria-busy"); }
  }

  // Anyone in Atlas: only the latest lookup in the current request can select a result.
  async function lookup(term) {
    invalidateLookup();
    const generation = lookupGeneration;
    const current = () => generation === lookupGeneration && !dock.hidden && inbox()?.classList.contains("active");
    term = String(term || "").trim();
    const host = dock.querySelector("[data-work-results]");
    if (!term) { host.hidden = true; return; }
    host.hidden = false;
    busy(host, `Looking up ${term}…`);
    try {
      const result = await window.AtlasClient.request("/api/search?term=" + encodeURIComponent(term));
      if (!current()) return;
      const users = (result.users || []).slice(0, 8), machines = (result.machines || []).slice(0, 8);
      state.results = { users, machines };
      if (users.length + machines.length === 1) {
        host.hidden = true;
        return users.length ? open({ user: users[0] }, "person") : open({ machine: machineName(machines[0]) }, "health", "quick");
      }
      host.innerHTML = users.length + machines.length
        ? `${users.map((u, i) => `<button type="button" data-work-pick-user="${i}"><b>${esc(fullName(u))}</b><small>${esc([u.user_name, u.email, u.department].filter(Boolean).join(" · "))}</small></button>`).join("")}${machines.map((m, i) => `<button type="button" data-work-pick-machine="${i}"><b>${esc(machineName(m))}</b><small>${esc([m.device_kind, m.model_id].filter(Boolean).join(" · "))}</small></button>`).join("")}${(result.users || []).length + (result.machines || []).length > users.length + machines.length ? '<p class="inbox-work-muted">More matches: refine the search.</p>' : ""}`
        : `<p class="inbox-work-muted">Nobody and no PC in Atlas matches "${esc(term)}".</p>`;
    } catch (error) {
      if (!current()) return;
      host.innerHTML = `<p class="inbox-work-error" role="alert">${esc(error.message)}</p>`;
    } finally {
      if (current()) host.removeAttribute("aria-busy");
    }
  }

  // The Workspace deployment panel moves here once Deploy is opened and stays while the tools
  // are open, so every deployment control (package, script, Install/Repair/Uninstall, queue,
  // progress) works unchanged and a half-chosen package survives switching tools.
  function dockDeployment() {
    const panel = document.getElementById("deploymentPanel");
    if (!panel) return;
    pane("deploy").querySelector("[data-work-deploy-note]")?.remove();
    if (state.floating && document.getElementById("workspace")?.classList.contains("active")) {
      undock();
      pane("deploy").insertAdjacentHTML("afterbegin", `<p class="inbox-work-muted" data-work-deploy-note>The deployment panel is on this Workspace page, set to ${esc(state.machine)}.</p>`);
      syncDeploymentPanel({ selection: true });
      return panel.scrollIntoView?.({ block: "nearest" });
    }
    if (!home) home = { parent: panel.parentNode, next: panel.nextSibling };
    if (panel.parentNode !== pane("deploy")) pane("deploy").append(panel);
    state.docked = true;
    syncDeploymentPanel({ selection: true });
  }

  // sync=false when leaving Live Inbox: page() syncs once the next page is active.
  function undock(sync = true) {
    const panel = document.getElementById("deploymentPanel");
    if (!home || !panel || panel.parentNode === home.parent) return;
    home.parent.insertBefore(panel, home.next?.parentNode === home.parent ? home.next : null);
    if (sync) syncDeploymentPanel();
  }

  function close() {
    invalidateLookup();
    undock();
    state.docked = false;
    state.context = null;
    const host = dock.querySelector("[data-work-health]");
    if (host) window.AtlasHealth?.cancel(host);
    dock.hidden = true;
  }

  // Switching PC keeps the same PC tool on screen.
  function switchMachine(name, owner) {
    const user = owner === undefined ? state.user : owner;
    use(name, user);
    const needs = TABS.find(([tab]) => tab === state.tab)[2];
    show(needs === "machine" || needs === "any" ? state.tab : "health", "show");
  }

  async function click(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled || !dock.contains(button) || button.type === "submit") return;
    const data = button.dataset, detail = { machine: state.machine, user: state.user };
    if ("workClose" in data) return close();
    if (data.workTab) return show(data.workTab);
    if (data.workTabLink) return show(data.workTabLink);
    if ("workRescan" in data) return show(state.tab, "scan");
    if (data.workPerson) return open({ user: requestEntries().people[Number(data.workPerson)].user }, state.tab === "user-groups" ? "user-groups" : "person");
    if (data.workMachine) {
      const entry = requestEntries().machines[Number(data.workMachine)];
      return switchMachine(entry.name, entry.owner);
    }
    if (data.workPickUser) { dock.querySelector("[data-work-results]").hidden = true; return open({ user: state.results.users[Number(data.workPickUser)] }, "person"); }
    if (data.workPickMachine) { dock.querySelector("[data-work-results]").hidden = true; return open({ machine: machineName(state.results.machines[Number(data.workPickMachine)]) }, "health", "quick"); }
    if (data.workUse) { use(data.workUse, state.user); return show(data.then || "health", data.then === "health" ? "quick" : "show"); }
    if (data.workSort) { state.performance.sort = data.workSort; return renderPerformance(); }
    if (data.workEnd) return endProcess(data.workEnd);
    if (data.workTool) { target(); return openTargetTool(data.workTool); }
    if ("workSoftware" in data) { target(); return loadSoftware(state.machine); }
    if ("workServices" in data) { target(); return window.AtlasServices?.load(); }
    if ("workSpecs" in data) return window.AtlasHealth.specs(state.machine);
    if ("workReboot" in data) return window.AtlasInboxActions.run({ ...detail, action: "reboot" });
    if (data.workAct) return actionForm(data.workAct);
    if ("workFormClose" in data) return closeForm();
    if (data.workScreen) {
      const box = dock.querySelector("[data-work-send-message] textarea");
      box.value = SCREEN[Number(data.workScreen)][1];
      return box.focus();
    }
    if ("workRestartCancel" in data) return whileBusy(button.form, cancelRestart);
    if ("workGpupdate" in data) return gpupdate();
    if ("workUnlock" in data) { button.disabled = true; try { return await unlock(); } finally { button.disabled = false; } }
    if ("workBitlockerShow" in data) return bitlocker();
    if (data.workKeyCopy) {
      const key = state.keys.keys[Number(data.workKeyCopy)];
      logWork(`BitLocker recovery key ${String(key.id).slice(0, 8).toUpperCase()} given for ${state.keys.pc}`);
      return copy(key.password, "Recovery key");
    }
    if ("workCheckupCopy" in data) return copy(checkupText(), "Check-up");
    if (data.workOpenMessage) return window.dispatchEvent(new CustomEvent("atlas:inbox-open", { detail: { id: Number(data.workOpenMessage) } }));
    if ("workLogCopy" in data) return copy(ticketText(), "Ticket text");
    if ("workLogClear" in data) {
      if (!confirm("Clear the work log of this request?")) return;
      const all = worklog();
      delete all[logId()];
      try { localStorage.setItem(LOG, JSON.stringify(all)); } catch { /* Nothing was stored. */ }
      return renderLog();
    }
    if ("workCompareWith" in data) return compare(data.workCompareWith);
    if ("workCopy" in data) {
      const names = [...button.closest("[data-work-pane]").querySelectorAll(":scope > .inbox-work-groups [data-group]:not([hidden]) > span:first-child")].map((node) => node.textContent);
      return copy(names.join("\n"), names.length + " group names");
    }
    if ("workCopyMissing" in data) return copy((state.missing || []).join("\n"), (state.missing || []).length + " missing groups");
    if ("workCopyPerson" in data) {
      const { user, machines = [], desks = [] } = state.person;
      return copy([fullName(user), ...RECORD.filter(([, key]) => user[key]).map(([label, key]) => `${label}: ${user[key]}`),
        desks.length ? "Desk: " + desks.map((desk) => desk.id).join(", ") : "", machines.length ? "PCs: " + machines.map(machineName).join(", ") : ""].filter(Boolean).join("\n"), "Person summary");
    }
    if ("workKbCopy" in data) return copy(state.article?.markdown || "", "Article");
    if (data.workLink) {
      const email = state.person?.user?.email || state.user?.email;
      return openLink(data.workLink === "mail" ? "mailto:" + email : teamsLink(data.workLink, email));
    }
    if (data.workLang || data.workTemplate) {
      const draft = drafts.get(req().message.id);
      if (data.workLang) { draft.lang = data.workLang; return renderReply(); }
      draft.text = fill(REPLIES[draft.lang].find(([key]) => key === data.workTemplate)[2], req(), draft.lang);
      const box = pane("reply").querySelector("[data-work-reply]");
      box.value = draft.text;
      return box.focus();
    }
    if ("workReplyOutlook" in data) return sendReply("outlook");
    if ("workReplyTeams" in data) return sendReply("teams");
    if ("workReplyMail" in data) return sendReply("mail");
    if ("workReplyCopy" in data) return copy(drafts.get(req().message.id).text, "Reply");
    if ("workKbOpen" in data) return window.AtlasKnowledge.show(state.document);
    if ("workAd" in data) {
      const { kind, id } = state.groups[state.tab];
      return window.AtlasAD.show(kind, id);
    }
    if ("workAdmin" in data) { target(); return page("admin"); }
    if ("workWorkspace" in data) {
      if (state.machine) target();
      page("workspace");
      if (state.user?.id && S.user?.id !== state.user.id) await loadUser("id:" + state.user.id);
    }
  }

  // The message on screen in Live Inbox (sent by live-inbox.jsx), for "In this request".
  window.addEventListener("atlas:inbox-detail", (event) => {
    const changed = event.detail?.message?.id !== state.request?.message?.id;
    if (changed) invalidateLookup();
    state.request = event.detail;
    renderRequest();
    if (dock) refreshTabs();
    if (changed && dock && !dock.hidden && state.tab === "reply" && req()?.message) renderReply();
    if (changed && dock && !dock.hidden && state.tab === "notes") renderNotes();
    // "Other requests" leaves out the message now on screen.
    if (changed && state.person) renderPerson();
  });

  // "Back to Live Inbox" after a Live Inbox button opened another page (Knowledge Base, Workspace,
  // Active Directory, Remote Admin). The sidebar does not show it.
  function returnButton(visible) {
    if (!back && !visible) return;
    if (!back) {
      back = document.createElement("button");
      back.type = "button";
      back.id = "inboxReturn";
      back.className = "inbox-return";
      back.textContent = "← Back to Live Inbox";
      back.onclick = () => page("inbox");
      document.body.append(back);
    }
    back.hidden = !visible;
  }
  // True only while a click inside Live Inbox is being handled, so page changes it causes are known.
  window.addEventListener("click", (event) => {
    inboxClick = !!event.target.closest?.("#inbox");
    if (inboxClick) setTimeout(() => { inboxClick = false; });
  }, true);
  window.addEventListener("click", () => { inboxClick = false; });

  const original = window.page;
  window.page = function (id) {
    const leaving = id !== "inbox" && !!inbox()?.classList.contains("active");
    // Back in Workspace before the switch, so the panel is never hidden with a package half chosen.
    if ((leaving && !state.floating) || (id === "workspace" && state.floating)) { if (!state.floating) invalidateLookup(); undock(false); }
    const result = original.apply(this, arguments);
    const floating = dock && !dock.hidden && state.floating;
    if (floating && id !== "inbox") {
      try { if (state.tab === "deploy") show("deploy"); } catch (error) { toast(error.message); }
    }
    if (id === "inbox") {
      returnButton(false);
      // Floating tools join the message as its third column.
      if (floating) { place(); state.context = null; refreshTabs(); renderRequest(); }
      try {
        // Deploy on screen takes the request's machine back; otherwise only re-dock when the target is unchanged.
        if (dock && !dock.hidden && state.docked) state.tab === "deploy" ? show("deploy") : S.target === state.machine && dockDeployment();
      } catch (error) {
        toast(error.message);
      }
    } else if (leaving && inboxClick) returnButton(true);
    return result;
  };

  window.AtlasInboxWork = { open, close, show, isOpen: () => !!dock && !dock.hidden && dock.isConnected, state: () => ({ machine: state.machine, tab: state.tab, user: state.user?.id, floating: state.floating }) };
  // The same tools from anywhere in Atlas Admin: the clipboard history, right-click menus, search.
  window.AtlasTools = { open, close, isOpen: window.AtlasInboxWork.isOpen };
})();
