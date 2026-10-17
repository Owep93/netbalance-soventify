import type { Scenario } from "./scenario";

export interface IntakeReport {
  company: string;
  serial: string;
  symptoms: string;
}

export type IntakeMatch =
  | { ok: true; serial: string; model: string; customer: string }
  | { ok: false; reason: string };

// Speech to text writes serials many ways ("GX4-23-00871", "gx4 23 00871", "G X 4 2 3...").
export function normalizeSerial(serial: string): string {
  return serial.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Checks a reported serial against the units on file. */
export function matchIntake(s: Scenario, report: IntakeReport): IntakeMatch {
  if (!report.serial?.trim()) return { ok: false, reason: "No serial number was given." };
  if (normalizeSerial(report.serial) !== normalizeSerial(s.failedUnit.serial)) {
    return { ok: false, reason: `Serial "${report.serial}" is not on file. Ask the caller to check it.` };
  }
  return { ok: true, serial: s.failedUnit.serial, model: s.failedUnit.model, customer: s.customer.name };
}
