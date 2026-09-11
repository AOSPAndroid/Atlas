/* Site reference supplied by the owner; shared by Admin, Demo and private preview. */
export const VLANS = [
  [101, "USER_ACCESS", "Desktops, printers"],
  [102, "AP_MGMT", "Wireless AP"],
  [200, "BUILD", "SCCM PXE"],
  [301, "VOICE", "Voice"],
  [302, "SPEAKERBUS", "Speakerbus"],
  [303, "UNIGY", "IPC dealerboards"],
  [400, "MULTIMEDIA", "Multimedia"],
  [401, "AV", "AV"],
  [601, "SECURITY_VLAN_601", "Security"],
  [602, "SECURITY_CCTV_VLAN_602", "CCTV"],
  [999, "SUSPEND_VLAN", "Suspended port"],
];
export const CONTACTS = [
  ["Security", "+33 1 44 58 31 10", "+33144583110"],
  ["Reception", "+33 1 44 58 32 32", "+33144583232"],
  ["Print room", "+33 1 44 58 31 14", "+33144583114"],
  ["AV/VC", "+44 20 7773 5553", "+442077735553"],
];
let current;
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};
export function openSiteInfo(section = "vlans") {
  section = section === "contacts" ? "contacts" : "vlans";
  if (current?.element.isConnected) {
    current.select(section);
    return current.element;
  }
  const { element, body } = AtlasUI.dialog("Site information");
  element.classList.add("atlas-site-info");
  const style = node("style");
  style.textContent = `
    .atlas-site-info {width:min(700px,94vw);max-height:85dvh;box-sizing:border-box;}
    .atlas-site-info .site-intro {color:#617b8d;font-size:13px;margin:0 0 16px;}
    .atlas-site-info .site-tabs {display:flex;gap:6px;padding:4px;background:#edf4f8;border-radius:12px;margin-bottom:18px;}
    .atlas-site-info .site-tabs button {flex:1;border:1px solid transparent;border-radius:9px;background:transparent;color:#47657a;padding:10px 16px;font:600 13px system-ui;}
    .atlas-site-info .site-tabs button[aria-selected=true] {background:white;color:#007da5;border-color:#c9e3ee;box-shadow:0 2px 5px #1733460a;}
    .atlas-site-info .site-table-wrap {overflow:auto;}
    .atlas-site-info table {border-collapse:collapse;width:100%;font-size:13px;text-align:left;}
    .atlas-site-info th {padding:10px 8px;color:#5c7485;font-size:10px;letter-spacing:.06em;text-transform:uppercase;}
    .atlas-site-info td {padding:12px 8px;border-top:1px solid #e5edf2;line-height:1.4;}
    .atlas-site-info td:first-child {color:#007da5;font-weight:700;}
    .atlas-site-info .site-network-name {font:12px/1.5 Consolas,monospace;overflow-wrap:anywhere;}
    .atlas-site-info .site-contact {display:flex;justify-content:space-between;align-items:center;gap:16px;border:1px solid #dbe7ef;border-radius:12px;padding:15px 16px;margin:10px 0;background:#fff;}
    .atlas-site-info .site-contact strong {display:block;margin-bottom:6px;font-size:14px;}
    .atlas-site-info .site-contact a {color:#007da5;font-size:16px;text-decoration:none;white-space:nowrap;}
    .atlas-site-info .site-contact a:hover {text-decoration:underline;}
    .atlas-site-info .site-copy {border:1px solid #cbdde8;border-radius:8px;background:#fff;padding:8px 11px;font-size:12px;color:#244c65;}
    .atlas-site-info .site-status {min-height:18px;color:#557587;font-size:12px;margin:12px 0 0;}
    .atlas-site-info button:focus-visible,.atlas-site-info a:focus-visible {outline:2px solid #0084ad;outline-offset:3px;}
    .atlas-site-info [hidden] {display:none!important;}
    @media(max-width:480px){.atlas-site-info td {padding:10px 5px;font-size:12px;}.atlas-site-info .site-network-name {font-size:10px;}.atlas-site-info .site-contact{padding:12px;gap:8px;}.atlas-site-info .site-contact a {font-size:14px;}}
  `;
  body.append(
    style,
    node("p", "VLAN reference and useful phone numbers", "site-intro"),
  );
  const tabs = node("div", null, "site-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Site information sections");
  const panes = {},
    buttons = {};
  for (const [id, title] of [
    ["vlans", "VLANs"],
    ["contacts", "Contacts"],
  ]) {
    const button = node("button", title);
    button.id = "site-info-tab-" + id;
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "site-info-" + id);
    const pane = node("section");
    pane.id = "site-info-" + id;
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", button.id);
    button.onclick = () => select(id);
    button.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      select(
        event.key === "Home"
          ? "vlans"
          : event.key === "End"
            ? "contacts"
            : id === "vlans"
              ? "contacts"
              : "vlans",
      );
    };
    tabs.append(button);
    buttons[id] = button;
    panes[id] = pane;
  }
  body.append(tabs, panes.vlans, panes.contacts);
  const wrap = node("div", null, "site-table-wrap"),
    table = node("table"),
    head = node("thead"),
    header = node("tr"),
    rows = node("tbody");
  for (const title of ["VLAN", "Name", "Purpose"]) {
    const cell = node("th", title);
    cell.scope = "col";
    header.append(cell);
  }
  head.append(header);
  table.append(head, rows);
  wrap.append(table);
  panes.vlans.append(wrap);
  for (const vlan of VLANS) {
    const row = node("tr");
    vlan.forEach((value, index) =>
      row.append(
        node("td", String(value), index === 1 ? "site-network-name" : ""),
      ),
    );
    rows.append(row);
  }
  const status = node("p", "", "site-status");
  status.setAttribute("role", "status");
  for (const [name, display, number] of CONTACTS) {
    const card = node("div", null, "site-contact"),
      details = node("div"),
      link = node("a", display),
      copy = node("button", "Copy", "site-copy");
    link.href = "tel:" + number;
    link.setAttribute("aria-label", "Call " + name + " " + display);
    copy.type = "button";
    copy.setAttribute("aria-label", "Copy " + name + " phone number");
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(number);
        status.textContent = name + " number copied.";
      } catch {
        status.textContent =
          "Clipboard unavailable. Select the phone number to copy it.";
      }
    };
    details.append(node("strong", name), link);
    card.append(details, copy);
    panes.contacts.append(card);
  }
  panes.contacts.append(status);
  function select(id) {
    for (const key of Object.keys(panes)) {
      panes[key].hidden = key !== id;
      buttons[key].setAttribute("aria-selected", String(key === id));
      buttons[key].tabIndex = key === id ? 0 : -1;
    }
    buttons[id].focus();
  }
  current = { element, select };
  element.addEventListener(
    "close",
    () => {
      current = null;
    },
    { once: true },
  );
  select(section);
  return element;
}
