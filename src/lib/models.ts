import { z } from "zod";

export type MediaKind = "image" | "video";
export type ImageModelId = "nano-banana" | "nano-banana-pro" | "seedream-v4";
export type VideoModelId = "ltx-2.3-fast" | "veo-3" | "seedance-2";
export type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";

export const imageModelOptions = [
  {
    id: "nano-banana",
    label: "Nano Banana",
    description: "Fast Gemini 2.5 Flash image generation and edits.",
    priceLabel: "$0.039 / image",
  },
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    description: "Gemini 3 Pro image quality with multi-reference editing.",
    priceLabel: "$0.15 / image",
  },
  {
    id: "seedream-v4",
    label: "Seedream V4",
    description: "ByteDance Seedream 4.0 for clean prompt following.",
    priceLabel: "$0.03 / image",
  },
] as const;

export const videoModelOptions = [
  {
    id: "ltx-2.3-fast",
    label: "LTX 2.3 Fast",
    description: "Fast open-source video generation with 1080p support.",
    priceLabel: "$0.06 / second",
  },
  {
    id: "veo-3",
    label: "Veo 3",
    description: "Google video generation with native audio.",
    priceLabel: "$0.40 / second",
  },
  {
    id: "seedance-2",
    label: "Seedance 2.0",
    description: "ByteDance cinematic video generation.",
    priceLabel: "$0.30 / second",
  },
] as const;

export const imageGenerationSchema = z.object({
  kind: z.literal("image"),
  prompt: z.string().trim().min(8).max(10000),
  modelId: z.enum(["nano-banana", "nano-banana-pro", "seedream-v4"]),
  aspectRatio: z.enum(["1:1", "4:3", "3:4", "16:9", "9:16"]),
  count: z.coerce.number().int().min(1).max(4),
});

export const videoGenerationSchema = z.object({
  kind: z.literal("video"),
  prompt: z.string().trim().min(8).max(10000),
  modelId: z.enum(["ltx-2.3-fast", "veo-3", "seedance-2"]),
  aspectRatio: z.enum(["16:9", "9:16"]),
  quality: z.enum(["720p", "1080p"]),
  duration: z.coerce.number().int().refine((value) => [4, 5, 6, 8, 10, 12, 15, 16, 20].includes(value)),
  count: z.coerce.number().int().min(1).max(3),
});

export function getAspectRatioOptions(kind: MediaKind) {
  return kind === "image"
    ? ["1:1", "9:16", "16:9", "3:4", "4:3"]
    : ["16:9", "9:16"];
}

export function getVideoQualityOptions(modelId: string): string[] {
  if (modelId === "ltx-2.3-fast") return ["1080p"];
  if (modelId === "seedance-2") return ["720p", "1080p"];
  return ["720p"]; // veo-3
}

export function getVideoDurationOptions(modelId: string): string[] {
  if (modelId === "veo-3") return ["4", "6", "8"];
  if (modelId === "seedance-2") return ["5", "10", "15"];
  return ["6", "8", "12", "16", "20"]; // ltx-2.3-fast (fal accepts 6-20s; no 4s)
}

function getSeedreamImageSize(aspectRatio: AspectRatio) {
  switch (aspectRatio) {
    case "1:1":
      return "square_hd";
    case "3:4":
      return "portrait_4_3";
    case "4:3":
      return "landscape_4_3";
    case "9:16":
      return "portrait_16_9";
    case "16:9":
      return "landscape_16_9";
    default:
      return "square_hd";
  }
}

