"use client";

import { useState } from "react";
import { Eraser, Wand2, X } from "lucide-react";
import { formatUsdFromCents } from "@/lib/format";
import {
  creditsToUsdCents,
  getVideoEnhanceQuote,
  getVideoRemoveQuote,
  getVideoTask,
  imageEnhanceOption,
  imageRemoveOption,
  type RemoveMode,
  type VideoResolution,
  type VideoTier,
  type VmakeOperation,
  videoRemoveModes,
  videoResolutions,
  videoTiers,
} from "@/lib/vmake-options";

export type VmakeTarget =
  | {
      type: "creative";
      kind: "image" | "video";
      creativeId: string;
      title: string;
      durationSeconds?: number;
    }
  | {
      type: "upload";
      kind: "image" | "video";
      url: string;
      fileName: string;
      durationSeconds?: number;
      width?: number;
      height?: number;
    };

export type VmakeSelection =
  | { operation: VmakeOperation; kind: "image" }
  | { operation: "enhance"; kind: "video"; tier: VideoTier; resolution: VideoResolution }
  | { operation: "remove"; kind: "video"; mode: RemoveMode };

function OptionButton(props: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`rounded-lg border px-3 py-2 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-30 ${
        props.active
          ? "border-[#ff6633]/60 bg-[#ff6633]/[0.08] text-[#ededef]"
          : "border-white/[0.06] bg-white/[0.02] text-[#9898a0] hover:border-white/[0.12]"
      }`}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      type="button"
    >
      {props.children}
    </button>
  );
}

/** Vmake job picker: enhance or remove, with options and the exact credit cost shown before confirming. */
export function VmakeDialog(props: {
  target: VmakeTarget;
  initialOperation: VmakeOperation;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (selection: VmakeSelection) => void;
}) {
  const { target } = props;
  const [operation, setOperation] = useState<VmakeOperation>(props.initialOperation);
  const [tier, setTier] = useState<VideoTier>("quality");
  const [resolution, setResolution] = useState<VideoResolution>("2K");
  const [mode, setMode] = useState<RemoveMode>("watermark");

  const duration = target.durationSeconds ?? 0;
  const title = target.type === "creative" ? target.title : target.fileName;

  let quote: { credits: number; usdCents: number; detail: string } | null = null;
  let selection: VmakeSelection | null = null;
  if (target.kind === "image") {
    const option = operation === "remove" ? imageRemoveOption : imageEnhanceOption;
    quote = { credits: option.credits, usdCents: creditsToUsdCents(option.credits), detail: "per image" };
    selection = { operation, kind: "image" };
  } else if (operation === "enhance") {
    const q = getVideoEnhanceQuote(tier, resolution, duration);
    if (q) {
      quote = { credits: q.credits, usdCents: q.usdCents, detail: `${q.seconds}s × ${q.creditsPerSecond} credits/s` };
      selection = { operation, kind: "video", tier, resolution };
    }
  } else {
    const q = getVideoRemoveQuote(mode, duration);
    if (q) {
      quote = { credits: q.credits, usdCents: q.usdCents, detail: `${q.seconds}s × ${q.creditsPerSecond} credits/s` };
      selection = { operation, kind: "video", mode };
    }
  }

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
            <h3 className="text-base font-semibold">Process with Vmake</h3>
            <p className="mt-0.5 truncate font-mono text-[11px] text-[#5c5c66]" title={title}>
              {title}
              {target.kind === "video" ? ` · ${duration.toFixed(1)}s` : ""}
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

        <div className="mt-4 grid grid-cols-2 gap-2">
          <OptionButton active={operation === "enhance"} onClick={() => setOperation("enhance")}>
            <span className="inline-flex items-center gap-1.5">
              <Wand2 className="size-3.5" /> Enhance
            </span>
          </OptionButton>
          <OptionButton active={operation === "remove"} onClick={() => setOperation("remove")}>
            <span className="inline-flex items-center gap-1.5">
              <Eraser className="size-3.5" /> {target.kind === "image" ? "Remove watermark" : "Remove"}
            </span>
          </OptionButton>
        </div>

        {target.kind === "image" ? (
          <p className="mt-3 text-xs text-[#9898a0]">
            {operation === "enhance"
              ? "Sharpens and upscales the image (about 2.7× larger, JPEG)."
              : "Removes watermarks, logos and overlaid text from the image."}
          </p>
        ) : operation === "enhance" ? (
          <>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-wide text-[#5c5c66]">Quality</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {videoTiers.map((option) => (
                <OptionButton
                  key={option.id}
                  active={tier === option.id}
                  onClick={() => {
                    setTier(option.id);
                    if (!getVideoTask(option.id, resolution)) setResolution("4K");
                  }}
                  title={option.description}
                >
                  {option.label}
                </OptionButton>
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
                  <OptionButton
                    key={option}
                    active={resolution === option}
                    disabled={!available}
                    onClick={() => setResolution(option)}
                    title={available ? undefined : "Fast mode goes up to 4K"}
                  >
                    {option}
                  </OptionButton>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-wide text-[#5c5c66]">What to remove</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {videoRemoveModes.map((option) => (
                <OptionButton
                  key={option.id}
                  active={mode === option.id}
                  onClick={() => setMode(option.id)}
                  title={option.description}
                >
                  {option.label}
                  <span className="mt-0.5 block text-[11px] font-normal text-[#5c5c66]">
                    {option.creditsPerSecond} credits/s
                  </span>
                </OptionButton>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-[#5c5c66]">
              {videoRemoveModes.find((option) => option.id === mode)?.description}
            </p>
          </>
        )}

        <div className="mt-5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          {quote ? (
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[11px] text-[#9898a0]">{quote.detail}</span>
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
          Credits are only charged if Vmake finishes the job.
          {target.kind === "video" ? " Larger videos can take several minutes." : ""}
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
            disabled={props.busy || !selection}
            onClick={() => selection && props.onConfirm(selection)}
            type="button"
          >
            {operation === "enhance" ? <Wand2 className="size-3.5" /> : <Eraser className="size-3.5" />}
            {quote ? `${operation === "enhance" ? "Enhance" : "Remove"} for ${quote.credits} credits` : "Start"}
          </button>
        </div>
      </div>
    </div>
  );
}
