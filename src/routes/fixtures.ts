import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';

const router = Router();

type FixtureRow = {
  id: string;
  league_id: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

type SubmissionRow = {
  id: string;
  fixture_id: string;
  submitted_by: string;
  source: string;
  status: string;
  payload: Record<string, unknown>;
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function getFixture(fixtureId: string): Promise<FixtureRow | null> {
  const { data, error } = await supabaseAdmin
    .from('league_fixtures')
    .select('id, league_id, status, metadata')
    .eq('id', fixtureId)
    .single();

  if (error || !data) return null;
  return data as FixtureRow;
}

async function getFixtureSide(
  fixtureId: string,
  userId: string
): Promise<'A' | 'B' | null> {
  const { data, error } = await supabaseAdmin
    .from('league_fixture_participants')
    .select('side')
    .eq('fixture_id', fixtureId)
    .eq('user_id', userId)
    .single();

  if (error || !data?.side) return null;
  return data.side as 'A' | 'B';
}

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

router.post('/:id/results/resolve', requireAuth, async (req: Request, res: Response) => {
  try {
    const fixtureId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;
    const submissionId = typeof req.body?.submissionId === 'string' ? req.body.submissionId : '';
    const manualPayload = asObject(req.body?.payload);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

    if (!fixtureId) {
      res.status(400).json({ error: 'fixture id is required' });
      return;
    }

    const fixture = await getFixture(fixtureId);
    if (!fixture) {
      res.status(404).json({ error: 'Fixture not found' });
      return;
    }

    const role = await getLeagueRole(fixture.league_id, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can resolve disputed results' });
      return;
    }

    let finalPayload: Record<string, unknown> = {};
    let finalizedSubmissionId: string | null = null;
    const nowIso = new Date().toISOString();

    if (submissionId) {
      const { data: submissionData, error: submissionError } = await supabaseAdmin
        .from('result_submissions')
        .select('id, fixture_id, payload')
        .eq('id', submissionId)
        .eq('fixture_id', fixtureId)
        .single();

      if (submissionError || !submissionData) {
        res.status(404).json({ error: 'Submission not found for this fixture' });
        return;
      }

      finalPayload = asObject(submissionData.payload);
      finalizedSubmissionId = submissionData.id;

      await supabaseAdmin
        .from('result_submissions')
        .update({
          status: 'accepted',
          reviewed_by: userId,
          reviewed_at: nowIso,
          review_note: reason || null,
        })
        .eq('id', submissionId);
    } else {
      if (Object.keys(manualPayload).length === 0) {
        res.status(400).json({ error: 'payload or submissionId is required' });
        return;
      }

      finalPayload = manualPayload;
      const { data: insertedSubmission, error: insertError } = await supabaseAdmin
        .from('result_submissions')
        .insert({
          fixture_id: fixtureId,
          submitted_by: userId,
          source: 'organizer',
          payload: manualPayload,
          status: 'accepted',
          submitted_at: nowIso,
          reviewed_by: userId,
          reviewed_at: nowIso,
          review_note: reason || null,
        })
        .select('id')
        .single();

      if (insertError || !insertedSubmission) {
        res.status(500).json({ error: insertError?.message || 'Failed to save resolved result' });
        return;
      }

      finalizedSubmissionId = insertedSubmission.id;
    }

    await supabaseAdmin
      .from('result_submissions')
      .update({
        status: 'superseded',
        reviewed_by: userId,
        reviewed_at: nowIso,
      })
      .eq('fixture_id', fixtureId)
      .neq('id', finalizedSubmissionId || '')
      .in('status', ['pending', 'rejected']);

    const existingMetadata = asObject(fixture.metadata);
    await supabaseAdmin
      .from('league_fixtures')
      .update({
        status: 'finalized',
        metadata: {
          ...existingMetadata,
          finalized_submission_id: finalizedSubmissionId,
          final_result: finalPayload,
          resolved_by: userId,
          resolved_at: nowIso,
          resolution_reason: reason || null,
        },
      })
      .eq('id', fixtureId);

    res.json({
      success: true,
      finalized: true,
      submissionId: finalizedSubmissionId,
    });
  } catch (error) {
    console.error('Result resolve error:', error);
    res.status(500).json({ error: 'Failed to resolve result' });
  }
});

export default router;
