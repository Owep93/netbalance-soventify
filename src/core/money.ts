// All money is held in integer cents so sums never drift.
export type Cents = number;

export function dollars(amount: number): Cents {
  return Math.round(amount * 100);
}

export function formatUsd(cents: Cents): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

export function sum(values: Cents[]): Cents {
  return values.reduce((total, v) => total + v, 0);
}
