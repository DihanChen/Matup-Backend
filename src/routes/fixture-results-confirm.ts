import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import {
  SubmissionRow,
  asObject,
  getFixture,
  getFixtureSide,
} from './fixture-results.shared';

const router = Router();

router.post('/:id/results/confirm', requireAuth, async (req: Request, res: Response) => {
  try {
    const fixtureId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;
    const submissionId = typeof req.body?.submissionId === 'string' ? req.body.submissionId : '';
    const decision = req.body?.decision === 'reject' ? 'reject' : 'confirm';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;

    if (!fixtureId) {
      res.status(400).json({ error: 'fixture id is required' });
      return;
    }

    if (!submissionId) {
      res.status(400).json({ error: 'submissionId is required' });
      return;
    }

    const fixture = await getFixture(fixtureId);
    if (!fixture) {
      res.status(404).json({ error: 'Fixture not found' });
      return;
    }

    const role = await getLeagueRole(fixture.league_id, userId);
    if (!role) {
      res.status(403).json({ error: 'You must be a league member to confirm results' });
      return;
    }

    const { data: submissionData, error: submissionError } = await supabaseAdmin
      .from('result_submissions')
      .select('id, fixture_id, submitted_by, source, status, payload')
      .eq('id', submissionId)
      .eq('fixture_id', fixtureId)
      .single();

    if (submissionError || !submissionData) {
      res.status(404).json({ error: 'Submission not found for this fixture' });
      return;
    }

    const submission = submissionData as SubmissionRow;

    if (submission.submitted_by === userId) {
      res.status(400).json({ error: 'Submitter cannot confirm their own submission' });
      return;
    }

    if (submission.status !== 'pending') {
      res.status(400).json({ error: `Submission is already ${submission.status}` });
      return;
    }

    let confirmingSide: 'A' | 'B' | 'organizer' | null = null;
    if (isLeagueAdminRole(role)) {
      confirmingSide = 'organizer';
    } else {
      confirmingSide = await getFixtureSide(fixtureId, userId);
    }

    if (!confirmingSide) {
      res.status(403).json({ error: 'Only fixture participants or organizers can confirm' });
      return;
    }

    const { error: confirmationError } = await supabaseAdmin
      .from('result_confirmations')
      .insert({
        submission_id: submissionId,
        fixture_id: fixtureId,
        confirmed_by: userId,
        confirming_side: confirmingSide,
        decision,
        reason,
      });

    if (confirmationError) {
      res.status(400).json({ error: confirmationError.message });
      return;
    }

    if (decision === 'reject') {
      await supabaseAdmin
        .from('result_submissions')
        .update({
          status: 'rejected',
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
          review_note: reason,
        })
        .eq('id', submissionId);

      await supabaseAdmin
        .from('league_fixtures')
        .update({ status: 'disputed' })
        .eq('id', fixtureId);

      res.json({ success: true, finalized: false, disputed: true });
      return;
    }

    const { data: confirmations } = await supabaseAdmin
      .from('result_confirmations')
      .select('confirming_side, decision')
      .eq('submission_id', submissionId);

    const confirmationSides = new Set(
      (confirmations || [])
        .filter((item) => item.decision === 'confirm')
        .map((item) => item.confirming_side)
    );

    const submitterSide =
      submission.source === 'participant'
        ? await getFixtureSide(fixtureId, submission.submitted_by)
        : null;

    let finalize = false;
    if (confirmationSides.has('organizer')) {
      finalize = true;
    } else if (submitterSide === 'A') {
      finalize = confirmationSides.has('B');
    } else if (submitterSide === 'B') {
      finalize = confirmationSides.has('A');
    } else {
      finalize = confirmationSides.has('A') && confirmationSides.has('B');
    }

    if (finalize) {
      await supabaseAdmin
        .from('result_submissions')
        .update({
          status: 'accepted',
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', submissionId);

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
    } else {
      await supabaseAdmin
        .from('league_fixtures')
        .update({ status: 'confirmed' })
        .eq('id', fixtureId)
        .in('status', ['submitted', 'confirmed']);
    }

    res.json({
      success: true,
      finalized: finalize,
      disputed: false,
    });
  } catch (error) {
    console.error('Result confirmation error:', error);
    res.status(500).json({ error: 'Failed to confirm result' });
  }
});

export default router;
