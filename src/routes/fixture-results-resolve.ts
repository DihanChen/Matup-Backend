import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import { asObject, getFixture } from './fixture-results.shared';

const router = Router();

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
