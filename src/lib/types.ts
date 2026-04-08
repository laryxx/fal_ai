export type CurrentUserSummary = {
  id: string;
  email: string;
  role: "admin" | "member";
  creativeCount: number;
  imageCount: number;
  videoCount: number;
  spendUsdCents: number;
  billableUnits: number;
};

export type CreativeSummary = {
  id: string;
  userId: string;
  kind: "image" | "video";
  status: "queued" | "processing" | "completed" | "failed";
  modelFamily: string;
  modelLabel: string;
  prompt: string;
  aspectRatio: string;
  position: number;
  durationSeconds: number | null;
  resolution: string | null;
  outputUrl: string | null;
  outputMimeType: string | null;
  errorMessage: string | null;
  estimatedCostUsdCents: number;
  actualCostUsdCents: number;
  billableUnits: number;
  billingUnit: string;
  createdAt: number;
  userEmail: string;
  asset: {
    publicUrl: string;
    contentType?: string;
    durationSeconds?: number;
  } | null;
};

export type DashboardSnapshot = {
  currentUser: CurrentUserSummary;
  creatives: CreativeSummary[];
};

export type TeamUserSummary = {
  id: string;
  email: string;
  role: "admin" | "member";
  creativeCount: number;
  imageCount: number;
  videoCount: number;
  spendUsdCents: number;
  billableUnits: number;
  lastLoginAt: number | null;
  createdAt: number;
};

export type InviteSummary = {
  id: string;
  email: string;
  status: "pending" | "accepted" | "revoked";
  createdAt: number;
  acceptedAt: number | null;
  userDeletedAt: number | null;
};

export type TeamSnapshot = {
  users: TeamUserSummary[];
  invites: InviteSummary[];
};

export type MemberLogEntry = {
  id: string;
  kind: "image" | "video";
  status: "queued" | "processing" | "completed" | "failed";
  prompt: string;
  modelLabel: string;
  actualCostUsdCents: number;
  outputUrl: string | null;
  outputMimeType: string | null;
  createdAt: number;
  asset: { publicUrl: string } | null;
};

export type MemberDetail = {
  summary: {
    id: string;
    email: string;
    role: "admin" | "member";
    createdAt: number;
    spendUsdCents: number;
    creativeCount: number;
    imageCount: number;
    videoCount: number;
    invitedAt: number | null;
    acceptedAt: number | null;
  };
  log: MemberLogEntry[];
};

export type AppData = {
  configurationError: string | null;
  bootstrapRequired: boolean;
  authenticated: boolean;
  snapshot: DashboardSnapshot | null;
  team: TeamSnapshot | null;
};
