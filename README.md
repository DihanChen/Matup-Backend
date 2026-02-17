# MatUp Backend

Backend API for the MatUp fitness partner matching platform. Handles league management, fixture result workflows, running session tracking, and group email delivery.

## Stack

- Node.js + Express 5 + TypeScript (strict)
- Supabase Admin client (auth + data queries)
- Resend SDK (transactional email)

## Project Structure

```
src/
├── index.ts                   # Server entrypoint
├── app.ts                     # Express app, middleware, route mounting
├── config/
│   └── env.ts                 # Environment config and validation
├── middleware/
│   ├── auth.ts                # JWT bearer auth via Supabase
│   ├── compression.ts         # Gzip response compression
│   └── rate-limit.ts          # Per-user rate limiting
├── routes/                    # Route handlers (thin — validate, delegate, respond)
│   ├── email.ts               # Group email sending
│   ├── leagues.ts             # Session management
│   ├── league-fixtures.ts     # Fixture listing
│   ├── league-invites.ts      # Invite system (codes + email tokens)
│   ├── league-schedule.ts     # Schedule generation
│   ├── league-standings.ts    # Standings calculation
│   ├── league-teams.ts        # Assigned doubles team management
│   ├── fixture-results-*.ts   # Result submit / confirm / resolve workflow
│   └── sessions.ts            # Run submission, review, finalization
├── services/                  # Business logic (testable, pure where possible)
│   ├── email.service.ts       # Resend batch send with chunking
│   ├── fixture-schedule.service.ts  # Round-robin + shuffle algorithms
│   ├── league.service.ts      # League CRUD helpers
│   ├── league-rules.service.ts     # Sport-specific rule config
│   ├── league-standings-read.service.ts  # Standings data fetch
│   ├── session.service.ts     # Running session helpers
│   └── standings.service.ts   # Standings calculation (4 scoring formats)
├── templates/
│   └── email.ts               # HTML email templates
└── utils/                     # Shared utilities
    ├── supabase.ts            # Supabase admin client
    ├── league-access.ts       # Role checks (getLeagueRole, isLeagueAdminRole)
    ├── league-dates.ts        # Week date calculations
    ├── html.ts                # HTML escaping
    ├── profile.ts             # User profile name lookup
    └── rules.ts               # Rules JSON helpers (toRulesObject, getNestedX)
```

## API

All endpoints except `/health` require `Authorization: Bearer <supabase_access_token>`.

### General

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/health` | Health check |
| POST | `/api/email/send` | Send group email to event/league members |

### Leagues

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/leagues/:id/invites` | List invite code + invite statuses (owner/admin) |
| POST | `/api/leagues/:id/invites` | Send email invites (owner/admin) |
| POST | `/api/leagues/:id/join` | Join via invite code or email token |
| GET | `/api/leagues/:id/teams/assigned` | View assigned doubles teams |
| PUT | `/api/leagues/:id/teams/assigned` | Configure team pairs (owner/admin) |
| POST | `/api/leagues/:id/schedule/generate` | Generate fixtures/sessions for a season |
| GET | `/api/leagues/:id/fixtures` | List fixtures with participants and submission status |
| GET | `/api/leagues/:id/sessions` | List running sessions with submitted runs |
| POST | `/api/leagues/:id/sessions` | Create/update session definition (owner/admin) |
| GET | `/api/leagues/:id/standings` | Calculate standings from finalized results |

### Fixture Results

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/fixtures/:id/results/submit` | Submit result (participant or organizer) |
| POST | `/api/fixtures/:id/results/confirm` | Confirm or reject a submitted result |
| POST | `/api/fixtures/:id/results/resolve` | Force-resolve a dispute (owner/admin) |

### Running Sessions

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/sessions/:id/runs/submit` | Submit/update a run |
| POST | `/api/sessions/:id/runs/:runId/review` | Approve/reject a run (owner/admin) |
| POST | `/api/sessions/:id/finalize` | Finalize session and lock runs (owner/admin) |

### Example: `POST /api/email/send`

```json
// Request
{
  "type": "event",
  "id": "event_or_league_id",
  "subject": "Schedule update",
  "message": "Please arrive 15 minutes early."
}

// Response
{
  "success": true,
  "sent": 8,
  "failed": []
}
```

`type` supports `"event"` and `"league"`.

## Environment Variables

Copy `.env.example` and fill in values:

```bash
PORT=3001
NODE_ENV=development

SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

RESEND_API_KEY=re_xxxxxxxxxxxxx
RESEND_FROM=MatUp <onboarding@resend.dev>

FRONTEND_URL=http://localhost:3000
CORS_ALLOWED_ORIGINS=https://matup.app,https://www.matup.app
```

Notes:
- `RESEND_FROM` must be a verified sender/domain in Resend.
- `FRONTEND_URL` is used for email links and the CORS allowlist.
- `CORS_ALLOWED_ORIGINS` is a comma-separated list of additional allowed origins (production).

## CORS Behavior

- **Development**: `http://localhost:3000`, `http://127.0.0.1:3000`
- **Production**: Origins from `CORS_ALLOWED_ORIGINS` env var

## Local Development

```bash
npm install
npm run dev        # Dev server with auto-reload
```

Build and run for production:

```bash
npm run build
npm run start
```

## Testing

```bash
npm test           # Run service unit tests
```

Tests use the Node.js built-in test runner. Test files are co-located with services (`*.test.ts`).

## Deployment (Render)

- **Build command**: `npm install && npm run build`
- **Start command**: `npm run start`
- Set all environment variables above in Render.
