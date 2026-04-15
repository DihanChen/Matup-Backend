import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';

const router: Router = Router();

/**
 * POST /api/users/push-token
 * Register or update an Expo push token for the authenticated user.
 */
router.post('/push-token', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : null;
    const platform = typeof req.body?.platform === 'string' ? req.body.platform : null;

    if (!token || !token.startsWith('ExponentPushToken[')) {
      res.status(400).json({ error: 'Valid Expo push token is required' });
      return;
    }

    const validPlatforms = ['ios', 'android', 'web'];
    const safePlatform = platform && validPlatforms.includes(platform) ? platform : null;

    // Upsert: insert or update if the token already exists for this user
    const { error } = await supabaseAdmin
      .from('push_tokens')
      .upsert(
        {
          user_id: userId,
          expo_push_token: token,
          device_id: deviceId,
          platform: safePlatform,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,expo_push_token',
        }
      );

    if (error) {
      console.error('Push token upsert error:', error.message);
      res.status(500).json({ error: 'Failed to register push token' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Push token registration error:', error);
    res.status(500).json({ error: 'Failed to register push token' });
  }
});

/**
 * DELETE /api/users/push-token
 * Remove a push token (e.g., on logout).
 */
router.delete('/push-token', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';

    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    await supabaseAdmin
      .from('push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('expo_push_token', token);

    res.json({ success: true });
  } catch (error) {
    console.error('Push token removal error:', error);
    res.status(500).json({ error: 'Failed to remove push token' });
  }
});

export default router;
