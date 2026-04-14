export type TournamentFixture = {
  round: number;
  matchNumber: number;
  sideA: string[];
  sideB: string[];
  isBye: boolean;
};

function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function fisherYatesShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generates a single-elimination bracket.
 * Returns fixtures for all rounds, including byes in round 1.
 * Later rounds have empty sides (TBD) that get filled via auto-advance.
 */
export function generateSingleEliminationSchedule(
  memberIds: string[],
  seeding: 'random' | 'manual' = 'random',
  manualOrder?: string[]
): TournamentFixture[] {
  const count = memberIds.length;
  if (count < 2) return [];

  const bracketSize = nextPowerOf2(count);
  const totalRounds = Math.log2(bracketSize);
  const numByes = bracketSize - count;

  // Seed order
  const seeded =
    seeding === 'manual' && manualOrder?.length === count
      ? manualOrder
      : fisherYatesShuffle(memberIds);

  // Place players into bracket slots with byes at the bottom
  const slots: (string | null)[] = new Array(bracketSize).fill(null);
  for (let i = 0; i < seeded.length; i++) {
    slots[i] = seeded[i];
  }

  const fixtures: TournamentFixture[] = [];
  let matchNumber = 1;

  // Round 1: pair up slots
  for (let i = 0; i < bracketSize; i += 2) {
    const a = slots[i];
    const b = slots[i + 1];
    const isBye = a === null || b === null;

    fixtures.push({
      round: 1,
      matchNumber,
      sideA: a ? [a] : [],
      sideB: b ? [b] : [],
      isBye,
    });
    matchNumber++;
  }

  // Subsequent rounds: empty fixtures (filled by auto-advance)
  let matchesInRound = bracketSize / 2;
  for (let round = 2; round <= totalRounds; round++) {
    matchesInRound = matchesInRound / 2;
    for (let m = 0; m < matchesInRound; m++) {
      fixtures.push({
        round,
        matchNumber,
        sideA: [],
        sideB: [],
        isBye: false,
      });
      matchNumber++;
    }
  }

  return fixtures;
}

/**
 * Returns the total number of rounds for a single-elimination bracket.
 */
export function getTotalRounds(playerCount: number): number {
  if (playerCount < 2) return 0;
  return Math.ceil(Math.log2(playerCount));
}
