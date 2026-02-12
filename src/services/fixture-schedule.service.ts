export type ScheduledFixture = {
  weekNumber: number;
  sideA: string[];
  sideB: string[];
};

export function generateSinglesSchedule(
  memberIds: string[],
  weeks: number
): ScheduledFixture[] {
  const ids = [...memberIds];
  if (ids.length % 2 !== 0) {
    ids.push('BYE');
  }

  const count = ids.length;
  const rounds: ScheduledFixture[] = [];
  const totalRounds = count - 1;

  for (let week = 1; week <= weeks; week++) {
    const roundIndex = (week - 1) % totalRounds;
    const rotated = [ids[0]];

    for (let i = 1; i < count; i++) {
      const pos = ((i - 1 + roundIndex) % (count - 1)) + 1;
      rotated.push(ids[pos]);
    }

    for (let i = 0; i < count / 2; i++) {
      const a = rotated[i];
      const b = rotated[count - 1 - i];
      if (a === 'BYE' || b === 'BYE') continue;
      rounds.push({
        weekNumber: week,
        sideA: [a],
        sideB: [b],
      });
    }
  }

  return rounds;
}

export function generateDoublesRandomSchedule(
  memberIds: string[],
  weeks: number
): ScheduledFixture[] {
  const rounds: ScheduledFixture[] = [];

  for (let week = 1; week <= weeks; week++) {
    const shuffled = fisherYatesShuffle([...memberIds]);
    const playable = shuffled.length - (shuffled.length % 4);

    for (let i = 0; i < playable; i += 4) {
      rounds.push({
        weekNumber: week,
        sideA: [shuffled[i], shuffled[i + 1]],
        sideB: [shuffled[i + 2], shuffled[i + 3]],
      });
    }
  }

  return rounds;
}

export function generateDoublesAssignedSchedule(
  memberIds: string[],
  weeks: number,
  fixedTeams?: Array<[string, string]>
): ScheduledFixture[] {
  const teams: [string, string][] = fixedTeams?.length
    ? fixedTeams.map((team) => [team[0], team[1]])
    : (() => {
        const ids = [...memberIds];
        const generated: [string, string][] = [];
        for (let i = 0; i + 1 < ids.length; i += 2) {
          generated.push([ids[i], ids[i + 1]]);
        }
        return generated;
      })();

  if (teams.length < 2) return [];

  const teamList = [...teams];
  if (teamList.length % 2 !== 0) {
    teamList.push(['BYE', 'BYE']);
  }

  const count = teamList.length;
  const totalRounds = count - 1;
  const rounds: ScheduledFixture[] = [];

  for (let week = 1; week <= weeks; week++) {
    const roundIndex = (week - 1) % totalRounds;
    const rotated = [teamList[0]];

    for (let i = 1; i < count; i++) {
      const pos = ((i - 1 + roundIndex) % (count - 1)) + 1;
      rotated.push(teamList[pos]);
    }

    for (let i = 0; i < count / 2; i++) {
      const a = rotated[i];
      const b = rotated[count - 1 - i];
      if (a[0] === 'BYE' || b[0] === 'BYE') continue;
      rounds.push({
        weekNumber: week,
        sideA: [...a],
        sideB: [...b],
      });
    }
  }

  return rounds;
}

function fisherYatesShuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
