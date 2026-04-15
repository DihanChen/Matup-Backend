import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import { notifyLeagueMembers } from '../services/notification.service';

const router: Router = Router();

/**
 * GET /api/leagues/:id/announcements
 * List announcements for a league (newest first).
 */
router.get('/:id/announcements', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!role) {
      res.status(403).json({ error: 'You must be a league member to view announcements' });
      return;
    }

    const { data: announcements, error } = await supabaseAdmin
      .from('league_announcements')
      .select('id, league_id, author_id, title, body, created_at')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Enrich with author names
    const authorIds = [...new Set((announcements || []).map((a) => a.author_id))];
    const profileMap = new Map<string, string>();

    if (authorIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, name')
        .in('id', authorIds);

      (profiles || []).forEach((p) => {
        if (p.name) profileMap.set(p.id, p.name);
      });
    }

    const enriched = (announcements || []).map((a) => ({
      ...a,
      author_name: profileMap.get(a.author_id) || 'Organizer',
    }));

    res.json({ announcements: enriched });
  } catch (error) {
    console.error('Announcements fetch error:', error);
    res.status(500).json({ error: 'Failed to load announcements' });
  }
});

/**
 * POST /api/leagues/:id/announcements
 * Create a new announcement. Only league owner/admin.
 */
router.post('/:id/announcements', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    if (!title || !body) {
      res.status(400).json({ error: 'title and body are required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can post announcements' });
      return;
    }

    const { data: announcement, error } = await supabaseAdmin
      .from('league_announcements')
      .insert({
        league_id: leagueId,
        author_id: userId,
        title,
        body,
      })
      .select('id, league_id, author_id, title, body, created_at')
      .single();

    if (error || !announcement) {
      res.status(500).json({ error: error?.message || 'Failed to create announcement' });
      return;
    }

    res.json({ success: true, announcement });

    // Notify league members (non-blocking)
    notifyLeagueMembers(leagueId, userId, {
      title: `Announcement: ${title}`,
      body: body.length > 100 ? `${body.slice(0, 100)}...` : body,
      data: { type: 'announcement', leagueId },
    }).catch(() => {});
  } catch (error) {
    console.error('Announcement create error:', error);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

export default router;