export function prepareImageRequest(args: {
  modelId: ImageModelId;
  prompt: string;
  aspectRatio: AspectRatio;
  referenceUrls: string[];
}) {
  const hasReferences = args.referenceUrls.length > 0;

  if (args.modelId === "nano-banana") {
    return {
      endpointId: hasReferences
        ? "fal-ai/gemini-25-flash-image/edit"
        : "fal-ai/gemini-25-flash-image",
      modelLabel: "Nano Banana",
      modelFamily: args.modelId,
      estimatedCostUsdCents: 4,
      billingUnit: "image",
      billableUnits: 1,
      resolution: "adaptive",
      input: hasReferences
        ? {
            prompt: args.prompt,
            aspect_ratio: args.aspectRatio,
            image_urls: args.referenceUrls,
            output_format: "png",
            num_images: 1,
          }
        : {
            prompt: args.prompt,
            aspect_ratio: args.aspectRatio,
            output_format: "png",
            num_images: 1,
          },
    };
  }

  if (args.modelId === "nano-banana-pro") {
    return {
      endpointId: hasReferences
        ? "fal-ai/nano-banana-pro/edit"
        : "fal-ai/nano-banana-pro",
      modelLabel: "Nano Banana Pro",
      modelFamily: args.modelId,
      estimatedCostUsdCents: 15,
      billingUnit: "image",
      billableUnits: 1,
      resolution: "1K",
      input: hasReferences
        ? {
            prompt: args.prompt,
            aspect_ratio: args.aspectRatio,
            image_urls: args.referenceUrls,
            output_format: "png",
            resolution: "1K",
            num_images: 1,
          }
        : {
            prompt: args.prompt,
            aspect_ratio: args.aspectRatio,
            output_format: "png",
            resolution: "1K",
            num_images: 1,
          },
    };
  }

  return {
    endpointId: hasReferences
      ? "fal-ai/bytedance/seedream/v4/edit"
      : "fal-ai/bytedance/seedream/v4/text-to-image",
    modelLabel: "Seedream V4",
    modelFamily: args.modelId,
    estimatedCostUsdCents: 3,
    billingUnit: "image",
    billableUnits: 1,
    resolution: getSeedreamImageSize(args.aspectRatio),
    input: hasReferences
      ? {
          prompt: args.prompt,
          image_size: getSeedreamImageSize(args.aspectRatio),
          image_urls: args.referenceUrls,
          num_images: 1,
          max_images: 1,
          enable_safety_checker: true,
          enhance_prompt_mode: "standard",
        }
      : {
          prompt: args.prompt,
          image_size: getSeedreamImageSize(args.aspectRatio),
          num_images: 1,
          max_images: 1,
          enable_safety_checker: true,
          enhance_prompt_mode: "standard",
        },
  };
}

export function prepareVideoRequest(args: {
  modelId: VideoModelId;
  prompt: string;
  aspectRatio: "16:9" | "9:16";
  quality: "720p" | "1080p";
  duration: number;
  referenceUrls: string[];
}) {
  const hasReferences = args.referenceUrls.length > 0;
  const primaryReference = args.referenceUrls[0];

  if (args.modelId === "veo-3") {
    if (![4, 6, 8].includes(args.duration)) {
      throw new Error("Veo 3 is configured for 4s, 6s, or 8s clips here");
    }

    return {
      endpointId: "fal-ai/veo3",
      modelLabel: "Veo 3",
      modelFamily: args.modelId,
      estimatedCostUsdCents: args.duration * 40,
      billingUnit: "second",
      billableUnits: args.duration,
      resolution: "720p",
      input: {
        prompt: args.prompt,
        duration: `${args.duration}s`,
        aspect_ratio: args.aspectRatio,
      },
    };
  }

  if (args.modelId === "seedance-2") {
    if (![5, 10, 15].includes(args.duration)) {
      throw new Error("Seedance 2.0 is configured for 5s, 10s, or 15s clips here");
    }

    const costPerSecond = args.quality === "1080p" ? 68 : 30;

    const multiReference = args.referenceUrls.length > 1;
    const endpointId = !hasReferences
      ? "bytedance/seedance-2.0/text-to-video"
      : multiReference
        ? "bytedance/seedance-2.0/reference-to-video"
        : "bytedance/seedance-2.0/image-to-video";

    return {
      endpointId,
      modelLabel: "Seedance 2.0",
      modelFamily: args.modelId,
      estimatedCostUsdCents: args.duration * costPerSecond,
      billingUnit: "second",
      billableUnits: args.duration,
      resolution: args.quality,
      input: multiReference
        ? {
            prompt: args.prompt,
            image_urls: args.referenceUrls,
            duration: args.duration,
            resolution: args.quality,
            aspect_ratio: args.aspectRatio,
          }
        : hasReferences
          ? {
              prompt: args.prompt,
              image_url: primaryReference,
              duration: args.duration,
              resolution: args.quality,
              aspect_ratio: args.aspectRatio,
            }
          : {
              prompt: args.prompt,
              duration: args.duration,
              resolution: args.quality,
              aspect_ratio: args.aspectRatio,
            },
    };
  }

  if (![6, 8, 12, 16, 20].includes(args.duration)) {
    throw new Error("LTX 2.3 Fast is configured for 6s, 8s, 12s, 16s, or 20s clips here");
  }

  return {
    endpointId: hasReferences
      ? "fal-ai/ltx-2.3/image-to-video/fast"
      : "fal-ai/ltx-2.3/text-to-video/fast",
    modelLabel: "LTX 2.3 Fast",
    modelFamily: args.modelId,
    estimatedCostUsdCents: args.duration * 6,
    billingUnit: "second",
    billableUnits: args.duration,
    resolution: "1080p",
    input: hasReferences
      ? {
          prompt: args.prompt,
          image_url: primaryReference,
          duration: args.duration,
          resolution: "1080p",
          aspect_ratio: args.aspectRatio,
          fps: 25,
          generate_audio: true,
        }
      : {
          prompt: args.prompt,
          duration: args.duration,
          resolution: "1080p",
          aspect_ratio: args.aspectRatio,
          fps: 25,
          generate_audio: true,
        },
  };
}
