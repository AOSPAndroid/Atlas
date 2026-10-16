import React, { useEffect, useRef, useState } from "react";
import { ScanText, Monitor, UserRound, ArrowUpRight, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./components/ui/card";
import { RequestCard, MachineActions } from "./inbox-request";

const sourceLabels = { window: "Window in front", screen: "Whole screen", clipboard: "Clipboard" };
const matchLabels = { email: "Email in text", name: "Name in window title · verify", ambiguous: "Choose a person", unmatched: "No Atlas match" };
const post = (url, body) => window.AtlasClient.request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const DELAY = 3;

/** Read text from the operator's own window, screen or clipboard and analyse it like an email. */
export function ScreenReader() {
  const [busy, setBusy] = useState(""), [countdown, setCountdown] = useState(0), [error, setError] = useState("");
  const [result, setResult] = useState(null), [title, setTitle] = useState(""), [text, setText] = useState(""), [serial, setSerial] = useState(0);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);
  function show(next) { setResult(next); setTitle(next.title || ""); setText(next.text || ""); setSerial((value) => value + 1); }
  async function read(source) {
    const delay = source === "clipboard" ? 0 : DELAY;
    setError(""); setBusy(source); setCountdown(delay);
    clearInterval(timer.current);
    if (delay) timer.current = setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    try { show(await post("/api/screen/read", { source, delay })); }
    catch (failure) { setError(failure.message); }
    finally { clearInterval(timer.current); setBusy(""); setCountdown(0); }
  }
  async function analyse(userId = null) {
    setError(""); setBusy("analyse");
    try { const next = await post("/api/screen/analyse", { title, text, user_id: userId }); show({ ...result, ...next }); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(""); }
  }
  const match = result?.match, user = match?.user;
  const mentioned = (result?.analysis?.machines || []).filter((machine) => !machine.linked);
  const detail = result && { message: { id: "screen-" + serial, subject: title, body: text }, match, machines: result.machines || [], analysis: result.analysis };
  return <section className="screen-reader" aria-label="Read from screen">
    <div className="screen-reader-bar">
      <strong><ScanText aria-hidden="true" />Read from screen</strong>
      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => read("window")}>Window in {DELAY} s</Button>
      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => read("screen")}>Whole screen in {DELAY} s</Button>
      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => read("clipboard")}>Clipboard</Button>
      <span className="inbox-muted" role="status" aria-live="polite">{busy && busy !== "analyse" && busy !== "clipboard"
        ? countdown > 0 ? `Switch to the ticket or chat now… ${countdown}` : "Reading text…"
        : busy === "clipboard" ? "Reading clipboard…" : "Reads your own session only. Nothing is saved."}</span>
      {result && <Button size="sm" variant="ghost" onClick={() => setResult(null)} aria-label="Close screen reading"><X aria-hidden="true" />Close</Button>}
    </div>
    {error && <p role="alert" className="inbox-error">{error}</p>}
    {result && <div className="inbox-grid screen-reader-result">
      <Card className="screen-reader-text"><CardHeader><CardTitle role="heading" aria-level={2}>Captured text <Badge variant="secondary">{sourceLabels[result.source] || "Text"}</Badge></CardTitle>
        <CardDescription>{result.process ? result.process + " · " : ""}Correct any misread words, then analyse again.</CardDescription></CardHeader>
        <CardContent>
          <label>Window title<input value={title} maxLength={1000} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Text<textarea value={text} maxLength={20000} rows={12} onChange={(event) => setText(event.target.value)} /></label>
          {result.truncated && <p className="inbox-muted">Only the first 20,000 characters were kept.</p>}
        </CardContent>
        <CardFooter><Button size="sm" variant="outline" disabled={!!busy || !text.trim()} onClick={() => analyse()}>Analyse again</Button></CardFooter>
      </Card>
      <div className="inbox-context" aria-label="People and actions for the captured text">
        <Card className="inbox-person-card"><CardHeader><CardTitle role="heading" aria-level={2}><UserRound aria-hidden="true" />Person</CardTitle><CardDescription>{matchLabels[match?.kind] || ""}{match?.chosen ? " · selected" : ""}</CardDescription></CardHeader><CardContent>
          {match?.kind === "ambiguous" && <div className="inbox-candidates"><p>More than one person matches. Choose the correct record.</p>{match.candidates.map((candidate) => <Button key={candidate.id} size="sm" variant="outline" disabled={!!busy} onClick={() => analyse(candidate.id)}>{candidate.full_name || candidate.name} · {candidate.email || candidate.user_name || candidate.id}</Button>)}</div>}
          {user ? <><h3>{user.full_name || user.name}</h3><p>{[user.user_name, user.email].filter(Boolean).join(" · ")}</p>{match.basis === "name" && <p className="inbox-match-note">Matched a name in the window title. Verify it is the person asking before acting.</p>}</>
            : match?.kind === "unmatched" && <p>No email address or person name from the text matched Atlas. Machine names and requests are still checked below.</p>}
        </CardContent>{user && <CardFooter><Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent("atlas:inbox-person", { detail: { id: user.id } }))}>Open in Workspace<ArrowUpRight data-icon="inline-end" /></Button></CardFooter>}</Card>
        <RequestCard detail={detail} user={user} />
        {(user || mentioned.length > 0) && <Card><CardHeader><CardTitle role="heading" aria-level={2}><Monitor aria-hidden="true" />Machines <Badge variant="secondary">{(user ? result.machines.length : 0) + mentioned.length}</Badge></CardTitle></CardHeader><CardContent>
          <ul className="inbox-devices">
            {mentioned.map((machine) => <li key={"named-" + machine.name} data-screen-machine={machine.name}><div><strong>{machine.name}</strong><Badge variant="outline">In captured text</Badge>{machine.written_as && machine.written_as !== machine.name.toUpperCase() && <small className="inbox-read-as" title="Found despite look-alike characters such as 0/O or 1/I">read as {machine.written_as}</small>}</div><MachineActions machine={machine} user={user} /></li>)}
            {user && result.machines.map((machine, index) => <li key={index}><div><strong>{machine.name || machine.machine_name}</strong><Badge variant="outline">{machine.match_type || "Linked"}</Badge></div><MachineActions machine={{ ...machine, name: machine.name || machine.machine_name }} user={user} /></li>)}
          </ul>
          {user && !result.machines.length && !mentioned.length && <p>No linked machines in the current Atlas database.</p>}
        </CardContent></Card>}
      </div>
    </div>}
  </section>;
}
