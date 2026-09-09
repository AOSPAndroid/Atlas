/* Console state. Feature scripts initialize once after loading. */
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)],
  api = (u, o = {}) => AtlasClient.request(u, o),
  esc = (v) =>
    String(v ?? "").replace(
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
let S = {
  users: [],
  machines: [],
  user: null,
  target: "",
  job: null,
  bulk: null,
  rows: [],
  processes: [],
};
const prefs = () =>
    JSON.parse(localStorage.getItem("wmiPrefs") || '{"favs":[],"recent":[]}'),
  save = (p) => localStorage.setItem("wmiPrefs", JSON.stringify(p));
let lookupSequence = 0;
const scriptRequest = AtlasClient.latest(),
  bulkScriptRequest = AtlasClient.latest(),
  packageRequest = AtlasClient.latest(),
  bulkPackageRequest = AtlasClient.latest();
let deploySubmitting = false;
let queueRunning = false;
let deploymentQueue = [];
let activeQueueId = null;
let sharedPalette = null,
  sharedPaletteReady;
let daasState = { status: null, user: null };
let daasUserKey = "";
let deploymentMonitorTimer = null;
let deploymentMonitorMode = "active";
let shortcutRegistry = [];
const softwareState = {
  software: new Map(),
  currentSoftware: [],
  softwareTarget: "",
  health: null,
};
const navigationIcons = {
  workspace:
    '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  admin:
    '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H4zM8 20h8M12 16v4"/></svg>',
  bulk: '<svg viewBox="0 0 24 24"><path d="M5 4h14v4H5zM5 10h14v4H5zM5 16h14v4H5z"/></svg>',
  history:
    '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6M12 7v5l3 2"/></svg>',
};
const masterState = { status: null, resolution: null, running: false };
let consoleCatalogueRequest = 0;
