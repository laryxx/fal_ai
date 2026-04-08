import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerEnv } from "@/lib/env";

function getClient() {
  const env = getServerEnv();

  return new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function getKeyFromPublicUrl(publicUrl: string) {
  const baseUrl = getServerEnv().R2_PUBLIC_BASE_URL.replace(/\/$/, "");
  if (!publicUrl.startsWith(`${baseUrl}/`)) {
    throw new Error("Download URL is not allowed");
  }

  return publicUrl.slice(baseUrl.length + 1);
}

export async function uploadToR2(args: {
  keyPrefix: string;
  fileName: string;
  body: Buffer;
  contentType?: string;
}) {
  const env = getServerEnv();
  const key = `${args.keyPrefix}/${crypto.randomUUID()}-${sanitizeFileName(
    args.fileName,
  )}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: args.body,
      ContentType: args.contentType,
    }),
  );

  return {
    bucket: env.R2_BUCKET_NAME,
    key,
    publicUrl: `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`,
  };
}

export async function createSignedR2DownloadUrl(args: {
  publicUrl: string;
  fileName: string;
  expiresIn?: number;
}) {
  const env = getServerEnv();
  const key = getKeyFromPublicUrl(args.publicUrl);

  return await getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${sanitizeFileName(
        args.fileName,
      )}"`,
    }),
    { expiresIn: args.expiresIn ?? 60 },
  );
}
