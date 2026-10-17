"use client";

import { ConversationProvider, useConversation, useConversationClientTool } from "@elevenlabs/react";
import { useRef, useState } from "react";
import type { IntakeReport, IntakeMatch } from "@/core/intake";
import type { VoiceTurn } from "@/lib/prism";

interface Booking {
  slot: string;
  contact: string;
  technician: string;
}

export function VoiceIntake({ onCaseOpened }: { onCaseOpened: (report: IntakeReport) => void }) {
  return (
    <ConversationProvider>
      <VoiceLine onCaseOpened={onCaseOpened} />
    </ConversationProvider>
  );
}

function VoiceLine({ onCaseOpened }: { onCaseOpened: (report: IntakeReport) => void }) {
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [caseOpened, setCaseOpened] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prismNote, setPrismNote] = useState<string | null>(null);
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
        time_in_call_secs: Math.round((Date.now() - startedAt.current) / 1000),
      };
      turnsRef.current = [...turnsRef.current, turn];
      setTurns(turnsRef.current);
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

  useConversationClientTool("open_recovery_case", async (params: Partial<IntakeReport>) => {
    const res = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const { report, match } = (await res.json()) as { report: IntakeReport; match: IntakeMatch };
    if (!match.ok) return JSON.stringify({ opened: false, reason: match.reason });
    setCaseOpened(`${match.customer}, ${match.model} serial ${match.serial}`);
    onCaseOpened({ ...report, serial: match.serial });
    return JSON.stringify({
      opened: true,
      customer: match.customer,
      unit: `${match.model}, serial ${match.serial}`,
      next: "The recovery agent is now working the case on screen.",
    });
  });

  useConversationClientTool("book_installation", (params: { preferred_time?: string; contact_name?: string }) => {
    const b: Booking = {
      slot: params.preferred_time || "next available slot",
      contact: params.contact_name || "the site contact",
      technician: "NetBalance field technician",
    };
    setBooking(b);
    return JSON.stringify({ confirmed: true, ...b, note: "This booking is simulated for the demo." });
  });

  async function start() {
    setError(null);
    setPrismNote(null);
    setCaseOpened(null);
    setBooking(null);
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

  const live = conversation.status === "connected" || conversation.status === "connecting";

  return (
    <div className="mb-5 rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Voice intake (ElevenLabs)</p>
          <p className="text-sm opacity-70">
            Call the recovery line and report the failed GPU. Serial on file: GX4-23-00871.
          </p>
        </div>
        <button
          onClick={live ? () => conversation.endSession() : start}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            live ? "bg-red-600 text-white" : "border border-black/20 dark:border-white/25"
          }`}
        >
          {conversation.status === "connecting" ? "Connecting..." : live ? "End call" : "Call the recovery line"}
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
              <span className="font-medium">{t.role === "user" ? "Caller" : "Agent"}:</span> {t.message}
            </li>
          ))}
        </ol>
      )}

      {caseOpened && <p className="mt-3 text-sm">Case opened for {caseOpened}. The recovery agent has started below.</p>}
      {booking && (
        <p className="mt-1 text-sm">
          Installation booked: {booking.slot}, ask for {booking.contact}, {booking.technician}. (Simulated)
        </p>
      )}
      {prismNote && <p className="mt-2 text-xs opacity-70">{prismNote}</p>}
      {error && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
