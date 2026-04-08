import { fal } from "@fal-ai/client";

export type FalQueueStatus = {
  status: string;
  logs?: Array<{ message?: string }>;
};

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const key = process.env.FAL_KEY;
  if (key) {
    fal.config({ credentials: key.replace(/[\r\n]+/g, "").trim() });
  }
  configured = true;
}

export async function submitFalJob(endpointId: string, input: Record<string, unknown>) {
  ensureConfigured();
  const response = await fal.queue.submit(endpointId, { input });
  return response.request_id;
}

export async function getFalStatus(endpointId: string, requestId: string) {
  ensureConfigured();
  return (await fal.queue.status(endpointId, {
    requestId,
    logs: true,
  })) as FalQueueStatus;
}

export async function getFalResult(endpointId: string, requestId: string) {
  ensureConfigured();
  return await fal.queue.result(endpointId, { requestId });
}
