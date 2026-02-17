function parseTimeParts(startTime: string | null | undefined): { hours: number; minutes: number } {
  if (!startTime) return { hours: 12, minutes: 0 };
  const parts = startTime.split(':');
  if (parts.length !== 2) return { hours: 12, minutes: 0 };

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const isValid =
    Number.isInteger(hours) &&
    Number.isInteger(minutes) &&
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes <= 59;

  if (!isValid) return { hours: 12, minutes: 0 };
  return { hours, minutes };
}

export function weekStartIso(
  startDate: string | null,
  weekNumber: number,
  startTime: string | null = null
): string | null {
  if (!startDate) return null;
  const { hours, minutes } = parseTimeParts(startTime);
  const base = new Date(`${startDate}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + (weekNumber - 1) * 7);
  base.setUTCHours(hours, minutes, 0, 0);
  return base.toISOString();
}

export function weekEndIso(startsAt: string | null): string | null {
  if (!startsAt) return null;
  const end = new Date(startsAt);
  if (Number.isNaN(end.getTime())) return null;
  end.setUTCHours(end.getUTCHours() + 2);
  return end.toISOString();
}

export function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
