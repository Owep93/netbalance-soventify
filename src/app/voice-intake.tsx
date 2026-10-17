"use client";

import { ConversationProvider, useConversation, useConversationClientTool } from "@elevenlabs/react";
import { useEffect, useRef, useState } from "react";
import type { IncidentRecord, IntakeReport } from "@/core/intake";
import type { VoiceTurn } from "@/lib/prism";

interface Portal {
  customer: string;
  rackUnits: { slot: number; serial: string }[];
  photos: string[];
  unitNearestLeak: string;
}

// Called from event handlers only (call messages), never during render.
function secondsSince(start: number): number {
  return Math.round((Date.now() - start) / 1000);
}

export function VoiceIntake({ onPortalSubmit }: { onPortalSubmit: (report: IntakeReport) => void }) {
  return (
    <ConversationProvider>
      <SupportLine onPortalSubmit={onPortalSubmit} />
    </ConversationProvider>
  );
}

function SupportLine({ onPortalSubmit }: { onPortalSubmit: (report: IntakeReport) => void }) {
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [incident, setIncident] = useState<{ record: IncidentRecord; portal: Portal } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prismNote, setPrismNote] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ said: string; reason: string; prism: string } | null>(null);
  const tellAgent = useRef<(text: string) => void>(() => {});
  const turnsRef = useRef<VoiceTurn[]>([]);
  const conversationId = useRef<string | null>(null);
  const startedAt = useRef(0);

  const conversation = useConversation({
    onConnect: ({ conversationId: id }) => {
      conversationId.current = id;
      startedAt.current = Date.now();
    },
    onMessage: ({ role, message }) => {
      const turn: VoiceTurn = {
        role,
        message,
        time_in_call_secs: secondsSince(startedAt.current),
      };
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
        .then((r) => setPrismNote(r.ok ? `Call transcript sent to PRISM (${id}).` : `PRISM did not take the transcript: ${r.error}`))
        .catch((e) => setPrismNote(`PRISM did not take the transcript: ${String(e)}`));
    },
    onError: (message) => setError(String(message)),
  });

  useEffect(() => {
    tellAgent.current = (text) => conversation.sendContextualUpdate(text);
  }, [conversation]);

  // In-house guardrail: every caller sentence is checked as it arrives.
  async function screen(message: string) {
    try {
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
        prism: g.prism?.recorded ? `Recorded in PRISM (trace ${String(g.prism.traceId).slice(0, 8)})` : `Not recorded in PRISM: ${g.prism?.error}`,
      });
    } catch (e) {
      setError(`Guardrail check failed: ${String(e)}`);
    }
  }

  useConversationClientTool("log_incident", async (params: Record<string, unknown>) => {
    const res = await fetch("/api/incident", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const body = (await res.json()) as { record: IncidentRecord; portal: Portal };
    setIncident(body);
    return JSON.stringify({
      logged: true,
      incidentId: body.record.incidentId,
      priority: body.record.priority,
      rack: body.record.report.rack,
      technicianOnSiteBy: body.record.technicianOnSiteBy,
      note: body.record.recordNote,
    });
  });

  async function start() {
    setError(null);
    setPrismNote(null);
    setIncident(null);
    setBlocked(null);
    setSubmitted(false);
    turnsRef.current = [];
    setTurns([]);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const res = await fetch("/api/voice/session", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body.signedUrl) throw new Error(body.error || `Voice session failed (HTTP ${res.status})`);
      conversation.startSession({ signedUrl: body.signedUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function submitPortal() {
    if (!incident) return;
    const r = incident.record.report;
    const p = incident.portal;
    setSubmitted(true);
    onPortalSubmit({
      company: p.customer,
      serial: p.unitNearestLeak,
      symptoms:
        `${r.issue}. ` +
        (r.noticed ? `Noticed ${r.noticed}. ` : "") +
        (r.suspectedSource ? `Appears to come from ${r.suspectedSource}. ` : "") +
        `${r.rack}, ${r.gpuCount ?? p.rackUnits.length} ${r.gpuModel} GPUs. ` +
        `Everyone safe: ${r.everyoneSafe ? "yes" : "not confirmed"}. Rack offline: ${r.rackOffline ? "yes" : "not confirmed"}. ` +
        `Portal upload: serials for all ${p.rackUnits.length} units and ${p.photos.length} photos; the unit nearest the leak is ${p.unitNearestLeak}.`,
    });
  }

  const live = conversation.status === "connected" || conversation.status === "connecting";

  return (
    <div className="mb-5 flex flex-col gap-4">
      <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Helix Data Center Support line (ElevenLabs voice)</p>
            <p className="text-sm opacity-70">Call in and report the problem with Rack 12.</p>
          </div>
          <button
            onClick={live ? () => conversation.endSession() : start}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              live ? "bg-red-600 text-white" : "border border-black/20 dark:border-white/25"
            }`}
          >
            {conversation.status === "connecting" ? "Connecting..." : live ? "End call" : "Call support"}
          </button>
        </div>

        {live && (
          <p className="mt-2 text-xs opacity-70">
            {conversation.status === "connected" ? (conversation.isSpeaking ? "Agent speaking" : "Listening") : "Connecting"}
          </p>
        )}

        {turns.length > 0 && (
          <ol className="mt-3 max-h-56 space-y-1 overflow-y-auto text-sm">
            {turns.map((t, i) => (
              <li key={i}>
                <span className="font-medium">{t.role === "user" ? "Customer" : "Agent"}:</span> {t.message}
              </li>
            ))}
          </ol>
        )}

        {blocked && (
          <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-900/30 dark:text-red-100">
            <p className="font-medium">Guardrail: payment change request blocked</p>
            <p>Caller said: &quot;{blocked.said}&quot;</p>
            <p className="opacity-80">
              {blocked.reason}. No payment details changed; the credit stays on the invoice. {blocked.prism}.
            </p>
          </div>
        )}

        {incident && (
          <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
            <p className="font-medium">
              Incident {incident.record.incidentId} logged, priority {incident.record.priority}
            </p>
            <p>
              {incident.record.report.issue}. {incident.record.report.rack}, {incident.record.report.gpuModel}.
              {incident.record.report.noticed && ` Noticed ${incident.record.report.noticed}.`}
              {incident.record.report.suspectedSource && ` Near ${incident.record.report.suspectedSource}.`}
            </p>
            <p>Technician: {incident.record.technicianEta}</p>
            <p className="opacity-80">{incident.record.recordNote}</p>
          </div>
        )}
        {prismNote && <p className="mt-2 text-xs opacity-70">{prismNote}</p>}
        {error && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      </div>

      {incident && (
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
          <p className="font-medium">Portal ticket {incident.record.incidentId}: photos and serial numbers (simulated)</p>
          <p className="text-sm opacity-70">What {incident.portal.customer} uploads after the call.</p>
          <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="mb-1 font-medium">Serial numbers, {incident.record.report.rack}</p>
              <ul className="font-mono text-xs">
                {incident.portal.rackUnits.map((u) => (
                  <li key={u.serial} className={u.serial === incident.portal.unitNearestLeak ? "font-bold" : ""}>
                    Slot {u.slot}: {u.serial}
                    {u.serial === incident.portal.unitNearestLeak && " (nearest the leak)"}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 font-medium">Photos</p>
              <ul className="list-disc pl-5 text-xs">
                {incident.portal.photos.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          </div>
          <button
            onClick={submitPortal}
            disabled={submitted}
            className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {submitted ? "Uploaded to the portal ticket. Recovery agent started below" : "Submit to portal ticket"}
          </button>
        </div>
      )}
    </div>
  );
}
