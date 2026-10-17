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
        No listings yet. Run the agent on the main page and the refurbished unit will appear here.
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-6">
        {data.listings.map((l) => {
          const best = l.bids.length ? Math.max(...l.bids.map((b) => b.amount)) : null;
          return (
            <article key={l.id} className="rounded-xl border border-black/10 p-5 dark:border-white/15">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs opacity-60">{l.id}</p>
                  <h2 className="text-xl font-semibold">{l.title}</h2>
                  <p className="text-sm opacity-70">Serial {l.serial}</p>
                  <p className="mt-1 text-sm">{l.condition}</p>
                </div>
                <div className="text-right">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      l.status === "sold"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                        : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
                    }`}
                  >
                    {l.status === "sold" ? "Sold" : "Listed"}
                  </span>
                  <p className="mt-2 text-sm opacity-70">Asking</p>
                  <p className="text-2xl font-bold">{formatUsd(l.askingPrice)}</p>
                </div>
              </div>

              <h3 className="mt-5 mb-2 text-sm font-semibold">Bids</h3>
              {l.bids.length === 0 ? (
                <p className="text-sm opacity-60">Waiting for buyers...</p>
              ) : (
                <ul className="divide-y divide-black/10 text-sm dark:divide-white/15">
                  {l.bids.map((b) => {
                    const accepted = l.sale?.bidId === b.id;
                    return (
                      <li key={b.id} className="flex items-center justify-between py-2">
                        <span>
                          {b.buyer}
                          {b.amount === best && !l.sale && <span className="ml-2 text-xs opacity-60">highest</span>}
                        </span>
                        <span className={accepted ? "font-semibold text-emerald-700 dark:text-emerald-300" : ""}>
                          {formatUsd(b.amount)}
                          {accepted && " accepted"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {l.sale && (
                <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-black/[0.03] p-4 text-sm sm:grid-cols-4 dark:bg-white/[0.05]">
                  <div><dt className="opacity-70">Sale price</dt><dd className="font-semibold">{formatUsd(l.sale.price)}</dd></div>
                  <div><dt className="opacity-70">Agora fee ({Math.round(l.feeRate * 100)}%)</dt><dd className="font-semibold">-{formatUsd(l.sale.fee)}</dd></div>
                  <div><dt className="opacity-70">Payout to seller</dt><dd className="font-semibold">{formatUsd(l.sale.netPayout)}</dd></div>
                  <div><dt className="opacity-70">Buyer</dt><dd className="font-semibold">{l.sale.buyer}</dd></div>
                  <div className="col-span-2 mt-2 sm:col-span-4"><dt className="inline opacity-70">Pickup: </dt><dd className="inline">{l.sale.pickup}</dd></div>
                </dl>
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
