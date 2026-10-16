/* Local Assistant settings and status, shared by the Knowledge Base and Live Inbox.
   The model runs on this PC through llama.cpp; Atlas starts and stops it. Admin only. */
(() => {
  if (window.AtlasAssistant) return;
  const api = (url, body) => window.AtlasClient.request(url, body === undefined ? undefined
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const listeners = new Set();
  let last = null;

  const describe = (s) => !s ? "Checking the Assistant…"
    : s.ready ? `Ready · ${s.model_name || "local model"}`
    : s.loading ? `Loading ${s.model_name || "the model"}… (first start takes up to a minute)`
    : s.configured ? `Stopped · starts by itself when you use it${s.error ? " · last error: " + s.error : ""}`
    : "Not set up yet";

  async function status() {
    try { last = await api("/api/assistant/status"); }
    catch (error) { last = { configured: false, ready: false, error: error.message, unavailable: true }; }
    listeners.forEach((listener) => listener(last));
    return last;
  }

  function field(label, input, hint) {
    const wrap = document.createElement("label");
    wrap.className = "assistant-field";
    wrap.append(label, input);
    if (hint) { const small = document.createElement("small"); small.textContent = hint; wrap.append(small); }
    return wrap;
  }
  const input = (value, props = {}) => Object.assign(document.createElement("input"), { value: value ?? "", ...props });

  async function openSettings() {
    if (window.AtlasReadOnly) return;
    const { element, body } = window.AtlasUI.dialog("Local Assistant");
    element.classList.add("assistant-dialog");
    const s = await status();
    const state = document.createElement("p");
    state.className = "assistant-state";
    state.setAttribute("role", "status");
    const indexed = document.createElement("p");
    indexed.className = "assistant-note";
    const show = (value) => {
      state.textContent = describe(value); state.dataset.ready = String(!!value?.ready);
      const i = value?.index || {};
      indexed.textContent = i.running ? `Indexing notes folders for Search everything… ${i.done || 0} of ${i.total || "?"} new or changed files`
        : i.items != null ? `Search everything knows ${Number(i.items).toLocaleString()} files from your notes folders.${i.error ? " Last problem: " + i.error : ""}` : "";
    };
    show(s);
    const intro = document.createElement("p");
    intro.className = "assistant-note";
    intro.textContent = "A small language model on this PC turns your notes into articles and reads requests. It only works on the text you give it, and Atlas checks every line against that text. Nothing leaves this PC.";
    // Files found in Atlas\\llm show as hints; the fields stay empty so saving does not pin them.
    const own = (value, found) => (value && value !== found ? value : "");
    const server = input(own(s.server, s.detected?.server), { placeholder: s.detected?.server || "C:\\Atlas\\llm\\llama-server.exe", spellcheck: false });
    const model = input(own(s.model, s.detected?.model), { placeholder: s.detected?.model || "C:\\Atlas\\llm\\Qwen3-4B-Instruct-2507-Q4_K_M.gguf", spellcheck: false });
    const folders = Object.assign(document.createElement("textarea"), { value: (s.folders || []).join("\n"), rows: 3, spellcheck: false,
      placeholder: "C:\\Users\\you\\Documents\\IT notes" });
    const layers = input(s.gpu_layers ?? 99, { type: "number", min: 0, max: 999 });
    const context = input(s.context ?? 8192, { type: "number", min: 2048, max: 131072, step: 1024 });
    const idle = input(s.idle_minutes ?? 30, { type: "number", min: 0, max: 1440 });
    const url = input(s.external ? s.url : "", { placeholder: "Only if you already run a model server, e.g. http://127.0.0.1:8080", spellcheck: false });
    const message = document.createElement("p");
    message.className = "assistant-note";
    message.setAttribute("role", "alert");
    const button = (label, onclick, primary) => Object.assign(document.createElement("button"), { type: "button", textContent: label, onclick, className: primary ? "primary" : "" });
    const run = (action) => async () => {
      message.textContent = "";
      try { show(await api("/api/assistant/" + action, {})); status(); }
      catch (error) { message.textContent = error.message; }
    };
    const save = async () => {
      message.textContent = "";
      try {
        const saved = await api("/api/assistant/settings", { server: server.value.trim(), model: model.value.trim(), url: url.value.trim(),
          gpu_layers: Number(layers.value), context: Number(context.value), idle_minutes: Number(idle.value),
          folders: folders.value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean) });
        show(saved); status(); window.toast?.("Assistant settings saved");
      } catch (error) { message.textContent = error.message; }
    };
    const advanced = document.createElement("details");
    advanced.className = "assistant-advanced";
    advanced.append(Object.assign(document.createElement("summary"), { textContent: "Graphics card and advanced" }),
      field("GPU layers", layers, "99 puts the whole model on the graphics card (8 GB is enough for 4B–8B models). 0 uses the processor only."),
      field("Context size", context, "How much text the model reads at once. 8192 fits 8 GB of video memory."),
      field("Stop when idle (minutes)", idle, "Frees the graphics card memory. 0 keeps it loaded."),
      field("Existing model server", url, "Leave empty: Atlas starts llama-server itself."));
    const help = document.createElement("details");
    help.className = "assistant-advanced";
    help.append(Object.assign(document.createElement("summary"), { textContent: "How to set it up (no Ollama needed)" }));
    const steps = document.createElement("ol");
    for (const text of [
      "Download llama.cpp for Windows from github.com/ggml-org/llama.cpp/releases: the \"win-cuda\" zip for an NVIDIA card (plus the matching cudart zip), or the \"win-vulkan\" zip for other cards.",
      "Unzip it into the Atlas\\llm folder.",
      "Download one model file (.gguf) into Atlas\\llm. For 8 GB: Qwen3-4B-Instruct-2507 Q4_K_M (fast, about 2.5 GB) or Qwen3-8B Q4_K_M (more careful, about 5 GB).",
      "Leave the paths above empty: Atlas finds them in Atlas\\llm. Add your notes folders, save, then click Start.",
      "No .exe allowed? Skip step 1 and double-click Install-Assistant.bat in the Atlas folder: it installs the llama-cpp-python library with pip. With an NVIDIA card use the Qwen2.5-7B-Instruct Q4_K_M model with it (that library cannot read Qwen3).",
    ]) steps.append(Object.assign(document.createElement("li"), { textContent: text }));
    help.append(steps);
    help.open = !s.configured;
    const actions = document.createElement("div");
    actions.className = "assistant-actions";
    actions.append(button("Save", save, true), button("Start", run("start")), button("Stop", run("stop")));
    body.append(intro, state, help,
      field("llama-server", server, s.detected?.server ? "Found in Atlas\\llm. Leave empty to use it." : "Path to llama-server.exe, or leave empty if it is in Atlas\\llm."),
      field("Model file (.gguf)", model, s.detected?.model ? "Found in Atlas\\llm. Leave empty to use it." : "Path to the .gguf model file."),
      field("Notes folders (one per line)", folders, "The Assistant and Search everything can read files here (txt, md, docx, pptx, xlsx, eml, html, pdf). Read only. A whole drive such as F:\\ works: system and program folders are skipped."),
      indexed,
      advanced, actions, message);
    const timer = setInterval(async () => { if (!element.isConnected) return clearInterval(timer); show(await status()); }, 3000);
    element.addEventListener("close", () => clearInterval(timer), { once: true });
  }

  window.AtlasAssistant = {
    status, openSettings, describe,
    get last() { return last; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    post: api,
  };
})();
