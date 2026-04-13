import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/session";
import { getServerEnvSafe } from "@/lib/env";
import {
  convexCreateAssets,
  convexCreateCreativeBatch,
  convexGetUserById,
} from "@/lib/convex";
import { submitFalJob } from "@/lib/fal";
import {
  imageGenerationSchema,
  prepareImageRequest,
  prepareVideoRequest,
  videoGenerationSchema,
} from "@/lib/models";
import { uploadToR2 } from "@/lib/r2";

function asString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  if (!getServerEnvSafe().ok) {
    return NextResponse.json(
      { error: "Configure Convex, fal.ai, and Cloudflare R2 first" },
      { status: 503 },
    );
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const user = await convexGetUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const kind = asString(formData.get("kind"));
  const files = formData
    .getAll("references")
    .filter((value): value is File => value instanceof File && value.size > 0);

  const parsed =
    kind === "video"
      ? videoGenerationSchema.safeParse({
          kind,
          prompt: asString(formData.get("prompt")),
          modelId: asString(formData.get("modelId")),
          aspectRatio: asString(formData.get("aspectRatio")),
          quality: asString(formData.get("quality")),
          duration: asString(formData.get("duration")),
          count: asString(formData.get("count")),
        })
      : imageGenerationSchema.safeParse({
          kind: "image",
          prompt: asString(formData.get("prompt")),
          modelId: asString(formData.get("modelId")),
          aspectRatio: asString(formData.get("aspectRatio")),
          count: asString(formData.get("count")),
        });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Some generation fields are invalid or missing" },
      { status: 400 },
    );
  }

  const uploadedReferences = [];
  for (const file of files) {
    const body = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadToR2({
      keyPrefix: `references/${user._id}`,
      fileName: file.name,
      body,
      contentType: file.type || "application/octet-stream",
    });

    uploadedReferences.push({
      type: "reference",
      mediaKind: "image",
      bucket: uploaded.bucket,
      key: uploaded.key,
      publicUrl: uploaded.publicUrl,
      contentType: file.type || "application/octet-stream",
      fileName: file.name,
      sizeBytes: file.size,
    });
  }

  const referenceAssetIds =
    uploadedReferences.length > 0
      ? (await convexCreateAssets(user._id, uploadedReferences)).assetIds
      : [];
  const referenceUrls = uploadedReferences.map((reference) => reference.publicUrl);
  const batchId = crypto.randomUUID();

  const creatives = [];
  const count = parsed.data.count;

  for (let index = 0; index < count; index += 1) {
    try {
      const requestSpec =
        parsed.data.kind === "video"
          ? prepareVideoRequest({
              modelId: parsed.data.modelId,
              prompt: parsed.data.prompt,
              aspectRatio: parsed.data.aspectRatio,
              quality: parsed.data.quality,
              duration: parsed.data.duration,
              referenceUrls,
            })
          : prepareImageRequest({
              modelId: parsed.data.modelId,
              prompt: parsed.data.prompt,
              aspectRatio: parsed.data.aspectRatio,
              referenceUrls,
            });

      const falRequestId = await submitFalJob(requestSpec.endpointId, requestSpec.input);

      creatives.push({
        batchId,
        kind: parsed.data.kind,
        status: "queued",
        modelFamily: requestSpec.modelFamily,
        modelLabel: requestSpec.modelLabel,
        endpointId: requestSpec.endpointId,
        prompt: parsed.data.prompt,
        aspectRatio: parsed.data.aspectRatio,
        position: index + 1,
        referenceAssetIds,
        durationSeconds:
          parsed.data.kind === "video" ? parsed.data.duration : undefined,
        resolution: requestSpec.resolution,
        falRequestId,
        estimatedCostUsdCents: requestSpec.estimatedCostUsdCents,
        billableUnits: requestSpec.billableUnits,
        billingUnit: requestSpec.billingUnit,
      });
    } catch (error) {
      creatives.push({
        batchId,
        kind: parsed.data.kind,
        status: "failed",
        modelFamily: parsed.data.modelId,
        modelLabel:
          parsed.data.kind === "video"
            ? parsed.data.modelId === "sora-2"
              ? "Sora 2"
              : parsed.data.modelId === "veo-3"
                ? "Veo 3"
                : "LTX 2.3 Fast"
            : parsed.data.modelId === "nano-banana"
              ? "Nano Banana"
              : parsed.data.modelId === "nano-banana-pro"
                ? "Nano Banana Pro"
                : "Seedream V4",
        endpointId: "",
        prompt: parsed.data.prompt,
        aspectRatio: parsed.data.aspectRatio,
        position: index + 1,
        referenceAssetIds,
        durationSeconds:
          parsed.data.kind === "video" ? parsed.data.duration : undefined,
        resolution: undefined,
        errorMessage:
          error instanceof Error ? error.message : "Could not submit the job",
        estimatedCostUsdCents: 0,
        billableUnits: 0,
        billingUnit: parsed.data.kind === "video" ? "second" : "image",
      });
    }
  }

  await convexCreateCreativeBatch(user._id, creatives);

  return NextResponse.json({ ok: true });
}
