// Simulated Agora market for the demo. The listing, buyers, bids, sale, pickup, and payout
// are all simulated and labeled as such. The agent, the presenter screens, and the /agora
// page share one store, so the audience can watch the GPU lot get listed, bid on, and sold.
// Agora compares offers on net proceeds (bid minus the buyer's shipping and handling), so a
// lower headline bid can win.
import { formatUsd, type Cents } from "@/core/money";

export interface Bid {
  id: string;
  buyer: string;
  gross: Cents;
  fee: Cents;
  net: Cents;
  at: string;
}

export interface Sale {
  bidId: string;
  buyer: string;
  gross: Cents;
  fee: Cents;
  net: Cents;
  pickup: string;
  at: string;
}

export interface Listing {
  id: string;
  title: string;
  condition: string;
  serials: string[];
  status: "listed" | "sold";
  bids: Bid[];
  sale: Sale | null;
  createdAt: string;
  simulated: true;
}

export interface MarketEvent {
  at: string;
  listingId: string;
  text: string;
}

export class AgoraMarket {
  listings = new Map<string, Listing>();
  events: MarketEvent[] = [];
  private bidSeq = 0;

  reset() {
    this.listings.clear();
    this.events = [];
    this.bidSeq = 0;
  }

  private log(listingId: string, text: string) {
    this.events.push({ at: new Date().toISOString(), listingId, text });
  }

  createListing(input: { id: string; title: string; condition: string; serials: string[] }): Listing {
    if (this.listings.has(input.id)) throw new Error(`Listing ${input.id} already exists`);
    const listing: Listing = { ...input, status: "listed", bids: [], sale: null, createdAt: new Date().toISOString(), simulated: true };
    this.listings.set(listing.id, listing);
    this.log(listing.id, `Listed ${listing.title}`);
    return listing;
  }

  get(id: string): Listing {
    const listing = this.listings.get(id);
    if (!listing) throw new Error(`No Agora listing ${id}`);
    return listing;
  }

  /** Simulated buyers send their offers. Only happens once per listing. */
  collectBids(id: string, offers: { buyer: string; gross: Cents; fee: Cents }[]): Bid[] {
    const listing = this.get(id);
    if (listing.status !== "listed") throw new Error(`Listing ${id} is already sold`);
    if (listing.bids.length === 0) {
      for (const o of offers) {
        const bid = { id: `BID-${++this.bidSeq}`, ...o, net: o.gross - o.fee, at: new Date().toISOString() };
        listing.bids.push(bid);
        this.log(id, `${o.buyer} offered ${formatUsd(o.gross)}, less ${formatUsd(o.fee)} shipping: ${formatUsd(bid.net)} net`);
      }
    }
    return listing.bids;
  }

  bestNet(id: string): Bid | null {
    const bids = this.get(id).bids;
    return bids.length ? bids.reduce((a, b) => (b.net > a.net ? b : a)) : null;
  }

  /** Accepts an offer. Agora only lets the seller take the best net offer. */
  acceptBid(id: string, bidId: string, pickup: string): Sale {
    const listing = this.get(id);
    if (listing.status === "sold") throw new Error(`Listing ${id} is already sold`);
    const bid = listing.bids.find((b) => b.id === bidId);
    if (!bid) throw new Error(`No bid ${bidId} on ${id}`);
    const best = this.bestNet(id)!;
    if (bid.net < best.net) {
      throw new Error(`${bid.buyer} nets ${formatUsd(bid.net)}, less than ${best.buyer} at ${formatUsd(best.net)}. Accept the best net offer`);
    }
    listing.sale = { bidId, buyer: bid.buyer, gross: bid.gross, fee: bid.fee, net: bid.net, pickup, at: new Date().toISOString() };
    listing.status = "sold";
    this.log(id, `Sold to ${bid.buyer}: ${formatUsd(bid.gross)} less ${formatUsd(bid.fee)} shipping, ${formatUsd(bid.net)} net. Pickup ${pickup}`);
    return listing.sale;
  }

  snapshot() {
    return { listings: [...this.listings.values()], events: this.events };
  }
}

// One shared market per server process, kept across dev hot reloads.
const g = globalThis as unknown as { __agora?: AgoraMarket };
export const agora = (g.__agora ??= new AgoraMarket());
