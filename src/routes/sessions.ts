import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';

const router = Router();

type SessionRow = {
  id: string;
  league_id: string;
  week_number: number | null;
  status: string;
  submission_deadline: string | null;
  distance_meters: number | null;
};

function toRulesObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getNestedBoolean(obj: Record<string, unknown>, path: string[]): boolean | null {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'boolean' ? current : null;
}

async function getSession(sessionId: string): Promise<SessionRow | null> {
  const { data, error } = await supabaseAdmin
    .from('running_sessions')
    .select('id, league_id, week_number, status, submission_deadline, distance_meters')
    .eq('id', sessionId)
    .single();

  if (error || !data) return null;
  return data as SessionRow;
}

async function requiresOrganizerApproval(leagueId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('leagues')
    .select('rules_jsonb')
    .eq('id', leagueId)
    .single();

  const rules = toRulesObject(data?.rules_jsonb);
  const required = getNestedBoolean(rules, ['submissions', 'require_organizer_approval']);
  return required === true;
}

router.post('/:id/runs/submit', requireAuth, async (req: Request, res: Response) => {
  try {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!sessionId) {
      res.status(400).json({ error: 'session id is required' });
      return;
    }

    const session = await getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const role = await getLeagueRole(session.league_id, userId);
    if (!role) {
      res.status(403).json({ error: 'You must be a league member to submit runs' });
      return;
    }

    if (session.status === 'finalized' || session.status === 'closed') {
      res.status(400).json({ error: `Cannot submit runs for ${session.status} sessions` });
      return;
    }

    if (session.submission_deadline) {
      const deadline = new Date(session.submission_deadline).getTime();
      if (Number.isFinite(deadline) && deadline < Date.now()) {
        res.status(400).json({ error: 'Submission deadline has passed' });
        return;
      }
    }

    const elapsedSecondsRaw = req.body?.elapsedSeconds;
    const elapsedSeconds =
      typeof elapsedSecondsRaw === 'number' && Number.isFinite(elapsedSecondsRaw)
        ? elapsedSecondsRaw
        : Number.parseFloat(String(elapsedSecondsRaw || ''));

    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      res.status(400).json({ error: 'elapsedSeconds must be a positive number' });
      return;
    }

    const distanceRaw = req.body?.distanceMeters;
    const distanceMeters =
      typeof distanceRaw === 'number' && Number.isFinite(distanceRaw)
        ? Math.round(distanceRaw)
        : session.distance_meters;

    if (!distanceMeters || distanceMeters <= 0) {
      res.status(400).json({ error: 'distanceMeters must be provided for this session' });
      return;
    }

    const proofUrl =
      typeof req.body?.proofUrl === 'string' && req.body.proofUrl.trim() !== ''
        ? req.body.proofUrl.trim()
        : null;

    const needReview = await requiresOrganizerApproval(session.league_id);
    const status = needReview ? 'submitted' : 'approved';

    const { data: run, error: runError } = await supabaseAdmin
      .from('session_runs')
      .upsert(
        {
          session_id: sessionId,
          user_id: userId,
          elapsed_seconds: elapsedSeconds,
          distance_meters: distanceMeters,
          proof_url: proofUrl,
          status,
          submitted_at: new Date().toISOString(),
          reviewed_by: null,
          reviewed_at: null,
          review_note: null,
        },
        {
          onConflict: 'session_id,user_id',
        }
      )
      .select(
        'id, session_id, user_id, elapsed_seconds, distance_meters, proof_url, status, submitted_at, reviewed_by, reviewed_at, review_note'
      )
      .single();

    if (runError || !run) {
      res.status(500).json({ error: runError?.message || 'Failed to submit run' });
      return;
    }

    if (session.status === 'scheduled') {
      await supabaseAdmin
        .from('running_sessions')
        .update({ status: 'open' })
        .eq('id', sessionId);
    }

    await supabaseAdmin
      .from('league_fixtures')
      .update({ status: 'submitted' })
      .eq('league_id', session.league_id)
      .eq('week_number', session.week_number)
      .eq('fixture_type', 'time_trial_session')
      .in('status', ['scheduled', 'confirmed']);

    res.json({
      success: true,
      run,
      requiresReview: needReview,
    });
  } catch (error) {
    console.error('Session run submit error:', error);
    res.status(500).json({ error: 'Failed to submit run' });
  }
});

