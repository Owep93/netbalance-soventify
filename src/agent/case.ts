// The one shared record for case DC-014. Presenter clicks, the voice call, and the agent
// autopilot all change it through the same tools, so every screen shows the same truth.
import type { CoverageDecision } from "@/core/coverage";
import type { Approval, TransferDecision } from "@/core/credit";
import type { IncidentRecord } from "@/core/intake";
import type { Receipt, Reconciliation } from "@/core/ledger";
import type { CfoReport } from "@/core/report";
import { scenario, type OfferId, type Scenario } from "@/core/scenario";
import type { Sale } from "@/agora/market";
import type { TraceEvent } from "./trace";

export interface GuardEvent {
  at: string;
  kind: "credit transfer held" | "credit transfer approved" | "credit transfer refused" | "payment change blocked";
  detail: string;
  prismTraceId: string | null;
}

export interface CaseState {
  scenario: Scenario;
  incident: IncidentRecord | null;
  photoAttached: boolean;
  coverage: CoverageDecision | null;
  transfer: { decision: TransferDecision | null; approval: Approval | null };
  offersShown: boolean;
  offer: OfferId | null;
  gpuListed: boolean;
  bidsIn: boolean;
  sale: Sale | null;
  receipts: Receipt[] | null;
  reconciliation: Reconciliation | null;
  report: CfoReport | null;
  epaErrors: string[];
  trace: TraceEvent[];
  guardEvents: GuardEvent[];
  autopilot: { running: boolean; summary: string | null; unsupportedFigures: string[] };
  prism: { traceId: string; sent: Record<string, boolean>; errors: string[] } | null;
  updatedAt: string;
}

export function newCase(s: Scenario = scenario): CaseState {
  return {
    scenario: s,
    incident: null,
    photoAttached: false,
    coverage: null,
    transfer: { decision: null, approval: null },
    offersShown: false,
    offer: null,
    gpuListed: false,
    bidsIn: false,
    sale: null,
    receipts: null,
    reconciliation: null,
    report: null,
    epaErrors: [],
    trace: [],
    guardEvents: [],
    autopilot: { running: false, summary: null, unsupportedFigures: [] },
    prism: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Which of the six demo steps are done. */
export function stepsDone(c: CaseState): boolean[] {
  return [
    c.incident !== null,
    c.coverage !== null,
    c.offer !== null,
    c.sale !== null,
    c.reconciliation !== null && c.reconciliation.allSettled,
    c.report !== null,
  ];
}

const g = globalThis as unknown as { __case?: CaseState };

export function getCase(): CaseState {
  return (g.__case ??= newCase());
}

export function resetCase(): CaseState {
  g.__case = newCase();
  return g.__case;
}
