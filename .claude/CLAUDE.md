# MatUp Backend — Project Knowledge

## Purpose

Backend API for the MatUp fitness partner matching platform. Handles league management (invites, scheduling, fixtures, standings, running sessions), fixture result workflows, and group email delivery.

## Stack

- Node.js + Express 5 + TypeScript (strict)
- Supabase Admin client for auth and data queries
- Resend SDK for transactional email

## Project Structure

```
src/
├── index.ts                         # Server entrypoint (port, graceful shutdown)
├── app.ts                           # Express app setup, middleware stack, route mounting
│
├── config/
│   └── env.ts                       # Environment variable loading and validation
│
├── middleware/
│   ├── auth.ts                      # Bearer token auth via Supabase (requireAuth)
│   ├── compression.ts               # Gzip compression for JSON responses
│   └── rate-limit.ts                # Per-user rate limiting for sensitive endpoints
│
├── routes/                          # Thin route handlers — validate input, call services, return response
│   ├── email.ts                     # POST /api/email/send
│   ├── leagues.ts                   # POST /api/leagues/:id/sessions (create/update session)
│   ├── league-fixtures.ts           # GET  /api/leagues/:id/fixtures
│   ├── league-invites.ts            # GET/POST /api/leagues/:id/invites, POST /join
│   ├── league-schedule.ts           # POST /api/leagues/:id/schedule/generate
│   ├── league-standings.ts          # GET  /api/leagues/:id/standings
│   ├── league-teams.ts              # GET/PUT /api/leagues/:id/teams/assigned
│   ├── fixture-results-submit.ts    # POST /api/fixtures/:id/results/submit
│   ├── fixture-results-confirm.ts   # POST /api/fixtures/:id/results/confirm
│   ├── fixture-results-resolve.ts   # POST /api/fixtures/:id/results/resolve
│   ├── fixture-results.shared.ts    # Shared helpers for fixture result routes
│   └── sessions.ts                  # POST /api/sessions/:id/runs/submit, review, finalize
│
├── services/                        # Business logic (pure where possible, testable)
│   ├── email.service.ts             # Resend batch send with chunking
│   ├── fixture-schedule.service.ts  # Round-robin and shuffle schedule algorithms
│   ├── league.service.ts            # League CRUD helpers
│   ├── league-rules.service.ts      # Sport-specific rule configuration
│   ├── league-standings-read.service.ts  # Standings data fetching
│   ├── session.service.ts           # Running session helpers
│   └── standings.service.ts         # Standings calculation (4 scoring formats)
│
├── templates/
│   └── email.ts                     # HTML email templates (update, invite)
│
└── utils/                           # Shared utilities (no business logic)
    ├── supabase.ts                  # Supabase admin client init
    ├── league-access.ts             # getLeagueRole, isLeagueAdminRole
    ├── league-dates.ts              # weekStartIso, weekEndIso, toIsoOrNull
    ├── html.ts                      # escapeHtml, formatMessage
    ├── profile.ts                   # getHostName (profile name lookup)
    └── rules.ts                     # toRulesObject, getNestedNumber/String/Array/Boolean
```

## Coding Conventions

- Route handlers are thin: validate input, call a service, return JSON. Business logic lives in `services/`.
- Shared helpers live in `utils/`. Never duplicate a function across files — import from utils.
- Validate inputs and return consistent JSON error responses (`{ error: "..." }`).
- Escape any user-provided content used in HTML email bodies via `utils/html.ts`.
- Mount new routes in `src/app.ts`.
- Keep secrets server-only; never log API keys or tokens.
- Follow existing file-local style (single quotes, formatting).

## Tests

- Test runner: Node.js built-in test runner (`node --test`)
- Test files: co-located with services as `*.test.ts`
- Run: `npm test`
- Current coverage: `fixture-schedule.service`, `league-rules.service`, `standings.service`

## Environment Variables

See `.env.example` for the full list:

- `PORT` (default 3001), `NODE_ENV`
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `RESEND_API_KEY`, `RESEND_FROM`
- `FRONTEND_URL` — used for CORS allowlist and links in emails
- `CORS_ALLOWED_ORIGINS` — comma-separated list of additional allowed origins

## Commands

- `npm run dev` — start dev server (nodemon + ts-node)
- `npm run build` — compile TypeScript to `dist/`
- `npm run start` — run compiled server (`node dist/index.js`)
- `npm run lint` — type-check with `tsc --noEmit`
- `npm test` — run service tests
