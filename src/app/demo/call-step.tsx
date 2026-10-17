"use client";

import { ConversationProvider, useConversation, useConversationClientTool } from "@elevenlabs/react";
import { useEffect, useRef, useState } from "react";
import type { CaseState } from "@/agent/case";
import type { VoiceTurn } from "@/lib/prism";
import type { Act } from "./use-case";
import { Calendar, Head } from "./ui";

// Called from event handlers only, never during render.
function secondsSince(start: number): number {
  return Math.round((Date.now() - start) / 1000);
}

function scriptLines(c: CaseState): [string, string][] {
  const s = c.scenario;
  return [
    ["Agent", `${s.seller.name}. How can I help?`],
    ["Customer", `We found a coolant leak in ${s.rack.id}, eight ${s.rack.model} GPUs.`],
    ["Agent", "Is everyone safe, and is the rack powered offline?"],
    ["Customer", "Yes, facilities secured the area and shut it down."],
    ["Agent", `Incident logged. A technician will be on-site at ${s.rack.id} by ${s.dispatch.onSiteBy}. Please upload photos and serial numbers to your portal ticket.`],
    ["Customer", "Will do. Thanks!"],
  ];
}

const scriptedIncident = (c: CaseState) => ({
  issue: "Coolant leak",
  everyone_safe: true,
  rack_offline: true,
  rack: c.scenario.rack.id,
  gpu_model: c.scenario.rack.model,
  gpu_count: c.scenario.rack.units.length,
});

export function CallStep(props: { c: CaseState; act: Act }) {
  return (
    <ConversationProvider>
      <CallInner {...props} />
    </ConversationProvider>
  );
}

