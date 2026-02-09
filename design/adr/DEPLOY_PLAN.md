# Deployment Plan

## Overview
- Frontend: Vercel
- Backend: Render Starter (always-on Express, supports cron/background tasks)

## Steps
1) Create backend service on Render Starter from `backend/`.
2) Configure backend build/start + env vars:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `DATABASE_URL`
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT`
   - `RESEND_API_KEY` (if/when email support ships)
3) Deploy frontend on Vercel from `frontend/` and set frontend env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_API_BASE_URL` (Render backend URL)
4) Configure backend CORS to allow the Vercel domain.
5) Run smoke tests in production:
   - Auth flow (login/signup)
   - Events/leagues create + list
   - Push endpoints (subscribe/send)
   - Email endpoint (if enabled)

## Notes
- Render is chosen to keep cost low while supporting always-on services and cron.
- Vercel remains the best fit for Next.js hosting and static assets.
