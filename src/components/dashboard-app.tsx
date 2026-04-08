"use client";

/* eslint-disable @next/next/no-img-element */

import { startTransition, useEffect, useState } from "react";
import {
  AlertTriangle,
  Copy,
  Download,
  Film,
  ImagePlus,
  LogOut,
  RotateCcw,
  Send,
  Shield,
  Sparkles,
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  formatBillableUnits,
  formatDateTime,
  formatUsdFromCents,
} from "@/lib/format";
import {
  getAspectRatioOptions,
  imageModelOptions,
  videoModelOptions,
} from "@/lib/models";
import type { AppData, CreativeSummary, MemberDetail } from "@/lib/types";

type Tab = "image" | "video";
type UploadPreview = {
  file: File;
  previewUrl: string;
};

const defaultImageModelId = "nano-banana-pro";
const defaultVideoModelId = "sora-2";

function buildGenerationFormData(args: {
  kind: Tab;
  prompt: string;
  modelId: string;
  aspectRatio: string;
  count: string;
  duration?: string;
  references?: UploadPreview[];
}) {
  const formData = new FormData();
  formData.set("kind", args.kind);
  formData.set("prompt", args.prompt);
  formData.set("modelId", args.modelId);
  formData.set("aspectRatio", args.aspectRatio);
  formData.set("count", args.count);

  if (args.kind === "video" && args.duration) {
    formData.set("duration", args.duration);
  }

  for (const item of args.references ?? []) {
    formData.append("references", item.file);
  }

  return formData;
}

function resolveCreativeModelId(creative: CreativeSummary) {
  if (creative.kind === "image") {
    return imageModelOptions.some((option) => option.id === creative.modelFamily)
      ? creative.modelFamily
      : defaultImageModelId;
  }

  return videoModelOptions.some((option) => option.id === creative.modelFamily)
    ? creative.modelFamily
    : defaultVideoModelId;
}

function resolveCreativeAspectRatio(creative: CreativeSummary) {
  const options = getAspectRatioOptions(creative.kind);
  return options.includes(creative.aspectRatio)
    ? creative.aspectRatio
    : options[0];
}

function getCreativeDownloadName(creative: CreativeSummary) {
  const mimeType = creative.outputMimeType ?? "";
  const extension =
    creative.kind === "video"
      ? mimeType.includes("webm")
        ? "webm"
        : "mp4"
      : mimeType.includes("jpeg") || mimeType.includes("jpg")
        ? "jpg"
        : mimeType.includes("webp")
          ? "webp"
          : "png";
  const slug = creative.modelLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return `${slug || creative.kind}-${creative.id}.${extension}`;
}

function getCreativeDownloadHref(creative: CreativeSummary) {
  if (!creative.outputUrl) {
    return "#";
  }

  const params = new URLSearchParams({
    url: creative.outputUrl,
    filename: getCreativeDownloadName(creative),
  });

  return `/api/download?${params.toString()}`;
}

