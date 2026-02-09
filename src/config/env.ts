import { config } from 'dotenv';
config();

export const env = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',

  // Resend
  resendApiKey: process.env.RESEND_API_KEY || '',
  resendFrom: process.env.RESEND_FROM || 'MatUp <onboarding@resend.dev>',

  // Frontend URL (for links in emails)
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
} as const;

export function validateEnv(): void {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'RESEND_API_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`Warning: Missing environment variables: ${missing.join(', ')}`);
  }
}
