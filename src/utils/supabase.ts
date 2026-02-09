import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

// Admin client with service key for backend operations
export const supabaseAdmin = createClient(
  env.supabaseUrl,
  env.supabaseServiceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
