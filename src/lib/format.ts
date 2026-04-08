export function formatUsdFromCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatDateTime(value: number | null) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function formatBillableUnits(count: number, unit: string) {
  if (unit === "second") {
    return `${count}s`;
  }

  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}
