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
  - `Sora 2`
  - `LTX 2.3 Fast`

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
