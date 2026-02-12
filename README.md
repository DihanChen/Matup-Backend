# MatUp Backend

Backend service for MatUp host-to-group email delivery.

## Responsibilities
- Authenticated email API for event and league announcements
- Authorization checks:
  - Event email: only event creator can send
  - League email: only league owner can send
- Recipient lookup from Supabase (excluding sender)
- Batch send via Resend

## Stack
- Node.js + Express + TypeScript
- Supabase Admin client (auth + data queries)
- Resend SDK

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/email/send` | Send event/league email to members |
| POST | `/api/leagues/:id/schedule/generate` | Generate league fixtures/sessions |
| GET | `/api/leagues/:id/fixtures` | List fixtures with participants/submission status |
| GET | `/api/leagues/:id/sessions` | List running sessions with submitted runs |
| POST | `/api/leagues/:id/sessions` | Create/update running session definition (owner/admin) |
| GET | `/api/leagues/:id/standings` | Calculate league standings from finalized fixtures + legacy results |
| GET | `/api/leagues/:id/invites` | Get league invite code + invite statuses (owner/admin) |
| POST | `/api/leagues/:id/invites` | Create/resend email invites for a league (owner/admin) |
| POST | `/api/leagues/:id/join` | Join league via invite code or invite token |
| POST | `/api/fixtures/:id/results/submit` | Submit fixture result payload |
| POST | `/api/fixtures/:id/results/confirm` | Confirm/reject submitted result |
| POST | `/api/fixtures/:id/results/resolve` | Owner/admin force-resolve disputed result |
| POST | `/api/sessions/:id/runs/submit` | Submit/update current user run for a running session |
| POST | `/api/sessions/:id/runs/:runId/review` | Approve/reject a run submission (owner/admin) |
| POST | `/api/sessions/:id/finalize` | Finalize running session and lock finalized runs (owner/admin) |

### `POST /api/email/send`

Headers:
- `Authorization: Bearer <supabase_access_token>`
- `Content-Type: application/json`

Body:

```json
{
  "type": "event",
  "id": "event_or_league_id",
  "subject": "Schedule update",
  "message": "Please arrive 15 minutes early."
}
```

`type` supports `"event"` and `"league"`.

Success response:

```json
{
  "success": true,
  "sent": 8,
  "failed": []
}
```

## Environment Variables

```bash
PORT=3001
NODE_ENV=development

SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

RESEND_API_KEY=re_xxxxxxxxxxxxx
RESEND_FROM=MatUp <onboarding@resend.dev>

# frontend URL used for CORS allowlist and links in emails
FRONTEND_URL=http://localhost:3000
```

Production notes:
- `RESEND_FROM` must be a verified sender/domain in Resend.
- `FRONTEND_URL` must match your deployed frontend domain.

## CORS Behavior
- Development allows:
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`
- Production allows:
  - `https://matup.app`
  - `https://www.matup.app`
  - `FRONTEND_URL`

## Local Run

```bash
npm install
npm run dev
```

Build/start:

```bash
npm run build
npm run start
```

## Deployment (Render)
- Build command: `npm install && npm run build`
- Start command: `npm run start` (or `node dist/index.js`)
- Set all env vars above in Render.
