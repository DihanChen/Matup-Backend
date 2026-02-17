export function weekStartIso(startDate: string | null, weekNumber: number): string | null {
  if (!startDate) return null;
  const base = new Date(`${startDate}T12:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + (weekNumber - 1) * 7);
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
