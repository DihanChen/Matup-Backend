import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../utils/supabase';

export interface AuthenticatedRequest extends Request {
  userId: string;
  userEmail?: string;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.split(' ')[1];

    // Verify the JWT with Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Attach user info to request
    (req as AuthenticatedRequest).userId = user.id;
    (req as AuthenticatedRequest).userEmail = user.email;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}
