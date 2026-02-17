export type RulesObject = Record<string, unknown>;

export function toRulesObject(value: unknown): RulesObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as RulesObject;
  }
  return {};
}

function getNestedValue(obj: RulesObject, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function getNestedBoolean(obj: RulesObject, path: string[]): boolean | null {
  const value = getNestedValue(obj, path);
  return typeof value === 'boolean' ? value : null;
}

export function getNestedNumber(obj: RulesObject, path: string[]): number | null {
  const value = getNestedValue(obj, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getNestedString(obj: RulesObject, path: string[]): string | null {
  const value = getNestedValue(obj, path);
  return typeof value === 'string' ? value : null;
}

export function getNestedArray(obj: RulesObject, path: string[]): unknown[] | null {
  const value = getNestedValue(obj, path);
  return Array.isArray(value) ? value : null;
}