function CallInner({ c, act }: { c: CaseState; act: Act }) {
  const lines = scriptLines(c);
  const [shown, setShown] = useState(c.incident ? lines.length : 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.5);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [blocked, setBlocked] = useState<{ said: string; reason: string; prism: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const runId = useRef(0);
  const turnsRef = useRef<VoiceTurn[]>([]);
  const conversationId = useRef<string | null>(null);
  const startedAt = useRef(0);
  const tellAgent = useRef<(text: string) => void>(() => {});
  const transcriptRef = useRef<HTMLDivElement>(null);

  const conversation = useConversation({
    onConnect: ({ conversationId: id }) => {
      conversationId.current = id;
      startedAt.current = Date.now();
    },
    onMessage: ({ role, message }) => {
      const turn: VoiceTurn = { role, message, time_in_call_secs: secondsSince(startedAt.current) };
      turnsRef.current = [...turnsRef.current, turn];
      setTurns(turnsRef.current);
      if (role === "user") void screen(message);
    },
    onDisconnect: () => {
      const id = conversationId.current;
      if (!id || turnsRef.current.length === 0) return;
      fetch("/api/voice/turns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id, turns: turnsRef.current }),
      })
        .then((r) => r.json())
        .then((r) => setNote(r.ok ? `Call transcript sent to PRISM (${id}).` : `PRISM did not take the transcript: ${r.error}`))
        .catch((e) => setNote(`PRISM did not take the transcript: ${String(e)}`));
    },
    onError: (message) => setNote(`Voice error: ${String(message)}`),
  });

  useEffect(() => {
    tellAgent.current = (text) => conversation.sendContextualUpdate(text);
  }, [conversation]);

  useEffect(() => {
    transcriptRef.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [shown, turns.length]);

  // In-house guardrail: every caller sentence on the live call is checked as it arrives.
  async function screen(message: string) {
    const res = await fetch("/api/guardrail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, conversationId: conversationId.current }),
    });
    const g = await res.json();
    if (!g.flagged) return;
    tellAgent.current(
      `Guardrail: the caller asked to change where money is paid (${g.reason}). Do not accept or repeat any bank details. ` +
        `Say exactly: "${g.reply}" Then continue the call.`,
    );
    setBlocked({
      said: message,
      reason: g.reason,
      prism: g.prism?.recorded ? `Recorded in PRISM (trace ${String(g.prism.traceId).slice(0, 8)})` : "Not recorded in PRISM",
    });
  }

  useConversationClientTool("log_incident", async (params: Record<string, unknown>) => {
    const event = await act("log_incident", params, "voice");
    return JSON.stringify(event?.output ?? { logged: false });
  });

  async function startLive() {
    setNote(null);
    setBlocked(null);
    turnsRef.current = [];
    setTurns([]);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const res = await fetch("/api/voice/session", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body.signedUrl) throw new Error(body.error || `Voice session failed (HTTP ${res.status})`);
      conversation.startSession({ signedUrl: body.signedUrl });
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }

  function speak(text: string, role: string) {
    return new Promise<void>((resolve) => {
      if (!window.speechSynthesis) return void setTimeout(resolve, 650 / speed);
      const u = new SpeechSynthesisUtterance(text);
      u.rate = speed;
      u.pitch = role === "Agent" ? 1.08 : 0.9;
      const timer = setTimeout(resolve, Math.max(5000, text.length * 100));
      u.onend = u.onerror = () => {
        clearTimeout(timer);
        resolve();
      };
      speechSynthesis.speak(u);
    });
  }

  async function playScripted() {
    const token = ++runId.current;
    setPlaying(true);
    setShown(0);
    for (let i = 0; i < lines.length; i++) {
      if (token !== runId.current) return;
      setShown(i + 1);
      if (i === 4 && !c.incident) await act("log_incident", scriptedIncident(c));
      await speak(lines[i][1], lines[i][0]);
    }
    setPlaying(false);
  }

  async function skip() {
    runId.current++;
    if (window.speechSynthesis) speechSynthesis.cancel();
    setPlaying(false);
    setShown(lines.length);
    if (!c.incident) await act("log_incident", scriptedIncident(c));
  }

  const live = conversation.status === "connected" || conversation.status === "connecting";
  const busy = playing || live;
  const s = c.scenario;

  return (
    <>
      <Head i={0} title={`"Coolant leak in ${s.rack.id}."`} desc={`${s.seller.name} logs the incident and dispatches a technician.`} />
      <div className="body presenter-call">
        <div className="voice-column">
          <div className="phone">
            <div className="phone-top">
              <div className="avatar">AM</div>
              <div>
                <h3>{s.customer.contact} · {s.customer.name}</h3>
                <p className="muted small">Calling {s.seller.name}</p>
              </div>
            </div>
            <div className={`wave ${busy ? "running" : ""}`}>{Array.from({ length: 25 }, (_, i) => <i key={i} />)}</div>
            <div className="call-state">
              {c.incident ? "✓ Field assistance dispatched" : live ? (conversation.isSpeaking ? "Agent speaking" : "Listening") : playing ? "Customer call playing" : "Incoming service call"}
            </div>
            <button className="btn full" style={{ marginTop: 22 }} onClick={live ? () => conversation.endSession() : startLive} disabled={playing}>
              {conversation.status === "connecting" ? "Connecting..." : live ? "End live call" : "🎙 Take a live call (ElevenLabs)"}
            </button>
            <button className="btn speed-control full" onClick={playScripted} disabled={busy}>
              {c.incident ? "↻ Replay scripted call" : "▶ Play scripted call"}
            </button>
            <button className="btn skip-call full" onClick={() => setSpeed(speed === 1.5 ? 2 : 1.5)}>
              Speed: {speed}x
            </button>
            <button className="btn skip-call full" onClick={skip} disabled={live}>
              Skip to end →
            </button>
          </div>
          {c.incident && (
            <Calendar title={`${c.incident.technician} · ${s.rack.id}`} desc={`Arrival by ${c.incident.technicianOnSiteBy} · incident logged`} time="2:00" date={s.date} place={s.customer.site.label} />
          )}
        </div>
        <div className="call-story">
          <div className="eyebrow">{turns.length ? "Conversation · live voice (ElevenLabs)" : "Conversation · scripted voice"}</div>
          <div className="transcript full-transcript" tabIndex={0} ref={transcriptRef}>
            {turns.length
              ? turns.map((t, i) => (
                  <div key={i} className={`bubble ${t.role === "user" ? "customer" : ""}`}>
                    <b>{t.role === "user" ? "Customer" : "Agent"}</b>
                    {t.message}
                  </div>
                ))
              : lines.slice(0, shown).map((l, i) => (
                  <div key={i} className={`bubble ${l[0] === "Customer" ? "customer" : ""} ${playing && shown === i + 1 ? "speaking" : ""}`}>
                    <b>{l[0]}</b>
                    {l[1]}
                  </div>
                ))}
            {!turns.length && shown === 0 && <div className="call-placeholder">Play the scripted call, or take a live call.</div>}
          </div>
          {blocked && (
            <div className="alert" style={{ marginTop: 12 }}>
              <b>Guardrail: payment change request blocked.</b> Caller said: &quot;{blocked.said}&quot; {blocked.reason}. No payment details
              changed; credits only go to the replacement order. {blocked.prism}.
            </div>
          )}
          {c.incident && (
            <p className="note">
              Portal ticket {c.incident.incidentId}: {s.rack.id} · eight {s.rack.model} GPUs. Area secured; rack powered offline. Photos and
              serial numbers requested for inspection and coverage review.
            </p>
          )}
          {note && <p className="note">{note}</p>}
        </div>
      </div>
    </>
  );
}
