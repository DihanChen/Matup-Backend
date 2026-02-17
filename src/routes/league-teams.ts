import { Request, Response, Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import { getLeague } from '../services/league.service';
import { supabaseAdmin } from '../utils/supabase';
import { toRulesObject, type RulesObject } from '../utils/rules';
import {
  getConfiguredFixedPairs,
  isAssignedDoublesLeague,
} from '../services/league-rules.service';

const router = Router();

router.get('/:id/teams/assigned', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!role) {
      res.status(403).json({ error: 'You must be a league member to view assigned teams' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    const rules = toRulesObject(league.rules_jsonb);
    if (!isAssignedDoublesLeague(league, rules)) {
      res.status(400).json({
        error: 'Assigned teams are only available for doubles assigned leagues',
      });
      return;
    }

    const { data: memberRows, error: memberError } = await supabaseAdmin
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId);

    if (memberError) {
      res.status(500).json({ error: memberError.message });
      return;
    }

    const memberIds = (memberRows || []).map((item) => item.user_id);
    const memberIdSet = new Set(memberIds);
    const configuredPairs = getConfiguredFixedPairs(rules, memberIdSet);
    const pairedUserIds = new Set(configuredPairs.flat());
    const unpairedMemberIds = memberIds.filter((memberId) => !pairedUserIds.has(memberId));

    const { data: profiles } = memberIds.length
      ? await supabaseAdmin.from('profiles').select('id, name').in('id', memberIds)
      : { data: [] as Array<{ id: string; name: string | null }> };
    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile.name]));

    res.json({
      pairs: configuredPairs.map((pair) => ({
        playerAId: pair[0],
        playerAName: profileMap.get(pair[0]) || null,
        playerBId: pair[1],
        playerBName: profileMap.get(pair[1]) || null,
      })),
      unpairedMemberIds,
    });
  } catch (error) {
    console.error('Assigned teams fetch error:', error);
    res.status(500).json({ error: 'Failed to load assigned teams' });
  }
});

router.put('/:id/teams/assigned', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;
    const pairsInput = Array.isArray(req.body?.pairs) ? req.body.pairs : null;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can edit assigned teams' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    const rules = toRulesObject(league.rules_jsonb);
    if (!isAssignedDoublesLeague(league, rules)) {
      res.status(400).json({
        error: 'Assigned teams are only available for doubles assigned leagues',
      });
      return;
    }

    if (!pairsInput) {
      res.status(400).json({ error: 'pairs is required and must be an array' });
      return;
    }

    const { data: memberRows, error: memberError } = await supabaseAdmin
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId);

    if (memberError) {
      res.status(500).json({ error: memberError.message });
      return;
    }

    const memberIds = (memberRows || []).map((item) => item.user_id);
    const memberIdSet = new Set(memberIds);
    const used = new Set<string>();
    const fixedPairs: Array<[string, string]> = [];

    for (const entry of pairsInput) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        res.status(400).json({
          error: 'Each pair must be an object with playerAId and playerBId',
        });
        return;
      }

      const pairEntry = entry as Record<string, unknown>;
      const playerAId =
        typeof pairEntry.playerAId === 'string' ? pairEntry.playerAId.trim() : '';
      const playerBId =
        typeof pairEntry.playerBId === 'string' ? pairEntry.playerBId.trim() : '';

      if (!playerAId || !playerBId) {
        res.status(400).json({ error: 'Each pair must include playerAId and playerBId' });
        return;
      }
      if (playerAId === playerBId) {
        res.status(400).json({ error: 'A team cannot contain the same player twice' });
        return;
      }
      if (!memberIdSet.has(playerAId) || !memberIdSet.has(playerBId)) {
        res.status(400).json({ error: 'All assigned players must be current league members' });
        return;
      }
      if (used.has(playerAId) || used.has(playerBId)) {
        res.status(400).json({ error: 'Each player can only appear in one team' });
        return;
      }

      used.add(playerAId);
      used.add(playerBId);
      fixedPairs.push([playerAId, playerBId]);
    }

    const nextRules: RulesObject = {
      ...rules,
      match: {
        ...(toRulesObject((rules as Record<string, unknown>).match)),
        fixed_pairs: fixedPairs,
      },
    };

    const { error: updateError } = await supabaseAdmin
      .from('leagues')
      .update({ rules_jsonb: nextRules })
      .eq('id', leagueId);

    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }

    const unpairedMemberIds = memberIds.filter((memberId) => !used.has(memberId));
    const { data: profiles } = memberIds.length
      ? await supabaseAdmin.from('profiles').select('id, name').in('id', memberIds)
      : { data: [] as Array<{ id: string; name: string | null }> };
    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile.name]));

    res.json({
      success: true,
      pairs: fixedPairs.map((pair) => ({
        playerAId: pair[0],
        playerAName: profileMap.get(pair[0]) || null,
        playerBId: pair[1],
        playerBName: profileMap.get(pair[1]) || null,
      })),
      unpairedMemberIds,
    });
  } catch (error) {
    console.error('Assigned teams update error:', error);
    res.status(500).json({ error: 'Failed to update assigned teams' });
  }
});

export default router;
