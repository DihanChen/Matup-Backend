# MatUp - Email Feature Plan

## Goal

Allow event/league hosts to send group emails to their participants/members.

---

## Service Choice: Resend

**Why Resend:**

- React Email integration (matches existing React 19 / Next.js 16 stack)
- Batch API: `resend.batch.send()` handles up to 100 recipients per call (events/leagues are typically 5-50 participants)
- First-class TypeScript SDK
- Simple setup: one npm package, one API key

**Free Tier:** 3,000 emails/month (100/day)
- Covers ~100 group sends of 30 people/month

**First Paid Tier:** $20/month for 50,000 emails

**Alternatives Considered:**

| Service    | Free Tier     | Paid Tier        | Why Not Chosen                          |
|------------|---------------|------------------|-----------------------------------------|
| Brevo      | 9,000/mo      | $20/mo           | Less polished DX, heavier SDK           |
| Mailgun    | 3,000/mo      | $15/mo for 10K   | Good option but no React Email support  |
| Amazon SES | 3,000/mo (12mo)| $0.10/1K emails | Complex AWS setup, overkill for now     |
| SendGrid   | 60-day trial  | $19.95/mo        | No permanent free tier                  |

---

## Use Cases

1. **Event host emails all participants** - reminders, updates, venue changes, cancellations
2. **League host emails all members** - schedule changes, match results, announcements
3. **Custom message from host** - free-form message to the group

---

## Implementation Steps

### 1. Install Dependencies (Backend)

```bash
cd backend
npm install resend
```

```bash
cd frontend
npm install resend react-email @react-email/components
```

### 2. Environment Variables

Add to `.env`:

```
RESEND_API_KEY=re_xxxxxxxxxxxxx
```

A verified sending domain or Resend's test domain (`onboarding@resend.dev`) is needed.

### 3. Backend: Email Service

**New file:** `backend/src/services/email.service.ts`

- `sendGroupEmail(senderName, recipients[], subject, htmlBody)` - sends via `resend.batch.send()`
- Handles chunking if recipients > 100 (unlikely but safe)
- Returns success/failure per recipient

### 4. Backend: Email API Route

**New file:** `backend/src/routes/email.ts`

```
POST /api/email/send
```

**Request body:**

```json
{
  "type": "event" | "league",
  "id": "<event_id or league_id>",
  "subject": "string",
  "message": "string"
}
```

**Logic:**

1. Authenticate user (existing auth middleware)
2. Verify the user is the creator/owner of the event or league
3. Fetch all participant/member emails from Supabase
4. Send batch email via Resend
5. Return result

**Authorization checks:**

- Events: `events.creator_id === req.userId`
- Leagues: `league_members.user_id === req.userId AND league_members.role = 'owner'`

### 5. Email Templates (React Email)

**New directory:** `frontend/src/emails/`

Templates to create:

- `EventUpdate.tsx` - event-related host message
- `LeagueAnnouncement.tsx` - league-related host message

Each template includes:

- MatUp branding/header
- Host name and event/league name
- Custom message body from the host
- Link back to the event/league page
- Unsubscribe footer (required by email best practices)

### 6. Frontend: Host Email UI

**Event detail page** (`frontend/src/app/events/[id]/page.tsx`):

- Add "Email Participants" button (visible only to event creator)
- Opens a modal/form with subject + message fields
- Calls `POST /api/email/send` with `type: "event"`

**League detail page** (`frontend/src/app/leagues/[id]/page.tsx`):

- Add "Email Members" button (visible only to league owner)
- Opens a modal/form with subject + message fields
- Calls `POST /api/email/send` with `type: "league"`

### 7. Register Route

**Update:** `backend/src/app.ts`

- Import and mount email routes: `app.use('/api/email', emailRouter)`

---

## File Changes Summary

| File                                        | Action   | Description                        |
|---------------------------------------------|----------|------------------------------------|
| `backend/package.json`                      | Modify   | Add `resend` dependency            |
| `backend/.env`                              | Modify   | Add `RESEND_API_KEY`               |
| `backend/src/services/email.service.ts`     | **New**  | Resend email sending logic         |
| `backend/src/routes/email.ts`               | **New**  | POST /api/email/send route         |
| `backend/src/app.ts`                        | Modify   | Mount email routes                 |
| `frontend/package.json`                     | Modify   | Add `react-email` dependencies     |
| `frontend/src/emails/EventUpdate.tsx`       | **New**  | Event email template               |
| `frontend/src/emails/LeagueAnnouncement.tsx`| **New**  | League email template              |
| `frontend/src/app/events/[id]/page.tsx`     | Modify   | Add "Email Participants" button    |
| `frontend/src/app/leagues/[id]/page.tsx`    | Modify   | Add "Email Members" button         |

---

## Cost Projection

| Scale              | Monthly Emails | Cost     |
|--------------------|----------------|----------|
| Early (< 30 events)| ~900           | Free     |
| Growing (100 events)| ~3,000        | Free     |
| Scaling (500 events)| ~15,000       | $20/mo   |

---

## Setup Checklist

- [ ] Create Resend account at https://resend.com
- [ ] Get API key from Resend dashboard
- [ ] (Optional) Verify a custom sending domain for production
- [ ] Add `RESEND_API_KEY` to backend `.env`
- [ ] Implement backend email service and route
- [ ] Build React Email templates
- [ ] Add host email UI to event and league detail pages
- [ ] Test with Resend test domain
- [ ] Switch to verified domain for production
