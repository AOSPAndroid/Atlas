import React, { useEffect, useRef, useState } from "react";
import { Sparkles, BookOpen, FileText, Copy, Settings } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./components/ui/card";
import { sendInboxAction } from "./inbox-request";

const factLabels = { machine: "Machine", application: "Application", error: "Error", since: "Since", location: "Location", urgency: "Urgency", person: "Person", other: "Detail" };
const assistant = () => window.AtlasAssistant;

/** Read a request with the local model. Only what passes Atlas's checks is shown; the rest is listed as hidden. */
export function AssistantCard({ subject, text }) {
  const [status, setStatus] = useState(() => assistant()?.last || null);
  const [result, setResult] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [seconds, setSeconds] = useState(0);
  const timer = useRef(null), current = useRef(0);
  useEffect(() => {
    if (!assistant() || window.AtlasReadOnly) return undefined;
    const stop = assistant().subscribe(setStatus);
    if (!assistant().last) assistant().status();
    return stop;
  }, []);
  // A different message starts from a clean card; a late answer for the old one is ignored.
  useEffect(() => { current.current += 1; setResult(null); setError(""); setBusy(false); clearInterval(timer.current); }, [subject, text]);
  useEffect(() => () => clearInterval(timer.current), []);
  if (window.AtlasReadOnly || !assistant()) return null;

  async function read() {
    const serial = ++current.current, started = Date.now();
    setBusy(true); setError(""); setResult(null); setSeconds(0);
    clearInterval(timer.current);
    timer.current = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 500);
    try {
      const answer = await assistant().post("/api/assistant/read", { subject: subject || "", text: String(text || "").slice(0, 20000) });
      if (serial === current.current) setResult(answer);
    } catch (failure) {
      if (serial === current.current) setError(failure.message);
    } finally {
      if (serial === current.current) { clearInterval(timer.current); setBusy(false); }
      assistant().status();
    }
  }
  const openSource = (source) => sendInboxAction("knowledge", { document: source.kind === "article" ? "article:" + source.ref : "file:" + source.ref });
  const copy = (value) => navigator.clipboard?.writeText(value).then(() => window.toast?.("Copied"));
  const sources = Object.fromEntries((result?.sources || []).map((s) => [s.id, s]));
  const notReady = status && !status.configured && !status.unavailable;
  return <Card className="assistant-card">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}><Sparkles aria-hidden="true" />Assistant</CardTitle>
      <CardDescription>{busy ? `Reading… ${seconds} s` : assistant().describe(status)}</CardDescription>
    </CardHeader>
    <CardContent>
      {!result && !busy && <p className="inbox-muted">Summarises the request and finds steps in your own articles and notes. Every line is checked against the message or the article it cites.</p>}
      {error && <p role="alert" className="inbox-error">{error}</p>}
      {result && <div className="assistant-result" aria-live="polite">
        {result.summary && <p className="assistant-summary">{result.summary}</p>}
        {result.asks.length > 0 && <section><h3>Asks for</h3><ul>{result.asks.map((a, i) => <li key={i} title={"“" + a.quote + "”"}>{a.text}</li>)}</ul></section>}
        {result.facts.length > 0 && <section><h3>Details in the message</h3><dl className="assistant-facts">{result.facts.map((f, i) => <React.Fragment key={i}><dt>{factLabels[f.label] || "Detail"}</dt><dd title={"“" + f.quote + "”"}>{f.value}</dd></React.Fragment>)}</dl></section>}
        {result.questions.length > 0 && <section><h3>Ask the user</h3><ul>{result.questions.map((q, i) => <li key={i}>{q} <Button size="sm" variant="ghost" aria-label={"Copy question: " + q} onClick={() => copy(q)}><Copy aria-hidden="true" /></Button></li>)}</ul></section>}
        {result.steps.length > 0 && <section><h3>Steps from your knowledge</h3><ol>{result.steps.map((s, i) => <li key={i}>{s.text} <Button size="sm" variant="ghost" className="assistant-cite" onClick={() => openSource(sources[s.source])}>
          {sources[s.source]?.kind === "article" ? <BookOpen aria-hidden="true" /> : <FileText aria-hidden="true" />}{sources[s.source]?.title || s.source}</Button></li>)}</ol></section>}
        {!result.steps.length && <p className="inbox-muted">{result.sources.length ? "Your articles and notes found for this request had no matching steps." : "No article or note matches this request yet."}</p>}
        {result.hidden.length > 0 && <details className="assistant-hidden"><summary>{result.hidden.length} line{result.hidden.length === 1 ? "" : "s"} hidden: not found in the message or source</summary>
          <ul>{result.hidden.map((h, i) => <li key={i}><strong>{h.section}:</strong> {h.text} <small>— {h.reasons.join("; ")}</small></li>)}</ul></details>}
      </div>}
    </CardContent>
    <CardFooter>
      <Button size="sm" variant={result ? "outline" : "default"} disabled={busy || !String(text || "").trim() || notReady} onClick={read}><Sparkles aria-hidden="true" />{result ? "Read again" : "Read with Assistant"}</Button>
      <Button size="sm" variant="ghost" onClick={() => assistant().openSettings()}><Settings aria-hidden="true" />{notReady ? "Set up" : "Settings"}</Button>
      {result && <small className="inbox-muted">{result.model} · {result.seconds} s</small>}
    </CardFooter>
  </Card>;
}
