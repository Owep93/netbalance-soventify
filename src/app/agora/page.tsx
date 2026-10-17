import type { Metadata } from "next";
import Link from "next/link";
import { MarketView } from "./market-view";

export const metadata: Metadata = {
  title: "Agora Market (simulated)",
  description: "Simulated reseller market where the refurbished GPU is listed, bid on, and sold.",
};

export default function AgoraPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide opacity-60">Reseller market</p>
        <h1 className="text-3xl font-bold">Agora</h1>
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          Simulated marketplace for the demo. Buyers, bids, the sale, pickup, and the payout are not real.
        </p>
        <Link href="/" className="mt-3 inline-block text-sm underline">Back to the recovery case</Link>
      </header>
      <MarketView />
    </main>
  );
}