router.post('/:id/runs/:runId/review', requireAuth, async (req: Request, res: Response) => {
  try {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
    const { userId } = req as AuthenticatedRequest;
    const decision = req.body?.decision === 'reject' ? 'reject' : 'approve';
    const note =
      typeof req.body?.note === 'string' && req.body.note.trim() !== ''
        ? req.body.note.trim()
        : null;

    if (!sessionId || !runId) {
      res.status(400).json({ error: 'session id and run id are required' });
      return;
    }

    const session = await getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const role = await getLeagueRole(session.league_id, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can review runs' });
      return;
    }

    const { data: run, error: runLookupError } = await supabaseAdmin
      .from('session_runs')
      .select('id, session_id, user_id, status')
      .eq('id', runId)
      .eq('session_id', sessionId)
      .single();

    if (runLookupError || !run) {
      res.status(404).json({ error: 'Run not found in this session' });
      return;
    }

    const nextStatus = decision === 'approve' ? 'approved' : 'rejected';

    const { data: updatedRun, error: updateError } = await supabaseAdmin
      .from('session_runs')
      .update({
        status: nextStatus,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        review_note: note,
      })
      .eq('id', runId)
      .select(
        'id, session_id, user_id, elapsed_seconds, distance_meters, proof_url, status, submitted_at, reviewed_by, reviewed_at, review_note'
      )
      .single();

    if (updateError || !updatedRun) {
      res.status(500).json({ error: updateError?.message || 'Failed to review run' });
      return;
    }

    res.json({
      success: true,
      run: updatedRun,
    });
  } catch (error) {
    console.error('Session run review error:', error);
    res.status(500).json({ error: 'Failed to review run' });
  }
});

router.post('/:id/finalize', requireAuth, async (req: Request, res: Response) => {
  try {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!sessionId) {
      res.status(400).json({ error: 'session id is required' });
      return;
    }

    const session = await getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const role = await getLeagueRole(session.league_id, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can finalize sessions' });
      return;
    }

    const needReview = await requiresOrganizerApproval(session.league_id);
    const promotableStatuses = needReview ? ['approved'] : ['approved', 'submitted'];

    const { data: promotableRuns } = await supabaseAdmin
      .from('session_runs')
      .select('id, elapsed_seconds')
      .eq('session_id', sessionId)
      .in('status', promotableStatuses);

    const runIds = (promotableRuns || []).map((run) => run.id);
    if (runIds.length > 0) {
      await supabaseAdmin
        .from('session_runs')
        .update({
          status: 'finalized',
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
        })
        .in('id', runIds);
    }

    await supabaseAdmin
      .from('running_sessions')
      .update({
        status: 'finalized',
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    const bestElapsedSeconds = (promotableRuns || []).reduce<number | null>((best, run) => {
      const elapsed = typeof run.elapsed_seconds === 'number' ? run.elapsed_seconds : null;
      if (elapsed == null) return best;
      if (best == null) return elapsed;
      return elapsed < best ? elapsed : best;
    }, null);

    await supabaseAdmin
      .from('league_fixtures')
      .update({
        status: 'finalized',
        metadata: {
          finalized_session_id: sessionId,
          finalized_runs: runIds.length,
          best_elapsed_seconds: bestElapsedSeconds,
        },
      })
      .eq('league_id', session.league_id)
      .eq('week_number', session.week_number)
      .eq('fixture_type', 'time_trial_session');

    res.json({
      success: true,
      finalizedRuns: runIds.length,
      requiresReview: needReview,
    });
  } catch (error) {
    console.error('Session finalize error:', error);
    res.status(500).json({ error: 'Failed to finalize session' });
  }
});

export default router;
