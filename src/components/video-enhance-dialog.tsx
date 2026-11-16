"use client";

import { useState } from "react";
import { Wand2, X } from "lucide-react";
import { formatUsdFromCents } from "@/lib/format";
import {
  getVideoEnhanceQuote,
  getVideoTask,
  type VideoResolution,
  type VideoTier,
  videoResolutions,
  videoTiers,
} from "@/lib/vmake-options";

export type VideoEnhanceTarget =
  | { type: "creative"; creativeId: string; title: string; durationSeconds: number }
  | {
      type: "upload";
      url: string;
      fileName: string;
      durationSeconds: number;
      width?: number;
      height?: number;
    };

/** Picker for Vmake video enhancement: tier x resolution, with the credit cost shown before confirming. */
export function VideoEnhanceDialog(props: {
  target: VideoEnhanceTarget;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (tier: VideoTier, resolution: VideoResolution) => void;
}) {
  const [tier, setTier] = useState<VideoTier>("quality");
  const [resolution, setResolution] = useState<VideoResolution>("2K");
  const quote = getVideoEnhanceQuote(tier, resolution, props.target.durationSeconds);
  const title = props.target.type === "creative" ? props.target.title : props.target.fileName;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={props.onCancel}
      role="presentation"
    >
      <div
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-white/[0.08] bg-[#111114] p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Enhance video</h3>
            <p className="mt-0.5 truncate font-mono text-[11px] text-[#5c5c66]" title={title}>
              {title} · {props.target.durationSeconds.toFixed(1)}s
            </p>
          </div>
          <button
            aria-label="Close"
            className="rounded-md p-1 text-[#5c5c66] transition hover:bg-white/[0.06] hover:text-[#ededef]"
            onClick={props.onCancel}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <p className="mt-4 font-mono text-[11px] uppercase tracking-wide text-[#5c5c66]">Quality</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {videoTiers.map((option) => (
            <button
              key={option.id}
              className={`rounded-lg border px-3 py-2 text-left transition ${
                tier === option.id
                  ? "border-[#ff6633]/60 bg-[#ff6633]/[0.08] text-[#ededef]"
                  : "border-white/[0.06] bg-white/[0.02] text-[#9898a0] hover:border-white/[0.12]"
              }`}
              onClick={() => {
                setTier(option.id);
                if (!getVideoTask(option.id, resolution)) setResolution("4K");
              }}
              title={option.description}
              type="button"
            >
              <span className="text-sm font-medium">{option.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-[#5c5c66]">
          {videoTiers.find((option) => option.id === tier)?.description}
        </p>

        <p className="mt-4 font-mono text-[11px] uppercase tracking-wide text-[#5c5c66]">Output resolution</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {videoResolutions.map((option) => {
            const available = Boolean(getVideoTask(tier, option));
            return (
              <button
                key={option}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-30 ${
                  resolution === option
                    ? "border-[#ff6633]/60 bg-[#ff6633]/[0.08] text-[#ededef]"
                    : "border-white/[0.06] bg-white/[0.02] text-[#9898a0] hover:border-white/[0.12]"
                }`}
                disabled={!available}
                onClick={() => setResolution(option)}
                title={available ? undefined : "Fast mode goes up to 4K"}
                type="button"
              >
                {option}
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          {quote ? (
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[11px] text-[#9898a0]">
                {quote.seconds}s × {quote.creditsPerSecond} credits/s
              </span>
              <span className="font-mono text-sm text-[#ededef]">
                {quote.credits} Vmake credits ·{" "}
                <span className="text-[#ff6633]">{formatUsdFromCents(quote.usdCents)}</span>
              </span>
            </div>
          ) : (
            <span className="text-xs text-[#9898a0]">This combination isn&apos;t available.</span>
          )}
        </div>
        <p className="mt-2 text-xs text-[#5c5c66]">
          Credits are only charged if Vmake finishes the video. 4K and 8K can take several minutes.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-[#9898a0] transition hover:text-[#ededef]"
            onClick={props.onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-[#ff6633] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#ff7a4d] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={props.busy || !quote}
            onClick={() => props.onConfirm(tier, resolution)}
            type="button"
          >
            <Wand2 className="size-3.5" />
            {quote ? `Enhance for ${quote.credits} credits` : "Enhance"}
          </button>
        </div>
      </div>
    </div>
  );
}
