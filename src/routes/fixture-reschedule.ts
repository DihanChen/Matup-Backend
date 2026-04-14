import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import { notifyFixtureParticipants } from '../services/notification.service';
import { asObject, getFixture } from './fixture-results.shared';

const router: Router = Router();

/**
 * PATCH /api/fixtures/:id/reschedule
 * Reschedule a fixture. Only league owner/admin can reschedule.
 * Accepts: starts_at, ends_at (optional), court_id (optional)
 */
router.patch('/:id/reschedule', requireAuth, async (req: Request, res: Response) => {
  try {
    const fixtureId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!fixtureId) {
      res.status(400).json({ error: 'fixture id is required' });
      return;
    }

    const startsAt = typeof req.body?.starts_at === 'string' ? req.body.starts_at.trim() : null;
    const endsAt = typeof req.body?.ends_at === 'string' ? req.body.ends_at.trim() : null;
    const courtId = typeof req.body?.court_id === 'string' ? req.body.court_id.trim() : undefined;

    if (!startsAt) {
      res.status(400).json({ error: 'starts_at is required' });
      return;
    }

    const parsedStart = new Date(startsAt);
    if (isNaN(parsedStart.getTime())) {
      res.status(400).json({ error: 'starts_at must be a valid date' });
      return;
    }

    const fixture = await getFixture(fixtureId);
    if (!fixture) {
      res.status(404).json({ error: 'Fixture not found' });
      return;
    }

    if (fixture.status === 'finalized' || fixture.status === 'cancelled') {
      res.status(400).json({ error: `Cannot reschedule a ${fixture.status} fixture` });
      return;
    }

    const role = await getLeagueRole(fixture.league_id, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can reschedule fixtures' });
      return;
    }

    // Build reschedule history entry
    const existingMetadata = asObject(fixture.metadata);
    const rescheduleHistory = Array.isArray(existingMetadata.reschedule_history)
      ? [...existingMetadata.reschedule_history]
      : [];

    // Fetch current starts_at for history
    const { data: currentFixture } = await supabaseAdmin
      .from('league_fixtures')
      .select('starts_at, ends_at, court_id')
      .eq('id', fixtureId)
      .single();

    rescheduleHistory.push({
      previous_starts_at: currentFixture?.starts_at || null,
      previous_ends_at: currentFixture?.ends_at || null,
      previous_court_id: currentFixture?.court_id || null,
      rescheduled_by: userId,
      rescheduled_at: new Date().toISOString(),
    });

    const updatePayload: Record<string, unknown> = {
      starts_at: startsAt,
      metadata: {
        ...existingMetadata,
        reschedule_history: rescheduleHistory,
      },
    };

    if (endsAt) {
      updatePayload.ends_at = endsAt;
    }

    if (courtId !== undefined) {
      updatePayload.court_id = courtId || null;
    }

    const { error: updateError } = await supabaseAdmin
      .from('league_fixtures')
      .update(updatePayload)
      .eq('id', fixtureId);

    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }

    res.json({ success: true });

    // Notify participants about reschedule (non-blocking)
    const weekLabel = fixture.week_number ? `Week ${fixture.week_number} ` : '';
    const dateLabel = parsedStart.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    notifyFixtureParticipants(fixtureId, userId, {
      title: `${weekLabel}Match Rescheduled`,
      body: `Your ${weekLabel}match has been rescheduled to ${dateLabel}.`,
      data: { type: 'fixture_rescheduled', leagueId: fixture.league_id, fixtureId },
    }).catch(() => {});
  } catch (error) {
    console.error('Fixture reschedule error:', error);
    res.status(500).json({ error: 'Failed to reschedule fixture' });
  }
});

export default router;
