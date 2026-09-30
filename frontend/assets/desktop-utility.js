(() => {
  "use strict";
  const root = document.querySelector("#utility"),
    status = (s) => (document.querySelector("#utilityStatus").textContent = s),
    app = new URLSearchParams(location.search).get("app"),
    esc = (s) =>
      String(s).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  function load(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem("atlas-local-" + key)) ?? fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem("atlas-local-" + key, JSON.stringify(value));
      status("Saved on this browser only");
      return true;
    } catch {
      status(
        "Browser storage is full or unavailable. Export your work to keep it.",
      );
      return false;
    }
  }
  function download(name, text, type = "text/plain") {
    const a = document.createElement("a"),
      url = URL.createObjectURL(new Blob([text], { type }));
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function heading(title, description) {
    document.title = "Atlas · " + title;
    root.innerHTML = `<header><div><h1>${title}</h1><p>${description}</p></div></header>`;
  }
  function appearance() {
    try {
      const s = JSON.parse(
        localStorage.getItem("atlas-desktop-personalization") || "{}",
      );
      document.body.classList.toggle("dark", s.appearance === "dark");
      document.body.style.setProperty("--accent", s.accent || "#007fa3");
    } catch {}
  }
  appearance();
  window.addEventListener("storage", appearance);
  if (app === "calendar") {
    heading(
      "Calendar",
      "Your local calendar · no Outlook or corporate calendar connection",
    );
    let cursor = new Date(),
      selected = day(new Date()),
      events = load("events", []);
    if (!Array.isArray(events)) events = [];
    function day(d) {
      return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-");
    }
    root.insertAdjacentHTML(
      "beforeend",
      '<div class="row"><button id="prev" aria-label="Previous month">‹</button><h2 id="month"></h2><button id="next" aria-label="Next month">›</button><button id="today">Today</button><button id="export">Export calendar</button></div><div class="card calendar-grid" id="monthGrid"></div><section class="card"><h2 id="selectedDay"></h2><form id="eventForm"><input type="text" id="eventTitle" maxlength="180" placeholder="Add an event" aria-label="Event title" required><input type="time" id="eventTime" aria-label="Event time"><button class="primary">Add event</button></form><div id="events"></div></section>',
    );
    function render() {
      document.querySelector("#month").textContent = cursor.toLocaleDateString(
        undefined,
        { month: "long", year: "numeric" },
      );
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1),
        offset = (first.getDay() + 6) % 7;
      let html = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        .map((x) => `<small>${x}</small>`)
        .join("");
      for (let i = 0; i < 42; i++) {
        const date = new Date(first);
        date.setDate(1 - offset + i);
        const key = day(date);
        html += `<button data-date="${key}" aria-label="${key}" aria-pressed="${key === selected}" class="${key === selected ? "selected " : ""}${key === day(new Date()) ? "today " : ""}${date.getMonth() !== cursor.getMonth() ? "muted " : ""}${events.some((e) => e.date === key) ? "has-event" : ""}">${date.getDate()}</button>`;
      }
      document.querySelector("#monthGrid").innerHTML = html;
      document.querySelector("#selectedDay").textContent = new Date(
        selected + "T12:00:00",
      ).toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      document.querySelector("#events").innerHTML =
        events
          .filter((e) => e.date === selected)
          .sort((a, b) => a.time.localeCompare(b.time))
          .map(
            (e) =>
              `<div class="entry"><span>${esc(e.title)}<small>${esc(e.time || "All day")}</small></span><button data-remove="${e.id}" aria-label="Remove ${esc(e.title)}">Remove</button></div>`,
          )
          .join("") || "<p>No events for this day.</p>";
    }
    document.querySelector("#monthGrid").onclick = (e) => {
      if (e.target.dataset.date) {
        selected = e.target.dataset.date;
        render();
      }
    };
    document.querySelector("#prev").onclick = () => {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
      render();
    };
    document.querySelector("#next").onclick = () => {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      render();
    };
    document.querySelector("#today").onclick = () => {
      cursor = new Date();
      selected = day(cursor);
      render();
    };
    document.querySelector("#eventForm").onsubmit = (e) => {
      e.preventDefault();
      const title = document.querySelector("#eventTitle").value.trim();
      if (!title) return;
      events.push({
        id: crypto.randomUUID(),
        date: selected,
        title,
        time: document.querySelector("#eventTime").value,
      });
      save("events", events);
      e.target.reset();
      render();
    };
    document.querySelector("#events").onclick = (e) => {
      if (e.target.dataset.remove) {
        events = events.filter((x) => x.id !== e.target.dataset.remove);
        save("events", events);
        render();
      }
    };
    document.querySelector("#export").onclick = () => {
      const clean = (s) =>
        s
          .replace(/\\/g, "\\\\")
          .replace(/\n/g, "\\n")
          .replace(/,/g, "\\,")
          .replace(/;/g, "\\;");
      download(
        "Atlas-calendar.ics",
        [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Atlas//Local Calendar//EN",
          ...events.flatMap((e) => [
            "BEGIN:VEVENT",
            "UID:" + e.id + "@atlas",
            "DTSTAMP:" +
              new Date().toISOString().replace(/[-:]/g, "").split(".")[0] +
              "Z",
            e.time
              ? "DTSTART:" +
                e.date.replace(/-/g, "") +
                "T" +
                e.time.replace(":", "") +
                "00"
              : "DTSTART;VALUE=DATE:" + e.date.replace(/-/g, ""),
            "SUMMARY:" + clean(e.title),
            "END:VEVENT",
          ]),
          "END:VCALENDAR",
        ].join("\r\n"),
        "text/calendar",
      );
    };
    render();
  } else if (app === "notes") {
    heading("Notes", "A quick scratchpad · saved on this browser");
    const note = load("note", { title: "Quick note", text: "" });
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="row"><input id="noteTitle" aria-label="Note title" maxlength="120" value="${esc(note.title || "Quick note")}"><button id="export">Export note</button></div><p></p><textarea id="noteText" aria-label="Note text" placeholder="Start writing…">${esc(note.text || "")}</textarea>`,
    );
    const update = () =>
      save("note", {
        title: document.querySelector("#noteTitle").value,
        text: document.querySelector("#noteText").value,
      });
    root.oninput = update;
    document.querySelector("#export").onclick = () =>
      download(
        "Atlas-note.txt",
        document.querySelector("#noteTitle").value +
          "\n\n" +
          document.querySelector("#noteText").value,
      );
  } else if (app === "reminders") {
    heading(
      "Reminders",
      "Your checklist · local to this browser, without background notifications",
    );
    let items = load("reminders", []);
    if (!Array.isArray(items)) items = [];
    root.insertAdjacentHTML(
      "beforeend",
      '<form id="reminderForm"><input type="text" id="reminderText" maxlength="240" aria-label="New reminder" placeholder="Add a reminder…" required><button class="primary">Add</button></form><div class="card" id="reminders"></div><button id="export">Export checklist</button>',
    );
    function render() {
      document.querySelector("#reminders").innerHTML =
        items
          .map(
            (i) =>
              `<div class="entry ${i.done ? "done" : ""}"><input type="checkbox" data-check="${i.id}" ${i.done ? "checked" : ""} aria-label="Complete ${esc(i.text)}"><span>${esc(i.text)}</span><button data-remove="${i.id}" aria-label="Remove ${esc(i.text)}">×</button></div>`,
          )
          .join("") || "<p>All clear. Add something to remember.</p>";
    }
    document.querySelector("#reminderForm").onsubmit = (e) => {
      e.preventDefault();
      const text = document.querySelector("#reminderText").value.trim();
      if (!text) return;
      items.push({ id: crypto.randomUUID(), text, done: false });
      save("reminders", items);
      e.target.reset();
      render();
    };
    document.querySelector("#reminders").onclick = (e) => {
      if (e.target.dataset.check)
        items = items.map((i) =>
          i.id === e.target.dataset.check
            ? { ...i, done: e.target.checked }
            : i,
        );
      else if (e.target.dataset.remove)
        items = items.filter((i) => i.id !== e.target.dataset.remove);
      else return;
      save("reminders", items);
      render();
    };
    document.querySelector("#export").onclick = () =>
      download(
        "Atlas-reminders.txt",
        items.map((i) => (i.done ? "[x] " : "[ ] ") + i.text).join("\n"),
      );
    render();
  } else if (app === "calculator") {
    heading("Calculator", "Everyday calculations");
    let value = "0",
      previous = null,
      op = null,
      fresh = true;
    const keys = [
      "AC",
      "±",
      "%",
      "÷",
      "7",
      "8",
      "9",
      "×",
      "4",
      "5",
      "6",
      "−",
      "1",
      "2",
      "3",
      "+",
      "0",
      ".",
      "⌫",
      "=",
    ];
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="calc"><output aria-live="polite" id="result">0</output><div class="calc-grid">${keys.map((k) => `<button data-key="${k}" class="${["÷", "×", "−", "+", "="].includes(k) ? "operator" : ""}">${k}</button>`).join("")}</div></div>`,
    );
    function input(k) {
      if (k === "AC") {
        value = "0";
        previous = null;
        op = null;
        fresh = true;
      } else if (/^[0-9.]$/.test(k)) {
        if (fresh) {
          value = k === "." ? "0." : k;
          fresh = false;
        } else if (!(k === "." && value.includes(".")) && value.length < 15)
          value = value === "0" && k !== "." ? k : value + k;
      } else if (k === "⌫") {
        value = value.slice(0, -1) || "0";
      } else if (k === "±") value = String(-Number(value));
      else if (k === "%") value = String(Number(value) / 100);
      else {
        const n = Number(value);
        if (op && previous !== null && !fresh) {
          const result =
            op === "+"
              ? previous + n
              : op === "−"
                ? previous - n
                : op === "×"
                  ? previous * n
                  : previous / n;
          value = Number.isFinite(result)
            ? String(Number(result.toPrecision(12)))
            : "Error";
        }
        previous = Number(value);
        op = k === "=" ? null : k;
        fresh = true;
      }
      document.querySelector("#result").textContent = value;
    }
    root.onclick = (e) => {
      if (e.target.dataset.key) input(e.target.dataset.key);
    };
    window.addEventListener("keydown", (e) => {
      const k =
        {
          Enter: "=",
          Escape: "AC",
          Backspace: "⌫",
          "/": "÷",
          "*": "×",
          "-": "−",
        }[e.key] || e.key;
      if (keys.includes(k)) {
        e.preventDefault();
        input(k);
      }
    });
  } else if (app === "clock") {
    heading("Clock", "World clocks and a stopwatch");
    root.insertAdjacentHTML(
      "beforeend",
      '<div class="world-clocks" id="world"></div><section class="card"><h2>Stopwatch</h2><div class="time-display" id="stopwatch">00:00.0</div><div class="row"><button id="start" class="primary">Start</button><button id="reset">Reset</button></div></section>',
    );
    let running = false,
      start = 0,
      elapsed = 0,
      visible = true,
      lastMinute = -1;
    function tick() {
      if (!visible || document.hidden) return;
      const minute = Math.floor(Date.now() / 60000);
      if (minute !== lastMinute) {
        lastMinute = minute;
        document.querySelector("#world").innerHTML = [
          ["Paris", "Europe/Paris"],
          ["London", "Europe/London"],
          ["Dublin", "Europe/Dublin"],
          ["New York", "America/New_York"],
          ["Singapore", "Asia/Singapore"],
          ["Tokyo", "Asia/Tokyo"],
        ]
          .map(
            ([city, zone]) =>
              `<div class="card"><small>${city}</small><h2>${new Date().toLocaleTimeString(undefined, { timeZone: zone, hour: "2-digit", minute: "2-digit" })}</h2></div>`,
          )
          .join("");
      }
      const t = elapsed + (running ? performance.now() - start : 0);
      document.querySelector("#stopwatch").textContent =
        String(Math.floor(t / 60000)).padStart(2, "0") +
        ":" +
        String(Math.floor(t / 1000) % 60).padStart(2, "0") +
        "." +
        (Math.floor(t / 100) % 10);
    }
    document.querySelector("#start").onclick = () => {
      if (running) elapsed += performance.now() - start;
      else start = performance.now();
      running = !running;
      document.querySelector("#start").textContent = running
        ? "Pause"
        : "Start";
      tick();
    };
    document.querySelector("#reset").onclick = () => {
      elapsed = 0;
      start = performance.now();
      tick();
    };
    window.addEventListener("message", (e) => {
      if (
        e.source === parent &&
        e.origin === location.origin &&
        e.data?.atlasDesktop &&
        e.data.type === "visibility"
      ) {
        visible = e.data.visible;
        tick();
      }
    });
    setInterval(tick, 100);
    tick();
  } else if (app === "files") {
    heading("Files", "Preview a file you choose · nothing is uploaded");
    root.insertAdjacentHTML(
      "beforeend",
      '<section class="card"><label>Open a text, JSON or image file <input id="file" type="file" accept=".txt,.md,.json,.csv,.log,image/png,image/jpeg,image/webp"></label><p id="fileInfo">Your computer files stay private. This is not a filesystem browser.</p><div id="preview" class="file-preview"></div></section>',
    );
    let objectURL;
    document.querySelector("#file").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const preview = document.querySelector("#preview");
      preview.replaceChildren();
      if (objectURL) URL.revokeObjectURL(objectURL);
      document.querySelector("#fileInfo").textContent =
        file.name + " · " + Math.round(file.size / 1024) + " KB";
      if (file.size > 10000000) {
        status("Choose a file smaller than 10 MB.");
        return;
      }
      if (["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        const img = document.createElement("img");
        img.className = "preview";
        img.alt = file.name;
        objectURL = URL.createObjectURL(file);
        img.src = objectURL;
        preview.append(img);
      } else preview.textContent = await file.text();
    };
  } else if (app === "music") {
    heading("Music", "Play a local audio file · no streaming account required");
    root.insertAdjacentHTML(
      "beforeend",
      '<section class="card"><label>Choose music <input id="audioFile" type="file" accept="audio/*"></label><h2 id="track">No track selected</h2><audio id="player" controls></audio></section>',
    );
    let objectURL;
    document.querySelector("#audioFile").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = URL.createObjectURL(file);
      document.querySelector("#player").src = objectURL;
      document.querySelector("#track").textContent = file.name;
    };
  } else heading("Atlas utilities", "Choose an app from the desktop.");
})();
