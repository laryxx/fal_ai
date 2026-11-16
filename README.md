# fal Dashboard

Invite-only dashboard for generating images and videos with `fal.ai`, tracking usage in Convex, and storing references plus outputs in Cloudflare R2.

## What is included

- `images` and `videos` tabs on a single dashboard
- Prompt, model, aspect ratio, count, and reference-image inputs
- First-run admin bootstrap in the UI
- Invite-only email/password auth
- Per-user creative counts and spend tracking
- fal queue submission plus polling-based result sync
- Cloudflare R2 uploads for references and generated outputs

## Models wired in

- Images:
  - `Nano Banana`
  - `Nano Banana Pro`
  - `Seedream V4`
- Videos:
  - `LTX 2.3 Fast`

- Image enhancement:
  - `Vmake Enhance` (Vmake "Fast 2K - Image Quality Repair", 10 Vmake credits per image)

Spend tracking is app-level and currently uses the model pricing configured in [src/lib/models.ts](/Users/polnikakel/conductor/workspaces/tirych-help/delhi-v4/src/lib/models.ts), rather than calling fal's Usage API.

## Environment

Copy [.env.example](/Users/polnikakel/conductor/workspaces/tirych-help/delhi-v4/.env.example) into your active env file and fill:

- `SESSION_SECRET`
- `APP_SERVER_SECRET`
- `CONVEX_URL`
- `FAL_KEY`
- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_BASE_URL`

Notes:

- Auth and invites only need `SESSION_SECRET`, `APP_SERVER_SECRET`, and `CONVEX_URL`.
- Generation needs the fal and R2 variables too.
- `R2_PUBLIC_BASE_URL` must point to a public bucket domain or custom domain because fal needs fetchable input URLs.

## Vmake image enhancement

Vmake jobs, all billed in Vmake credits and tracked next to dollars:

- Images: **Enhance** (Fast 2K, about 2.7x larger JPEG, 10 credits) and **Remove watermark** (10 credits).
- Videos: **Enhance** (Fast / Quality / Master at 2K / 4K / 8K, 2-12 credits per second) and **Remove** (Watermark, Subtitle, Smart at 2 credits/s; Smart Pro at 4 credits/s).
- Works on gallery creatives and on uploaded images (up to 30 MB) and videos (up to 300 MB).
- Options and prices live in `src/lib/vmake-options.ts`; all jobs go through `/api/enhance`.

- Runs in a Python function, `api/vmake.py`, using Vmake's official SDK (vendored in `api/_vendor/action_api_sdk`, v2.0.1, proprietary). Vercel deploys it next to the Next.js app; dependencies are in `requirements.txt`.
- Needs `MT_AK` and `MT_SK` (Vmake API Keys page; requires a Plus or Pro plan). The Python function also reads `APP_SERVER_SECRET` and `R2_PUBLIC_BASE_URL`. The button is hidden until the keys are set.
- Dollar cost assumes the Pro plan ($29.99 for 4,500 credits); change the constants in `src/lib/vmake-options.ts` if the plan changes. Credits are shown next to dollars in the dashboard and both Excel exports.
- There are no app-side limits; the Vmake dashboard's daily API credit limit is the only cap.
- Vmake uploads images to its Alibaba Cloud storage and its result links expire after 7 days, so results are copied into R2.
- Local dev: `pip install -r requirements.txt`, run `pnpm vmake:dev` (serves on port 8787 and reads `.env.local`), and set `VMAKE_SERVICE_URL=http://127.0.0.1:8787` in `.env.local`. Do not set `VMAKE_SERVICE_URL` on Vercel.

## Local run

1. Install dependencies with `pnpm install`.
2. Start Convex with `pnpm convex:dev`.
3. Start Next with `pnpm dev`.
4. Open `/`.
5. If there are no users yet, create the admin account on first load.
6. After that, only invited emails can sign up.

## Main files

- App shell: [src/components/dashboard-app.tsx](/Users/polnikakel/conductor/workspaces/tirych-help/delhi-v4/src/components/dashboard-app.tsx)
- Auth flow: [src/components/auth-screen.tsx](/Users/polnikakel/conductor/workspaces/tirych-help/delhi-v4/src/components/auth-screen.tsx)
- fal model registry: [src/lib/models.ts](/Users/polnikakel/conductor/workspaces/tirych-help/delhi-v4/src/lib/models.ts)
- Convex tables and functions: [convex/schema.ts](/Users/polnikakel/conductor/workspaces/tirych-help/delhi-v4/convex/schema.ts)
- API routes: [src/app/api](/Users/polnikakel/conductor/workspaces/tirych-help/delhi-v4/src/app/api)
