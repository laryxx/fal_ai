// Vmake enhancement options and pricing. Safe to import in the browser.
//
// Catalog ids and credit prices come from the Vmake API catalog and the
// dashboard's API Pricing table (checked 2026-11-16). Dollar costs assume the
// Pro plan: $29.99 for 4,500 credits a month.

const PLAN_PRICE_USD_CENTS = 2999;
const PLAN_CREDITS = 4500;

export function creditsToUsdCents(credits: number) {
  return Math.round(((credits * PLAN_PRICE_USD_CENTS) / PLAN_CREDITS) * 100) / 100;
}

export const imageEnhanceOption = {
  task: "SKM0004",
  label: "Fast 2K",
  credits: 10,
};

export type VideoTier = "fast" | "quality" | "master";
export type VideoResolution = "2K" | "4K" | "8K";

export const videoTiers: { id: VideoTier; label: string; description: string }[] = [
  { id: "fast", label: "Fast", description: "Quickest and cheapest; good for clean footage." },
  { id: "quality", label: "Quality", description: "Better detail and noise reduction." },
  { id: "master", label: "Master", description: "Best restoration; slowest and most expensive." },
];

export const videoResolutions: VideoResolution[] = ["2K", "4K", "8K"];

// Fast has no 8K mode in the Vmake catalog.
const videoTasks: Record<VideoTier, Partial<Record<VideoResolution, { task: string; creditsPerSecond: number }>>> = {
  fast: {
    "2K": { task: "SKM0001", creditsPerSecond: 2 },
    "4K": { task: "SKM0011", creditsPerSecond: 4 },
  },
  quality: {
    "2K": { task: "SKM0008", creditsPerSecond: 3 },
    "4K": { task: "SKM0009", creditsPerSecond: 6 },
    "8K": { task: "SKM0010", creditsPerSecond: 9 },
  },
  master: {
    "2K": { task: "SKM0012", creditsPerSecond: 4 },
    "4K": { task: "SKM0013", creditsPerSecond: 8 },
    "8K": { task: "SKM0014", creditsPerSecond: 12 },
  },
};

export function getVideoTask(tier: VideoTier, resolution: VideoResolution) {
  return videoTasks[tier]?.[resolution] ?? null;
}

/** Vmake bills video per second; partial seconds are rounded up here. */
export function billableVideoSeconds(durationSeconds: number) {
  return Math.max(1, Math.ceil(durationSeconds));
}

export function getVideoEnhanceQuote(tier: VideoTier, resolution: VideoResolution, durationSeconds: number) {
  const option = getVideoTask(tier, resolution);
  if (!option) return null;
  const seconds = billableVideoSeconds(durationSeconds);
  const credits = seconds * option.creditsPerSecond;
  return {
    task: option.task,
    seconds,
    creditsPerSecond: option.creditsPerSecond,
    credits,
    usdCents: creditsToUsdCents(credits),
    label: `${videoTiers.find((t) => t.id === tier)?.label ?? tier} ${resolution}`,
  };
}

// Uploaded videos are copied into the Vercel function's /tmp before going to
// Vmake, so keep them comfortably below its 500 MB limit.
export const MAX_UPLOAD_VIDEO_BYTES = 300 * 1024 * 1024;
