# MatUp Backend — Project Knowledge

## Purpose
- Backend API focused on group email notifications for events and leagues.

## Stack
- Node.js + Express + TypeScript.
- Supabase Admin client for auth/user lookup.
- Resend for email delivery.

## Repo Layout
- `src/app.ts` — Express app, middleware, routes.
- `src/index.ts` — server entrypoint.
- `src/config/env.ts` — environment variables and validation.
- `src/middleware/auth.ts` — bearer token auth via Supabase.
- `src/routes/email.ts` — `POST /api/email/send`.
- `src/services/email.service.ts` — Resend batch send logic.
- `src/utils/supabase.ts` — Supabase admin client.

## Coding Conventions
- Follow existing file-local style (single quotes, formatting).
- Keep route handlers thin; move reusable logic into `services/`.
- Validate inputs and return consistent JSON errors.
- Escape any user-provided content used in HTML email bodies.
- Mount new routes in `src/app.ts`.
- Keep secrets server-only; never log API keys or tokens.

## Environment Variables
- `PORT`, `NODE_ENV`
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `RESEND_API_KEY`, `RESEND_FROM`
- `FRONTEND_URL`

## Commands
- `npm run dev` — start dev server
- `npm run build` — compile TypeScript
- `npm run start` — run compiled server
