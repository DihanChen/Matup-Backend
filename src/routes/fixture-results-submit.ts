import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import { asObject, getFixture } from './fixture-results.shared';

const router = Router();

router.post('/:id/results/submit', requireAuth, async (req: Request, res: Response) => {
  try {
    const fixtureId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;
    const payload = asObject(req.body?.payload);

    if (!fixtureId) {
      res.status(400).json({ error: 'fixture id is required' });
      return;
    }

    if (Object.keys(payload).length === 0) {
      res.status(400).json({ error: 'Result payload is required' });
      return;
    }

    const fixture = await getFixture(fixtureId);
    if (!fixture) {
      res.status(404).json({ error: 'Fixture not found' });
      return;
    }

    if (fixture.status === 'finalized' || fixture.status === 'cancelled') {
      res.status(400).json({ error: `Cannot submit results for ${fixture.status} fixture` });
      return;
    }

    const role = await getLeagueRole(fixture.league_id, userId);
    if (!role) {
      res.status(403).json({ error: 'You must be a league member to submit results' });
      return;
    }

    const submissionSource = isLeagueAdminRole(role) ? 'organizer' : 'participant';

    await supabaseAdmin
      .from('result_submissions')
      .update({ status: 'superseded' })
      .eq('fixture_id', fixtureId)
      .eq('submitted_by', userId)
      .eq('status', 'pending');

    const isOrganizerSubmission = submissionSource === 'organizer';
    const nowIso = new Date().toISOString();

    const { data: submission, error: submissionError } = await supabaseAdmin
      .from('result_submissions')
      .insert({
        fixture_id: fixtureId,
        submitted_by: userId,
        source: submissionSource,
        payload,
        status: isOrganizerSubmission ? 'accepted' : 'pending',
        reviewed_by: isOrganizerSubmission ? userId : null,
        reviewed_at: isOrganizerSubmission ? nowIso : null,
      })
      .select('id, fixture_id, submitted_by, source, status, payload, submitted_at')
      .single();

    if (submissionError || !submission) {
      res.status(500).json({ error: submissionError?.message || 'Failed to submit result' });
      return;
    }

    if (isOrganizerSubmission) {
      const existingMetadata = asObject(fixture.metadata);
      await supabaseAdmin
        .from('league_fixtures')
        .update({
          status: 'finalized',
          metadata: {
            ...existingMetadata,
            finalized_submission_id: submission.id,
            final_result: submission.payload,
          },
        })
        .eq('id', fixtureId);
    } else if (fixture.status === 'scheduled') {
      await supabaseAdmin
        .from('league_fixtures')
        .update({ status: 'submitted' })
        .eq('id', fixtureId);
    }

    res.json({
      success: true,
      submission,
      finalized: isOrganizerSubmission,
    });
  } catch (error) {
    console.error('Result submission error:', error);
    res.status(500).json({ error: 'Failed to submit result' });
  }
});

export default router;
