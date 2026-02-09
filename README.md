# MatUp Backend

Backend API for MatUp group email notifications.

## Tech Stack
- Node.js + Express
- TypeScript
- Supabase (auth + data access via service key)
- Resend (email delivery)

## Project Structure

```
backend/
├── src/
│   ├── app.ts
│   ├── index.ts
│   ├── config/
│   │   └── env.ts
│   ├── middleware/
│   │   └── auth.ts
│   ├── routes/
│   │   └── email.ts
│   ├── services/
│   │   └── email.service.ts
│   └── utils/
│       └── supabase.ts
└── .env.example
```

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Health check |
| POST | `/api/email/send` | Send event/league group email |

## Environment Variables

```bash
PORT=3001
NODE_ENV=development

SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-key

RESEND_API_KEY=re_xxxxxxxxxxxxx
RESEND_FROM=MatUp <onboarding@resend.dev>
FRONTEND_URL=http://localhost:3000
```

## Running Locally

```bash
npm install
npm run dev
```

## External Accounts

- Supabase: database + auth
- Resend: email delivery
