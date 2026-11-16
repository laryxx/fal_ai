export function formatUsdFromCents(cents: number) {
  // Some image models cost under a cent; show e.g. $0.004 instead of $0.00.
  const subCent = cents > 0 && cents < 1;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: subCent ? 3 : 2,
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
