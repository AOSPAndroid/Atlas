import React, { useEffect, useRef, useState } from "react";
import { Inbox, Monitor, UserRound, ArrowUpRight, RefreshCw } from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./components/ui/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "./components/ui/empty";
import { Skeleton } from "./components/ui/skeleton";
import { InboxControls } from "./inbox-controls";
import { AppControls } from "./app-controls";

const matchLabels = { email: "Email match", name: "Name match · verify", ambiguous: "Choose a person", unmatched: "No Atlas match" };
const states = { watching: "Watching Outlook", scanning: "Checking Outlook", starting: "Starting watcher", stopped: "Watcher stopped", waiting_for_outlook: "Waiting for Outlook", retrying: "Retrying Outlook", error: "Watcher needs attention" };
const notificationStates = { watching: "Listening for notifications", starting: "Waiting for Windows permission", stopped: "Notifications paused", not_started: "Notifications not connected", permission_required: "Notification permission needed", retrying: "Retrying notifications", error: "Notification listener needs attention" };
const sourceLabel = item => item?.content_kind === "notification" ? (item.channel === "teams" ? "Teams preview" : "Outlook preview") : "Outlook email";
const date = value => value ? new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "Not yet";
const request = (url, signal) => window.AtlasClient.request(url, { signal, atlasSilent: true });
function EmptyInbox({ title, children }) {
  return <Empty><EmptyHeader><EmptyMedia variant="icon"><Inbox aria-hidden="true" /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{children}</EmptyDescription></EmptyHeader></Empty>;
}
function merge(previous, incoming) {
  const rows = new Map(previous.map(row => [row.id, row]));
  incoming.forEach(row => rows.set(row.id, row));
  return [...rows.values()].sort((a, b) => b.id - a.id);
}
export function LiveInbox() {
  const section = document.getElementById("inbox"), readonly = !!window.AtlasReadOnly;
  const [visible, setVisible] = useState(() => section.classList.contains("active"));
  const [items, setItems] = useState([]), [total, setTotal] = useState(0), [watcher, setWatcher] = useState(null);
  const [notifications, setNotifications] = useState(null);
  const [selected, setSelected] = useState(null), [chosen, setChosen] = useState(null), [detail, setDetail] = useState(null);
  const [error, setError] = useState(""), [detailError, setDetailError] = useState(""), [pending, setPending] = useState(0);
  const [loaded, setLoaded] = useState(false), [older, setOlder] = useState(false), [refresh, setRefresh] = useState(0);
  const cursor = useRef(0), initialized = useRef(false), session = useRef(0), selection = useRef(selected);
  selection.current = selected;
  useEffect(() => {
    const update = () => setVisible(section.classList.contains("active"));
    const observer = new MutationObserver(update);
    observer.observe(section, { attributes: true, attributeFilter: ["class"] });
    update();
    return () => observer.disconnect();
  }, [section]);
  useEffect(() => {
    if (!visible || readonly) return;
    let current = true, timer;
    const controller = new AbortController();
    session.current += 1;
    async function poll() {
      let delay = 2000;
      try {
        const next = await request("/api/inbox/messages?limit=50&after_id=" + cursor.current, controller.signal);
        if (!current) return;
        if (initialized.current && next.newest_id < cursor.current) {
          cursor.current = 0; initialized.current = false;
          setItems([]); setSelected(null); setChosen(null); setPending(0);
          delay = 0;
        } else {
          setItems(previous => merge(previous, next.items));
          if (!initialized.current) {
            if (selection.current === null && next.items.length) setSelected(next.items[0].id);
            cursor.current = next.newest_id;
            initialized.current = true;
          } else {
            if (selection.current === null && next.items.length) setSelected(next.items.at(-1).id);
            setPending(count => count + next.items.length);
            cursor.current = Math.max(cursor.current, next.next_after);
            if (next.has_more) delay = 0;
          }
        }
        setTotal(next.total); setWatcher(next.watcher); setNotifications(next.notifications || null); setLoaded(true); setError("");
      } catch (failure) {
        if (current && failure.name !== "AbortError") { setError(failure.message); setLoaded(true); }
      }
      if (current) timer = setTimeout(poll, delay);
    }
    poll();
    return () => { current = false; session.current += 1; controller.abort(); clearTimeout(timer); };
  }, [visible, readonly, refresh]);
  useEffect(() => {
    if (!visible || readonly || selected === null) return;
    let current = true;
    const controller = new AbortController();
    setDetail(null); setDetailError("");
    request("/api/inbox/messages/" + selected + (chosen ? "?user_id=" + chosen : ""), controller.signal)
      .then(value => { if (current) setDetail(value); })
      .catch(failure => { if (current && failure.name !== "AbortError") setDetailError(failure.message); });
    return () => { current = false; controller.abort(); };
  }, [selected, chosen, visible, readonly, refresh]);
  function choose(id) { setSelected(id); setChosen(null); }
  async function loadOlder() {
    const token = session.current;
    setOlder(true);
    try {
      const next = await request("/api/inbox/messages?limit=50&before_id=" + items.at(-1).id);
      if (token === session.current) { setItems(previous => merge(previous, next.items)); setTotal(next.total); setError(""); }
    } catch (failure) { if (token === session.current) setError(failure.message); }
    finally { setOlder(false); }
  }
  if (readonly) return <EmptyInbox title="Live inbox is available in Atlas Admin">Open Atlas Admin on the Windows PC running Outlook and Teams. Email and notification previews stay in the local queue and are not shared with Demo or Preview.</EmptyInbox>;
  const live = watcher?.running && !watcher.stale && ["watching", "scanning"].includes(watcher.state) && !error;
  const stateLabel = error ? "Connection interrupted" : watcher?.stale ? "Outlook check is taking longer" : states[watcher?.state] || "Connecting…";
  const notificationsLive = notifications?.running && !notifications.stale && notifications.state === "watching" && !error;
  const notificationLabel = error ? "Connection interrupted" : notifications?.stale ? "Notification listener is not responding" : notificationStates[notifications?.state] || "Notifications not connected";
  const match = detail?.match, user = match?.user, message = detail?.message;
  return <div className="live-inbox">
    <div className="inbox-toolbar">
      <div role="status" aria-live="polite"><Badge variant={live ? "default" : "secondary"} data-inbox-status>{stateLabel}</Badge><Badge variant={notificationsLive ? "default" : "secondary"} data-notification-status>{notificationLabel}</Badge><span className="inbox-muted">{total.toLocaleString()} collected · {watcher?.config?.mailbox || "Default Inbox"}{watcher?.config?.subfolder ? " / " + watcher.config.subfolder : ""}</span></div>
      <Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}><RefreshCw data-icon="inline-start" />Refresh now</Button>
    </div>
    {error && <p role="alert" className="inbox-error">{error} Retrying automatically; displayed messages may be out of date.</p>}
    <InboxControls active={visible} onChange={() => setRefresh(value => value + 1)} />
    <AppControls />
    <details className="inbox-connection">
      <summary>Connection details · Outlook {date(watcher?.last_success_at)} · notifications {date(notifications?.last_success_at)}</summary>
      <p>{watcher?.detail || "Connect the collectors above, then open classic Outlook in your normal Windows account."}</p>
      <p>Run the watcher under the same Windows account and elevation level as Outlook. Atlas checks the local feed every 2 seconds; Outlook is checked every {watcher?.interval || 5} seconds. The watcher keeps collecting when you leave this page.</p>
      <p>{notifications?.detail || "Use Listener settings above to grant Windows notification permission and check the Teams source."}</p>
      <p>Notifications are checked every 2 seconds. The listener’s source check shows whether Windows exposes Teams alerts. Previews may be incomplete; app-only banners and messages without notifications are not captured. Outlook previews are optional because the mail watcher already reads complete emails.</p>
      <p>Connection settings are saved on this PC and used by every Atlas launcher. Setup guide: docs/inbox-integration.md in the Atlas folder.</p>
    </details>
    <div className="inbox-grid">
      <div className="inbox-mail-list">
        <div className="inbox-list-heading"><h2>Incoming messages</h2>{pending > 0 && <Button variant="secondary" size="sm" onClick={() => { choose(items[0].id); setPending(0); }}>Show newest ({pending})</Button>}</div>
        {!loaded ? <Skeleton className="inbox-loading" /> : !items.length ? <EmptyInbox title="Waiting for incoming messages">Emails and notification previews appear when their collectors are connected. Collection begins when each collector first starts.</EmptyInbox> : <ul aria-label="Collected messages">{items.map(item => <li key={item.id}>
          <Button variant="ghost" className="inbox-mail-row" aria-current={selected === item.id ? "true" : undefined} onClick={() => choose(item.id)} data-mail-id={item.id}>
            <span className="inbox-mail-top"><strong>{item.sender_name || item.sender_address || "Sender not supplied"}</strong><time dateTime={item.received_at}>{date(item.received_at)}</time></span>
            <span className="inbox-subject">{item.content_kind === "notification" ? item.preview || "(No message preview)" : item.subject || "(No subject)"}</span>
            <span className="inbox-mail-bottom"><Badge variant="secondary">{sourceLabel(item)}</Badge><span className="inbox-address">{item.sender_address}</span><Badge variant="outline">{matchLabels[item.match.kind]}</Badge></span>
          </Button>
        </li>)}</ul>}
        {items.length > 0 && items.length < total && <Button variant="outline" size="sm" disabled={older} onClick={loadOlder}>Load older messages ({items.length} of {total})</Button>}
      </div>
      <div className="inbox-context" aria-label="Message and sender details">
        {selected === null ? <EmptyInbox title="Select a message">Its sender and linked machines will appear here.</EmptyInbox> : detailError ? <p role="alert" className="inbox-error">{detailError}</p> : !detail || message.id !== selected ? <Skeleton className="inbox-loading" /> : <>
          <Card className="inbox-person-card"><CardHeader><CardTitle role="heading" aria-level={2}><UserRound aria-hidden="true" />Sender in Atlas</CardTitle><CardDescription>{matchLabels[match.kind]}{match.chosen ? " · selected for this view" : ""}</CardDescription></CardHeader><CardContent>
            {match.kind === "ambiguous" && <div className="inbox-candidates"><p>More than one person matches this {match.basis}. Choose the correct record to view machines.</p>{match.candidates.map(candidate => <Button key={candidate.id} size="sm" variant={chosen === candidate.id ? "secondary" : "outline"} onClick={() => setChosen(candidate.id)}>{candidate.name} · {candidate.email || candidate.user_name || candidate.id}</Button>)}</div>}
            {user ? <><h3>{user.full_name || user.name}</h3><p>{[user.user_name, user.email].filter(Boolean).join(" · ")}</p><p className="inbox-muted">{[user.department, user.location, user.job_role].filter(Boolean).join(" · ") || "No additional directory details"}</p>{match.basis === "name" && <p className="inbox-match-note">{message.content_kind === "notification" ? "Matched the notification title. It may be a chat or group name; verify the sender in Teams or Outlook before taking action." : "Display names can be shared. Verify this person against the sender address before taking action."}</p>}</> : match.kind === "unmatched" && <p>No exact email or full-name match was found in the Atlas database.</p>}
          </CardContent>{user && <CardFooter><Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent("atlas:inbox-person", { detail: { id: user.id } }))}>Open in Workspace<ArrowUpRight data-icon="inline-end" /></Button></CardFooter>}</Card>
          {user && <Card><CardHeader><CardTitle role="heading" aria-level={2}><Monitor aria-hidden="true" />Linked machines <Badge variant="secondary">{detail.machines.length}</Badge></CardTitle><CardDescription>Stored inventory relationships and status</CardDescription></CardHeader><CardContent>
            {detail.machines.length ? <ul className="inbox-devices">{detail.machines.map((machine, index) => <li key={index}><div><strong>{machine.name || machine.machine_name}</strong><Badge variant="outline">{machine.device_kind || "Device"}</Badge></div><p>{machine.model_id || machine.model_category || "Model not supplied"}</p><p>{machine.match_type || "Linked in inventory"}</p><small>{[machine.operational_status && "Inventory: " + machine.operational_status, machine.last_discovered && "Discovered: " + machine.last_discovered].filter(Boolean).join(" · ") || "Inventory timestamp not supplied"}</small></li>)}</ul> : <p>No linked machines in the current Atlas database.</p>}
          </CardContent></Card>}
          <Card className="inbox-message-card"><CardHeader><CardTitle role="heading" aria-level={2}>{message.subject || "(No subject)"}</CardTitle><CardDescription>{sourceLabel(message)} · {message.sender_name}{message.sender_address ? " <" + message.sender_address + ">" : ""} · {date(message.received_at)}</CardDescription></CardHeader><CardContent>{message.content_kind === "notification" && <p className="inbox-match-note">Notification preview from {message.app_name || (message.channel === "teams" ? "Teams" : "Outlook")}. Text may be incomplete or hidden by notification settings. Open the source app for the full conversation.</p>}<pre className="inbox-body">{message.body || (message.content_kind === "notification" ? "No message preview was supplied by Windows." : "No plain-text body was supplied.")}</pre>{!!message.body_truncated && <p className="inbox-muted">Showing the first 100,000 characters. Open Outlook for the full message.</p>}</CardContent></Card>
        </>}
      </div>
    </div>
  </div>;
}
