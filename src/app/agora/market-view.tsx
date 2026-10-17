"use client";

import { useEffect, useState } from "react";
import type { Listing, MarketEvent } from "@/agora/market";
import { formatUsd } from "@/core/money";

interface Snapshot {
  listings: Listing[];
  events: MarketEvent[];
}

export function MarketView() {
  const [data, setData] = useState<Snapshot>({ listings: [], events: [] });

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/agora", { cache: "no-store" });
        if (alive && res.ok) setData(await res.json());
      } catch {
        // Keep the last snapshot if a poll fails.
      }
    };
    tick();
    const id = setInterval(tick, 800);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (data.listings.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-black/20 p-8 text-center text-sm opacity-70 dark:border-white/20">
        No listings yet. Reach step 4 of the recovery case and the GPU lot will appear here.
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-6">
        {data.listings.map((l) => {
          const best = l.bids.length ? Math.max(...l.bids.map((b) => b.net)) : null;
          return (
            <article key={l.id} className="rounded-xl border border-black/10 p-5 dark:border-white/15">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs opacity-60">{l.id}</p>
                  <h2 className="text-xl font-semibold">{l.title}</h2>
                  <p className="mt-1 text-sm">{l.condition}</p>
                  <p className="mt-1 font-mono text-xs opacity-60">{l.serials.join(", ")}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    l.status === "sold"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                      : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
                  }`}
                >
                  {l.status === "sold" ? "Sold" : "Listed"}
                </span>
              </div>

              <h3 className="mt-5 mb-2 text-sm font-semibold">Offers (net = offer minus buyer shipping)</h3>
              {l.bids.length === 0 ? (
                <p className="text-sm opacity-60">Waiting for buyers...</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="opacity-60">
                    <tr><th className="text-left">Buyer</th><th className="text-right">Offer</th><th className="text-right">Shipping</th><th className="text-right">Net</th></tr>
                  </thead>
                  <tbody>
                    {l.bids.map((b) => {
                      const accepted = l.sale?.bidId === b.id;
                      return (
                        <tr key={b.id} className={`border-t border-black/10 dark:border-white/15 ${accepted ? "font-semibold text-emerald-700 dark:text-emerald-300" : ""}`}>
                          <td className="py-1.5">{b.buyer}{b.net === best && !l.sale ? " (best net)" : ""}{accepted ? " (accepted)" : ""}</td>
                          <td className="text-right">{formatUsd(b.gross)}</td>
                          <td className="text-right">-{formatUsd(b.fee)}</td>
                          <td className="text-right">{formatUsd(b.net)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {l.sale && (
                <p className="mt-4 rounded-lg bg-black/[0.03] p-3 text-sm dark:bg-white/[0.05]">
                  Sold to {l.sale.buyer}: {formatUsd(l.sale.gross)} less {formatUsd(l.sale.fee)} shipping, {formatUsd(l.sale.net)} net. Pickup {l.sale.pickup}.
                </p>
              )}
            </article>
          );
        })}
      </div>

      <aside className="rounded-xl border border-black/10 p-5 dark:border-white/15">
        <h2 className="mb-3 text-sm font-semibold">Market activity</h2>
        <ol className="space-y-2 text-sm">
          {data.events.map((e, i) => (
            <li key={i}>
              <span className="block text-xs opacity-60">{new Date(e.at).toLocaleTimeString("en-US")}</span>
              {e.text}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
