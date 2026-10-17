// Simulated Agora reseller market for the demo. Listings, bids, sale, pickup, and payout
// are all simulated and labeled as such. The agent and the /agora page share one store,
// so the audience can watch the failed unit get listed, bid on, and sold.
import { formatUsd, type Cents } from "@/core/money";

export interface Bid {
  id: string;
  buyer: string;
  amount: Cents;
  at: string;
}

export interface Listing {
  id: string;
  title: string;
  serial: string;
  condition: string;
  askingPrice: Cents;
  feeRate: number;
  status: "listed" | "sold";
  bids: Bid[];
  sale: { bidId: string; buyer: string; price: Cents; fee: Cents; netPayout: Cents; pickup: string; at: string } | null;
  createdAt: string;
  simulated: true;
}

export interface MarketEvent {
  at: string;
  listingId: string;
  text: string;
}

export interface SimulatedBuyer {
  buyer: string;
  amount: Cents;
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

  createListing(input: Omit<Listing, "status" | "bids" | "sale" | "createdAt" | "simulated">): Listing {
    if (this.listings.has(input.id)) throw new Error(`Listing ${input.id} already exists`);
    const listing: Listing = { ...input, status: "listed", bids: [], sale: null, createdAt: new Date().toISOString(), simulated: true };
    this.listings.set(listing.id, listing);
    this.log(listing.id, `Listed ${listing.title} at ${formatUsd(listing.askingPrice)}`);
    return listing;
  }

  get(id: string): Listing {
    const listing = this.listings.get(id);
    if (!listing) throw new Error(`No Agora listing ${id}`);
    return listing;
  }

  /** Simulated buyers place their bids. Only happens once per listing. */
  collectBids(id: string, buyers: SimulatedBuyer[]): Bid[] {
    const listing = this.get(id);
    if (listing.status !== "listed") throw new Error(`Listing ${id} is already sold`);
    if (listing.bids.length === 0) {
      for (const b of buyers) {
        const bid = { id: `BID-${++this.bidSeq}`, buyer: b.buyer, amount: b.amount, at: new Date().toISOString() };
        listing.bids.push(bid);
        this.log(id, `${b.buyer} bid ${formatUsd(b.amount)}`);
      }
    }
    return listing.bids;
  }

  /** Accepts a bid. Agora only lets the seller take the highest bid. */
  acceptBid(id: string, bidId: string): NonNullable<Listing["sale"]> {
    const listing = this.get(id);
    if (listing.status === "sold") throw new Error(`Listing ${id} is already sold`);
    const bid = listing.bids.find((b) => b.id === bidId);
    if (!bid) throw new Error(`No bid ${bidId} on ${id}`);
    const best = Math.max(...listing.bids.map((b) => b.amount));
    if (bid.amount < best) throw new Error(`Bid ${bidId} is not the highest bid (${formatUsd(best)})`);

    const fee = Math.round(bid.amount * listing.feeRate);
    listing.sale = {
      bidId,
      buyer: bid.buyer,
      price: bid.amount,
      fee,
      netPayout: bid.amount - fee,
      pickup: "Courier pickup booked from the customer site (simulated)",
      at: new Date().toISOString(),
    };
    listing.status = "sold";
    this.log(id, `Sold to ${bid.buyer} for ${formatUsd(bid.amount)}. Agora fee ${formatUsd(fee)}, payout ${formatUsd(bid.amount - fee)}`);
    return listing.sale;
  }

  snapshot() {
    return { listings: [...this.listings.values()], events: this.events };
  }
}

// One shared market per server process, kept across dev hot reloads.
const g = globalThis as unknown as { __agora?: AgoraMarket };
export const agora = (g.__agora ??= new AgoraMarket());
