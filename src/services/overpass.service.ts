type OverpassElement = {
  id: number;
  type: 'way' | 'node' | string;
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: Record<string, string | undefined>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

export type OsmCourt = {
  osm_id: number;
  osm_type: string;
  name: string | null;
  latitude: number;
  longitude: number;
  sport: string;
  surface: string | null;
  lit: boolean | null;
  access: string | null;
  operator: string | null;
  opening_hours: string | null;
};

type CacheEntry = {
  data: OsmCourt[];
  expiresAt: number;
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_CLEAN_INTERVAL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function roundCoord(value: number): string {
  return value.toFixed(2);
}

function getCacheKey(south: number, west: number, north: number, east: number): string {
  return [south, west, north, east].map(roundCoord).join(',');
}

function cleanupExpiredCacheEntries(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

const cleanupInterval = setInterval(cleanupExpiredCacheEntries, CACHE_CLEAN_INTERVAL_MS);
cleanupInterval.unref();

function parseLit(value: string | undefined): boolean | null {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

function getCoordinates(element: OverpassElement): { latitude: number; longitude: number } | null {
  if (element.type === 'way') {
    if (typeof element.center?.lat === 'number' && typeof element.center?.lon === 'number') {
      return { latitude: element.center.lat, longitude: element.center.lon };
    }
    return null;
  }

  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    return { latitude: element.lat, longitude: element.lon };
  }

  return null;
}

export async function fetchOsmCourts(
  south: number,
  west: number,
  north: number,
  east: number
): Promise<OsmCourt[]> {
  const cacheKey = getCacheKey(south, west, north, east);
  const cached = cache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  if (cached && cached.expiresAt <= now) {
    cache.delete(cacheKey);
  }

  const query = `[out:json][timeout:15];
(
  way["leisure"="pitch"]["sport"="tennis"](${south},${west},${north},${east});
  way["leisure"="pitch"]["sport"="pickleball"](${south},${west},${north},${east});
  node["leisure"="pitch"]["sport"="tennis"](${south},${west},${north},${east});
  node["leisure"="pitch"]["sport"="pickleball"](${south},${west},${north},${east});
);
out center;`;

  const body = new URLSearchParams();
  body.append('data', query);

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status}`);
  }

  const payload = (await response.json()) as OverpassResponse;
  const courts = (payload.elements || []).reduce<OsmCourt[]>((acc, element) => {
    const coords = getCoordinates(element);
    if (!coords) return acc;

    const tags = element.tags || {};
    const sport = typeof tags.sport === 'string' ? tags.sport : '';
    if (!sport) return acc;

    acc.push({
      osm_id: element.id,
      osm_type: element.type,
      name: tags.name || null,
      latitude: coords.latitude,
      longitude: coords.longitude,
      sport,
      surface: tags.surface || null,
      lit: parseLit(tags.lit),
      access: tags.access || null,
      operator: tags.operator || null,
      opening_hours: tags.opening_hours || null,
    });

    return acc;
  }, []);

  cache.set(cacheKey, {
    data: courts,
    expiresAt: now + CACHE_TTL_MS,
  });

  return courts;
}
