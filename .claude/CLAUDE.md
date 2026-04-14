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
│   ├── courts.ts                    # GET /api/courts/osm, POST /api/courts/osm/import, PATCH /api/courts/:id/details
│   ├── leagues.ts                   # POST /api/leagues/:id/sessions (create/update session)
│   ├── league-fixtures.ts           # GET  /api/leagues/:id/fixtures
│   ├── league-invites.ts            # GET/POST /api/leagues/:id/invites, POST /join
│   ├── league-schedule.ts           # POST /api/leagues/:id/schedule/generate
│   ├── league-standings.ts          # GET  /api/leagues/:id/standings
│   ├── league-teams.ts              # GET/PUT /api/leagues/:id/teams/assigned
│   ├── league-announcements.ts      # GET/POST /api/leagues/:id/announcements
│   ├── league-availability.ts       # GET/PUT /api/leagues/:id/availability, GET .../summary
│   ├── league-playoffs.ts           # POST /api/leagues/:id/playoffs/generate
│   ├── league-seasons.ts            # GET/POST /api/leagues/:id/seasons
│   ├── fixture-results-submit.ts    # POST /api/fixtures/:id/results/submit
│   ├── fixture-results-confirm.ts   # POST /api/fixtures/:id/results/confirm
│   ├── fixture-results-resolve.ts   # POST /api/fixtures/:id/results/resolve
│   ├── fixture-results.shared.ts    # Shared helpers for fixture result routes
│   ├── fixture-reschedule.ts        # PATCH /api/fixtures/:id/reschedule
│   ├── push-tokens.ts               # POST/DELETE /api/users/push-token
│   ├── user-fixtures.ts             # GET /api/users/me/upcoming-fixtures
│   ├── user-stats.ts                # GET /api/users/me/match-history, .../head-to-head/:opponentId
│   └── sessions.ts                  # POST /api/sessions/:id/runs/submit, review, finalize
│
├── services/                        # Business logic (pure where possible, testable)
│   ├── email.service.ts             # Resend batch send with chunking
│   ├── court-import.service.ts      # Import courts from Overpass/OSM into DB
│   ├── fixture-schedule.service.ts  # Round-robin and shuffle schedule algorithms
│   ├── league.service.ts            # League CRUD helpers
│   ├── league-rules.service.ts      # Sport-specific rule configuration
│   ├── league-standings-read.service.ts  # Standings data fetching
│   ├── nominatim.service.ts         # Geocoding via Nominatim (OpenStreetMap)
│   ├── notification.service.ts      # Web push notification delivery
│   ├── overpass.service.ts          # Query Overpass API for sports courts
│   ├── session.service.ts           # Running session helpers
│   ├── standings.service.ts         # Standings calculation (4 scoring formats)
│   ├── tournament-advance.service.ts  # Advance teams through tournament brackets
│   └── tournament-schedule.service.ts # Generate tournament bracket schedules
│
├── templates/
│   └── email.ts                     # HTML email templates (update, invite)
│
├── scripts/                         # One-off admin/migration scripts (run via ts-node)
│   ├── seed-courts.ts               # Seed courts from OSM (`pnpm seed:courts`)
│   ├── fix-court-names.ts           # Backfill/normalise court names
│   └── migrate-legacy-matches.ts    # Migrate pre-schema match records
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
- Test files: `src/_tests_/services/*.test.ts` and `src/_tests_/utils/*.unit.test.ts`
- Run all: `pnpm test` (runs `test:services` then `test:unit`)
- Current coverage: `fixture-schedule.service`, `league-rules.service`, `standings.service` (services); `html`, `league-dates`, `rules` (utils)

## Environment Variables

See `.env.example` for the full list:

- `PORT` (default 3001), `NODE_ENV`
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `RESEND_API_KEY`, `RESEND_FROM`
- `FRONTEND_URL` — used for CORS allowlist and links in emails
- `CORS_ALLOWED_ORIGINS` — comma-separated list of additional allowed origins

## Commands

- `pnpm dev` — start dev server (nodemon + ts-node)
- `pnpm build` — compile TypeScript to `dist/`
- `pnpm start` — run compiled server (`node dist/index.js`)
- `pnpm lint` — type-check with `tsc --noEmit`
- `pnpm test` — run all tests (services + utils)
- `pnpm seed:courts` — import courts from OSM via Overpass