export function DashboardApp({ initialData }: { initialData: AppData }) {
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<Tab>("image");
  const [imagePrompt, setImagePrompt] = useState("");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [imageModelId, setImageModelId] = useState("nano-banana-pro");
  const [videoModelId, setVideoModelId] = useState("sora-2");
  const [imageAspectRatio, setImageAspectRatio] = useState("16:9");
  const [videoAspectRatio, setVideoAspectRatio] = useState("16:9");
  const [imageCount, setImageCount] = useState("1");
  const [videoCount, setVideoCount] = useState("1");
  const [videoDuration, setVideoDuration] = useState("8");
  const [inviteEmail, setInviteEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageReferences, setImageReferences] = useState<UploadPreview[]>([]);
  const [videoReferences, setVideoReferences] = useState<UploadPreview[]>([]);
  const currentYear = new Date().getFullYear();
  const [teamYear, setTeamYear] = useState<number | null>(null);
  const [teamMonth, setTeamMonth] = useState<number | null>(null);
  const [filteredUsers, setFilteredUsers] = useState(initialData.team?.users ?? []);
  const [memberDetail, setMemberDetail] = useState<MemberDetail | null>(null);
  const [memberDetailTab, setMemberDetailTab] = useState<"log" | "summary">("log");

  async function submitGeneration(args: {
    kind: Tab;
    prompt: string;
    modelId: string;
    aspectRatio: string;
    count: string;
    duration?: string;
    references?: UploadPreview[];
    onSuccess?: () => void;
  }) {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        body: buildGenerationFormData(args),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error ?? "Could not submit the generation request");
        return;
      }

      setMessage(
        args.kind === "image"
          ? "Image jobs submitted. Gallery refreshes when results land."
          : "Video jobs submitted. Gallery refreshes as clips finish.",
      );
      args.onSuccess?.();
      await refreshData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshData() {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const payload = await response.json();
    startTransition(() => {
      setData(payload);
    });
  }

  useEffect(() => {
    const imageUrls = imageReferences.map((item) => item.previewUrl);
    const videoUrls = videoReferences.map((item) => item.previewUrl);

    return () => {
      for (const url of imageUrls) {
        URL.revokeObjectURL(url);
      }
      for (const url of videoUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [imageReferences, videoReferences]);

  useEffect(() => {
    let fromTimestamp = 0;
    let toTimestamp = 0;

    if (teamYear !== null) {
      const month = teamMonth;
      if (month !== null) {
        fromTimestamp = new Date(teamYear, month, 1).getTime();
        toTimestamp = new Date(teamYear, month + 1, 1).getTime();
      } else {
        fromTimestamp = new Date(teamYear, 0, 1).getTime();
        toTimestamp = new Date(teamYear + 1, 0, 1).getTime();
      }
    }

    fetch("/api/admin/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromTimestamp, toTimestamp }),
    })
      .then((r) => r.json())
      .then((payload) => {
        if (payload.users) setFilteredUsers(payload.users);
      })
      .catch((e) => console.error("team filter failed:", e));
  }, [teamYear, teamMonth, data.team]);

  const hasPending = (data.snapshot?.creatives ?? []).some(
    (c) => c.status === "queued" || c.status === "processing",
  );

  useEffect(() => {
    if (!hasPending) {
      return;
    }

    let disposed = false;

    const sync = async () => {
      if (disposed) return;
      await fetch("/api/creatives/sync", { method: "POST" });
      if (!disposed) await refreshData();
    };

    const intervalId = window.setInterval(sync, 7000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [hasPending]);

  async function runGeneration() {
    if (tab === "image") {
      await submitGeneration({
        kind: "image",
        prompt: imagePrompt,
        modelId: imageModelId,
        aspectRatio: imageAspectRatio,
        count: imageCount,
        references: imageReferences,
        onSuccess: () => {
          setImagePrompt("");
          setImageReferences([]);
        },
      });
      return;
    }

    await submitGeneration({
      kind: "video",
      prompt: videoPrompt,
      modelId: videoModelId,
      aspectRatio: videoAspectRatio,
      count: videoCount,
      duration: videoDuration,
      references: videoReferences,
      onSuccess: () => {
        setVideoPrompt("");
        setVideoReferences([]);
      },
    });
  }

  async function copyPrompt(creative: CreativeSummary) {
    try {
      await navigator.clipboard.writeText(creative.prompt);
      setMessage("Prompt copied to clipboard.");
    } catch {
      setMessage("Could not copy the prompt on this device.");
    }
  }

  async function regenerateCreative(creative: CreativeSummary) {
    const modelId = resolveCreativeModelId(creative);
    const aspectRatio = resolveCreativeAspectRatio(creative);

    if (creative.kind === "image") {
      setTab("image");
      setImagePrompt(creative.prompt);
      setImageModelId(modelId);
      setImageAspectRatio(aspectRatio);
      setImageCount("1");
      setImageReferences([]);

      await submitGeneration({
        kind: "image",
        prompt: creative.prompt,
        modelId,
        aspectRatio,
        count: "1",
      });
      return;
    }

    const duration = String(creative.durationSeconds ?? 8);

    setTab("video");
    setVideoPrompt(creative.prompt);
    setVideoModelId(modelId);
    setVideoAspectRatio(aspectRatio);
    setVideoCount("1");
    setVideoDuration(duration);
    setVideoReferences([]);

    await submitGeneration({
      kind: "video",
      prompt: creative.prompt,
      modelId,
      aspectRatio,
      count: "1",
      duration,
    });
  }

  async function createInvite() {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error ?? "Could not create the invite");
        return;
      }

      setInviteEmail("");
      setMessage("Invite created. That email can now sign up.");
      await refreshData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  async function viewMember(memberId: string) {
    setMemberDetail(null);
    setMemberDetailTab("log");
    const response = await fetch("/api/admin/member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId }),
    });
    const payload = await response.json();
    setMemberDetail(payload);
  }

  async function manageUser(userId: string, action: "delete" | "promote") {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error ?? "Action failed");
        return;
      }

      setMessage(action === "delete" ? "User deleted." : "User promoted to admin.");
      await refreshData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.reload();
  }

  const snapshot = data.snapshot;
  const team = data.team;

  if (!snapshot) {
    return null;
  }

  const imageModel = imageModelOptions.find((option) => option.id === imageModelId);
  const videoModel = videoModelOptions.find((option) => option.id === videoModelId);

  return (
    <div className="min-h-screen bg-[#08080a] text-[#ededef]">
      <iframe className="hidden" name="creative-download-frame" title="Creative download" />

      {/* Dot grid background */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Top nav */}
      <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#08080a]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-12 max-w-[1400px] items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#ff6633]">
              <Sparkles className="size-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold tracking-tight">fal</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-xs text-[#5c5c66] sm:block">
              {snapshot.currentUser.email}
            </span>
            <span className="rounded-full bg-[#ff6633]/10 px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wider text-[#ff6633]">
              {snapshot.currentUser.role}
            </span>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-[#5c5c66] transition hover:border-white/[0.12] hover:text-[#9898a0]"
              onClick={signOut}
              type="button"
              title="Sign out"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </div>
      </nav>

      <main className="relative mx-auto max-w-[1400px] space-y-4 px-5 py-5">
        {/* Config error */}
        {data.configurationError ? (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            {data.configurationError}
          </div>
        ) : null}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            icon={<Sparkles className="size-4" />}
            label="Outputs"
            value={String(snapshot.currentUser.creativeCount)}
            sub="total creatives"
          />
          <StatCard
            icon={<ImagePlus className="size-4" />}
            label="Images"
            value={String(snapshot.currentUser.imageCount)}
            sub="generated"
          />
          <StatCard
            icon={<Film className="size-4" />}
            label="Videos"
            value={String(snapshot.currentUser.videoCount)}
            sub="rendered"
          />
          <StatCard
            icon={<Wallet className="size-4" />}
            label="Spend"
            value={formatUsdFromCents(snapshot.currentUser.spendUsdCents)}
            sub={`${snapshot.currentUser.billableUnits} units`}
          />
        </div>

        {/* Generator + Admin */}
        <div
          className={`grid gap-4 ${
            snapshot.currentUser.role === "admin" && team
              ? "xl:grid-cols-[1.2fr_0.8fr]"
              : ""
          }`}
        >
          {/* Generator */}
          <section className="rounded-xl border border-white/[0.06] bg-[#111114] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold tracking-tight">Generate</h2>
              <div className="flex gap-0.5 rounded-lg bg-white/[0.04] p-0.5">
                <TabButton active={tab === "image"} onClick={() => setTab("image")}>
                  <ImagePlus className="size-3.5" />
                  Image
                </TabButton>
                <TabButton active={tab === "video"} onClick={() => setTab("video")}>
                  <Film className="size-3.5" />
                  Video
                </TabButton>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <textarea
                className="w-full rounded-lg border border-white/[0.06] bg-[#0c0c0f] px-4 py-3 text-sm leading-relaxed text-[#ededef] outline-none transition placeholder:text-[#3d3d44] focus:border-[#ff6633]/30 focus:ring-1 focus:ring-[#ff6633]/20"
                onChange={(event) =>
                  tab === "image"
                    ? setImagePrompt(event.target.value)
                    : setVideoPrompt(event.target.value)
                }
                placeholder={
                  tab === "image"
                    ? "Describe the image — style, composition, lighting, mood..."
                    : "Describe the video — action, camera movement, pacing, atmosphere..."
                }
                rows={4}
                value={tab === "image" ? imagePrompt : videoPrompt}
              />

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SelectField
                  label="Model"
                  options={tab === "image" ? imageModelOptions : videoModelOptions}
                  value={tab === "image" ? imageModelId : videoModelId}
                  onChange={(value) =>
                    tab === "image" ? setImageModelId(value) : setVideoModelId(value)
                  }
                />
                <SelectField
                  label="Ratio"
                  options={getAspectRatioOptions(tab)}
                  value={tab === "image" ? imageAspectRatio : videoAspectRatio}
                  onChange={(value) =>
                    tab === "image"
                      ? setImageAspectRatio(value)
                      : setVideoAspectRatio(value)
                  }
                />
                <SelectField
                  label="Count"
                  options={tab === "image" ? ["1", "2", "3", "4"] : ["1", "2", "3"]}
                  value={tab === "image" ? imageCount : videoCount}
                  onChange={(value) =>
                    tab === "image" ? setImageCount(value) : setVideoCount(value)
                  }
                />
                {tab === "video" ? (
                  <SelectField
                    label="Duration"
                    options={["4", "8"]}
                    value={videoDuration}
                    onChange={setVideoDuration}
                    renderLabel={(value) => `${value}s`}
                  />
                ) : null}
              </div>

              {/* Model info inline */}
              <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs">
                  <div className="h-1.5 w-1.5 rounded-full bg-[#ff6633]" />
                  <span className="font-medium text-[#9898a0]">
                    {tab === "image" ? imageModel?.label : videoModel?.label}
                  </span>
                  <span className="hidden text-[#3d3d44] sm:inline">
                    {tab === "image" ? imageModel?.description : videoModel?.description}
                  </span>
                </div>
                <span className="font-mono text-xs font-medium text-[#ff6633]">
                  {tab === "image" ? imageModel?.priceLabel : videoModel?.priceLabel}
                </span>
              </div>

              <UploadField
                maxFiles={tab === "image" ? 4 : 1}
                previews={tab === "image" ? imageReferences : videoReferences}
                onAdd={(files) => {
                  const current = tab === "image" ? imageReferences : videoReferences;
                  const setter = tab === "image" ? setImageReferences : setVideoReferences;
                  const max = tab === "image" ? 4 : 1;
                  const newItems = files.map((file) => ({
                    file,
                    previewUrl: URL.createObjectURL(file),
                  }));
                  setter([...current, ...newItems].slice(0, max));
                }}
                onRemove={(index) => {
                  const current = tab === "image" ? imageReferences : videoReferences;
                  const setter = tab === "image" ? setImageReferences : setVideoReferences;
                  URL.revokeObjectURL(current[index].previewUrl);
                  setter(current.filter((_, i) => i !== index));
                }}
              />

              <button
                className="w-full rounded-lg bg-[#ff6633] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#ff7a4d] disabled:cursor-not-allowed disabled:opacity-40"
                disabled={busy || Boolean(data.configurationError)}
                onClick={runGeneration}
                type="button"
              >
                <span className="flex items-center justify-center gap-2">
                  <Send className="size-3.5" />
                  {busy
                    ? "Submitting..."
                    : tab === "image"
                      ? "Generate images"
                      : "Generate videos"}
                </span>
              </button>

              {message ? (
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-xs text-[#9898a0]">
                  {message}
                </div>
              ) : null}
            </div>
          </section>

          {/* Admin panel */}
          {snapshot.currentUser.role === "admin" && team ? (
            <section className="rounded-xl border border-white/[0.06] bg-[#111114] p-5">
              {memberDetail ? (
                <>
                  {/* Member detail header */}
                  <div className="flex items-center gap-3">
                    <button
                      className="font-mono text-[11px] text-[#5c5c66] transition hover:text-[#ededef]"
                      onClick={() => setMemberDetail(null)}
                      type="button"
                    >
                      ← back
                    </button>
                    <span className="text-sm font-medium">{memberDetail.summary.email}</span>
                    <div className="ml-auto flex items-center gap-2">
                      {memberDetailTab === "log" ? (
                        <button
                          className="rounded px-2.5 py-1 font-mono text-[11px] text-[#5c5c66] transition hover:bg-white/[0.06] hover:text-[#ededef]"
                          onClick={async () => {
                            const response = await fetch("/api/admin/member/export", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ memberId: memberDetail.summary.id }),
                            });
                            if (!response.ok) {
                              const err = await response.text();
                              console.error("Export failed:", err);
                              return;
                            }
                            const blob = await response.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `${memberDetail.summary.email}-generations.xlsx`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          type="button"
                        >
                          export .xlsx
                        </button>
                      ) : null}
                      {(["log", "summary"] as const).map((t) => (
                        <button
                          key={t}
                          className={`rounded px-2.5 py-1 font-mono text-[11px] transition ${memberDetailTab === t ? "bg-[#ff6633]/20 text-[#ff6633]" : "text-[#5c5c66] hover:bg-white/[0.04] hover:text-[#9898a0]"}`}
                          onClick={() => setMemberDetailTab(t)}
                          type="button"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Summary tab */}
                  {memberDetailTab === "summary" ? (
                    <div className="mt-4 space-y-2">
                      {[
                        ["Email", memberDetail.summary.email],
                        ["Role", memberDetail.summary.role],
                        ["Invited", formatDateTime(memberDetail.summary.invitedAt)],
                        ["Joined", formatDateTime(memberDetail.summary.acceptedAt ?? memberDetail.summary.createdAt)],
                        ["Total spend", formatUsdFromCents(memberDetail.summary.spendUsdCents)],
                        ["Outputs", String(memberDetail.summary.creativeCount)],
                        ["Images", String(memberDetail.summary.imageCount)],
                        ["Videos", String(memberDetail.summary.videoCount)],
                      ].map(([label, value]) => (
                        <div key={label} className="flex justify-between rounded-lg px-3 py-2 hover:bg-white/[0.02]">
                          <span className="font-mono text-[11px] text-[#5c5c66]">{label}</span>
                          <span className="font-mono text-[11px] text-[#ededef]">{value}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {/* Log tab */}
                  {memberDetailTab === "log" ? (
                    <div className="mt-4 h-[480px] overflow-y-auto space-y-0.5">
                      {memberDetail.log.length === 0 ? (
                        <p className="px-3 py-4 text-center font-mono text-[11px] text-[#5c5c66]">No generations yet</p>
                      ) : memberDetail.log.map((entry) => (
                        <div key={entry.id} className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-white/[0.03]">
                          {/* Thumbnail */}
                          <div className="size-8 shrink-0 overflow-hidden rounded bg-white/[0.04]">
                            {entry.asset?.publicUrl && entry.kind === "image" ? (
                              <img alt="" className="size-full object-cover" src={entry.asset.publicUrl} />
                            ) : entry.kind === "video" ? (
                              <div className="flex size-full items-center justify-center">
                                <Film className="size-3.5 text-[#5c5c66]" />
                              </div>
                            ) : null}
                          </div>

                          {/* Date + cost */}
                          <div className="w-28 shrink-0">
                            <p className="font-mono text-[10px] text-[#5c5c66]">{formatDateTime(entry.createdAt)}</p>
                            <p className="font-mono text-[10px] text-[#ff6633]">{formatUsdFromCents(entry.actualCostUsdCents)}</p>
                          </div>

                          {/* Prompt */}
                          <p className="w-0 flex-1 truncate font-mono text-[11px] text-[#9898a0]" title={entry.prompt}>
                            {entry.prompt}
                          </p>

                          {/* Actions */}
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              className="rounded p-1 text-[#5c5c66] transition hover:bg-white/[0.06] hover:text-[#ededef]"
                              onClick={() => navigator.clipboard.writeText(entry.prompt)}
                              title="Copy prompt"
                              type="button"
                            >
                              <Copy className="size-3" />
                            </button>
                            {entry.outputUrl ? (
                              <a
                                className="rounded p-1 text-[#5c5c66] transition hover:bg-white/[0.06] hover:text-[#ededef]"
                                download
                                href={`/api/download?url=${encodeURIComponent(entry.outputUrl)}&filename=${entry.kind}-${entry.id}`}
                                title="Download"
                              >
                                <Download className="size-3" />
                              </a>
                            ) : null}
                          </div>

                          {/* Status */}
                          <span className={`shrink-0 font-mono text-[10px] ${entry.status === "completed" ? "text-[#5c5c66]" : entry.status === "failed" ? "text-red-400/60" : "text-[#ff6633]/60"}`}>
                            {entry.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
              <div className="flex items-center gap-2">
                <Shield className="size-4 text-[#ff6633]" />
                <h2 className="text-base font-semibold tracking-tight">Team</h2>
              </div>

              <div className="mt-4 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-[#0c0c0f] px-3 py-2.5 text-sm text-[#ededef] outline-none transition placeholder:text-[#3d3d44] focus:border-[#ff6633]/30"
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="email@company.com"
                  value={inviteEmail}
                />
                <button
                  className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3.5 py-2.5 text-sm font-medium text-[#ededef] transition hover:bg-white/10"
                  onClick={createInvite}
                  type="button"
                >
                  <Users className="size-3.5" />
                  Invite
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  className={`rounded px-2.5 py-1 font-mono text-[11px] transition ${teamYear === null ? "bg-[#ff6633]/20 text-[#ff6633]" : "text-[#5c5c66] hover:bg-white/[0.04] hover:text-[#9898a0]"}`}
                  onClick={() => { setTeamYear(null); setTeamMonth(null); }}
                  type="button"
                >
                  All time
                </button>
                {teamYear === null ? (
                  <button
                    className="rounded px-2.5 py-1 font-mono text-[11px] text-[#5c5c66] transition hover:bg-white/[0.04] hover:text-[#9898a0]"
                    onClick={() => setTeamYear(currentYear)}
                    type="button"
                  >
                    Pick period
                  </button>
                ) : (
                  <>
                    <select
                      className="rounded bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-[#9898a0] outline-none"
                      onChange={(e) => { setTeamYear(Number(e.target.value)); setTeamMonth(null); }}
                      value={teamYear}
                    >
                      {[2026, 2027, 2028, 2029, 2030].map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                    <select
                      className="rounded bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-[#9898a0] outline-none"
                      onChange={(e) => setTeamMonth(e.target.value === "" ? null : Number(e.target.value))}
                      value={teamMonth ?? ""}
                    >
                      <option value="">All months</option>
                      {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                        <option key={m} value={i}>{m}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>

              <div className="space-y-0.5">
                {filteredUsers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between rounded-lg px-3 py-3 transition hover:bg-white/[0.03]"
                  >
                    <div>
                      <p className="text-sm font-medium">{member.email}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-[#5c5c66]">
                        {member.role} · {formatDateTime(member.lastLoginAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="font-mono text-sm font-medium text-[#ff6633]">
                          {formatUsdFromCents(member.spendUsdCents)}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-[#5c5c66]">
                          {member.creativeCount} outputs
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          className="rounded px-2 py-1 font-mono text-[11px] text-[#5c5c66] transition hover:bg-white/[0.06] hover:text-[#ededef]"
                          onClick={() => viewMember(member.id)}
                          type="button"
                        >
                          log
                        </button>
                        {member.id !== snapshot.currentUser.id ? (
                          <>
                            {member.role !== "admin" ? (
                              <button
                                className="rounded px-2 py-1 font-mono text-[11px] text-[#5c5c66] transition hover:bg-white/[0.06] hover:text-[#ededef]"
                                disabled={busy}
                                onClick={() => manageUser(member.id, "promote")}
                                title="Promote to admin"
                                type="button"
                              >
                                promote
                              </button>
                            ) : null}
                            <button
                              className="rounded px-2 py-1 font-mono text-[11px] text-[#5c5c66] transition hover:bg-red-500/10 hover:text-red-400"
                              disabled={busy}
                              onClick={() => {
                                if (confirm(`Delete ${member.email}? This cannot be undone.`)) {
                                  manageUser(member.id, "delete");
                                }
                              }}
                              title="Delete user"
                              type="button"
                            >
                              delete
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {team.invites.length > 0 ? (
                <div className="mt-4 border-t border-white/[0.06] pt-4">
                  <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[#5c5c66]">
                    Pending invites
                  </p>
                  <div className="max-h-[300px] overflow-y-auto space-y-0.5">
                    {team.invites.map((invite) => (
                      <div
                        key={invite.id}
                        className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2.5 text-sm"
                      >
                        <div>
                          <span className="text-[#9898a0]">{invite.email}</span>
                          {invite.acceptedAt && invite.status === "accepted" ? (
                            <p className="mt-0.5 font-mono text-[11px] text-[#5c5c66]">
                              accepted {formatDateTime(invite.acceptedAt)}
                            </p>
                          ) : null}
                          {invite.userDeletedAt ? (
                            <p className="mt-0.5 font-mono text-[11px] text-red-400/60">
                              user deleted {formatDateTime(invite.userDeletedAt)}
                            </p>
                          ) : null}
                        </div>
                        <span className="font-mono text-[11px] text-[#5c5c66]">
                          {invite.userDeletedAt ? "deleted" : invite.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
                </>
              )}
            </section>
          ) : null}
        </div>

        {/* Gallery */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight">Gallery</h2>
            <span className="font-mono text-xs text-[#5c5c66]">
              {snapshot.creatives.length} recent
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {snapshot.creatives.map((creative) => (
              <article
                key={creative.id}
                className="group overflow-hidden rounded-xl border border-white/[0.06] bg-[#111114] transition hover:border-white/[0.12]"
              >
                <div className="relative aspect-[16/10] bg-[#0c0c0f]">
                  {creative.outputUrl ? (
                    creative.kind === "video" ? (
                      <video
                        className="h-full w-full object-cover"
                        controls
                        muted
                        playsInline
                        src={creative.outputUrl}
                      />
                    ) : (
                      <img
                        alt={creative.prompt}
                        className="h-full w-full object-cover"
                        src={creative.outputUrl}
                      />
                    )
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2">
                      {creative.status === "failed" ? (
                        <>
                          <div className="h-2 w-2 rounded-full bg-red-400" />
                          <span className="text-xs text-red-400">Failed</span>
                        </>
                      ) : (
                        <>
                          <div className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                          <span className="text-xs text-[#5c5c66]">
                            {creative.status === "processing"
                              ? "Rendering..."
                              : "Queued"}
                          </span>
                          <div className="absolute inset-0 animate-shimmer" />
                        </>
                      )}
                    </div>
                  )}
                  <div className="absolute right-2 top-2">
                    <StatusDot status={creative.status} />
                  </div>
                </div>

                <div className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{creative.modelLabel}</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-[#5c5c66]">
                        {creative.userEmail} · {formatDateTime(creative.createdAt)}
                      </p>
                    </div>
                  </div>
                  <p className="line-clamp-2 text-xs leading-relaxed text-[#9898a0]">
                    {creative.prompt}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <MetaChip>{creative.aspectRatio}</MetaChip>
                    {creative.durationSeconds ? (
                      <MetaChip>{creative.durationSeconds}s</MetaChip>
                    ) : null}
                    {creative.resolution ? (
                      <MetaChip>{creative.resolution}</MetaChip>
                    ) : null}
                    <MetaChip>
                      {formatBillableUnits(
                        creative.billableUnits,
                        creative.billingUnit,
                      )}
                    </MetaChip>
                    <MetaChip accent>
                      {formatUsdFromCents(creative.actualCostUsdCents)}
                    </MetaChip>
                  </div>
                  {creative.errorMessage ? (
                    <p className="rounded-md border border-red-500/20 bg-red-500/[0.06] px-2.5 py-1.5 text-xs text-red-300">
                      {creative.errorMessage}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-2">
                    <button
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-[#9898a0] transition hover:border-white/[0.12] hover:text-[#ededef] disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={busy}
                      onClick={() => void copyPrompt(creative)}
                      type="button"
                    >
                      <Copy className="size-3.5" />
                      Copy prompt
                    </button>
                    <button
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-[#9898a0] transition hover:border-white/[0.12] hover:text-[#ededef] disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={busy || Boolean(data.configurationError)}
                      onClick={() => void regenerateCreative(creative)}
                      type="button"
                    >
                      <RotateCcw className="size-3.5" />
                      Regenerate
                    </button>
                    {creative.outputUrl ? (
                      <a
                        className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-[#9898a0] transition hover:border-white/[0.12] hover:text-[#ededef]"
                        href={getCreativeDownloadHref(creative)}
                        target="creative-download-frame"
                      >
                        <Download className="size-3.5" />
                        Download
                      </a>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111114] p-4 transition hover:border-white/10">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-[#5c5c66]">
          {props.label}
        </span>
        <div className="text-[#5c5c66]">{props.icon}</div>
      </div>
      <p className="mt-3 font-mono text-2xl font-bold tracking-tight">
        {props.value}
      </p>
      <p className="mt-1 text-xs text-[#5c5c66]">{props.sub}</p>
    </div>
  );
}

function SelectField(props: {
  label: string;
  options: readonly { id: string; label: string }[] | string[];
  value: string;
  onChange: (value: string) => void;
  renderLabel?: (value: string) => string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-[#5c5c66]">
        {props.label}
      </span>
      <select
        className="w-full appearance-none rounded-lg border border-white/[0.06] bg-[#0c0c0f] px-3 py-2.5 text-sm text-[#ededef] outline-none transition focus:border-[#ff6633]/30"
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      >
        {props.options.map((option) => {
          const value = typeof option === "string" ? option : option.id;
          const label =
            typeof option === "string"
              ? props.renderLabel
                ? props.renderLabel(option)
                : option
              : option.label;

          return (
            <option className="bg-[#111114] text-[#ededef]" key={value} value={value}>
              {label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function TabButton(props: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
        props.active
          ? "bg-[#ff6633] text-white"
          : "text-[#5c5c66] hover:text-[#9898a0]"
      }`}
      onClick={props.onClick}
      type="button"
    >
      {props.children}
    </button>
  );
}

function UploadField(props: {
  previews: UploadPreview[];
  maxFiles: number;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (props.previews.length >= props.maxFiles) return;
      const imageItem = Array.from(e.clipboardData?.items ?? []).find((item) =>
        item.type.startsWith("image/"),
      );
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file) props.onAdd([file]);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [props]);

  return (
    <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] p-3">
      <div className="flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-1.5 rounded-md bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-[#9898a0] transition hover:bg-white/10">
          <Upload className="size-3.5" />
          Add references
          <input
            accept="image/*"
            className="hidden"
            multiple={props.maxFiles > 1}
            onChange={(event) => props.onAdd(Array.from(event.target.files ?? []))}
            type="file"
          />
        </label>
        <span className="text-[11px] text-[#3d3d44]">
          JPG, PNG — optional · paste to add
          {props.maxFiles > 1 ? ` · max ${props.maxFiles}` : ""}
        </span>
      </div>
      {props.previews.length > 0 ? (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
          {props.previews.map((preview, index) => (
            <div
              key={`${preview.file.name}-${preview.file.lastModified}`}
              className="group relative overflow-hidden rounded-md border border-white/[0.06]"
            >
              <img
                alt={preview.file.name}
                className="aspect-square h-full w-full object-cover"
                src={preview.previewUrl}
              />
              <button
                className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 opacity-0 transition group-hover:opacity-100"
                onClick={() => props.onRemove(index)}
                type="button"
              >
                <X className="size-2.5 text-white" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusDot(props: { status: string }) {
  if (props.status === "completed") {
    return (
      <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
    );
  }
  if (props.status === "failed") {
    return (
      <div className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]" />
    );
  }
  if (props.status === "processing") {
    return (
      <div className="h-2 w-2 animate-pulse rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]" />
    );
  }
  return (
    <div className="h-2 w-2 animate-pulse rounded-full bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.5)]" />
  );
}

function MetaChip(props: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
        props.accent
          ? "bg-[#ff6633]/10 text-[#ff6633]"
          : "bg-white/[0.04] text-[#5c5c66]"
      }`}
    >
      {props.children}
    </span>
  );
}
