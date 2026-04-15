import { fetchOsmCourts, OverpassRequestError, type OsmCourt } from './overpass.service';
import { reverseGeocode, generateCourtName, buildGeocodedAddress, type NominatimAddress } from './nominatim.service';
import { supabaseAdmin } from '../utils/supabase';

const DEFAULT_OSM_COURT_NAME = 'Public Court';
const MIN_SUBDIVISION_SPAN = 0.04;
const MAX_SUBDIVISION_DEPTH = 3;

type ExistingCourtRow = {
  id: string;
  osm_id: number | null;
  source: string | null;
};

type CourtSeedInsert = {
  osm_id: number;
  osm_type: string;
  source: 'osm';
  status: 'approved';
  created_by: null;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  sport_types: string[];
  surface: string | null;
  lighting: boolean | null;
  access_type: string | null;
  operator: string | null;
  opening_hours: string | null;
  imported_at: string;
  last_seen_at: string;
};

type CourtSeedUpdate = {
  id: string;
  last_seen_at: string;
  updated_at?: string;
  osm_type?: string;
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  sport_types?: string[];
  surface?: string | null;
  lighting?: boolean | null;
  access_type?: string | null;
  operator?: string | null;
  opening_hours?: string | null;
};

export type PersistOsmCourtsResult = {
  inserted: number;
  updated: number;
  refreshed: number;
  total: number;
};

export type Bounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

function getBoundsSpan(bounds: Bounds): { latSpan: number; lonSpan: number } {
  return {
    latSpan: bounds.north - bounds.south,
    lonSpan: bounds.east - bounds.west,
  };
}

function subdivideBounds(bounds: Bounds): Bounds[] {
  const midLat = (bounds.south + bounds.north) / 2;
  const midLon = (bounds.west + bounds.east) / 2;

  return [
    { south: bounds.south, west: bounds.west, north: midLat, east: midLon },
    { south: bounds.south, west: midLon, north: midLat, east: bounds.east },
    { south: midLat, west: bounds.west, north: bounds.north, east: midLon },
    { south: midLat, west: midLon, north: bounds.north, east: bounds.east },
  ];
}

function uniqueCourtsByOsmId(courts: OsmCourt[]): OsmCourt[] {
  const unique = new Map<number, OsmCourt>();

  for (const court of courts) {
    if (!Number.isFinite(court.osm_id)) {
      continue;
    }

    unique.set(court.osm_id, court);
  }

  return Array.from(unique.values());
}

function normalizeSportTypes(sport: string): string[] {
  const supportedSports = new Set(['tennis', 'pickleball']);
  const normalized = sport
    .split(/[;,]/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => supportedSports.has(value));

  return normalized.length > 0 ? Array.from(new Set(normalized)) : ['tennis'];
}

function normalizeCourtName(name: string | null): string {
  if (typeof name === 'string' && name.trim() !== '') {
    return name.trim();
  }

  return DEFAULT_OSM_COURT_NAME;
}

export function buildDefaultOsmCourtAddress(name: string | null): string {
  return `${normalizeCourtName(name)}, OpenStreetMap`;
}

function resolveCourtName(
  osmName: string | null,
  sportTypes: string[],
  operator: string | null,
  geocoded: NominatimAddress | null
): string {
  if (typeof osmName === 'string' && osmName.trim() !== '') {
    return osmName.trim();
  }
  return generateCourtName(sportTypes, operator, geocoded);
}

function resolveCourtAddress(
  osmName: string | null,
  geocoded: NominatimAddress | null
): string {
  const geocodedAddr = buildGeocodedAddress(geocoded);
  if (geocodedAddr) return geocodedAddr;
  return buildDefaultOsmCourtAddress(osmName);
}

function toInsertPayload(court: OsmCourt, nowIso: string, geocoded: NominatimAddress | null): CourtSeedInsert {
  const sportTypes = normalizeSportTypes(court.sport);
  return {
    osm_id: court.osm_id,
    osm_type: court.osm_type,
    source: 'osm',
    status: 'approved',
    created_by: null,
    name: resolveCourtName(court.name, sportTypes, court.operator, geocoded),
    address: resolveCourtAddress(court.name, geocoded),
    latitude: court.latitude,
    longitude: court.longitude,
    sport_types: sportTypes,
    surface: court.surface,
    lighting: court.lit,
    access_type: court.access,
    operator: court.operator,
    opening_hours: court.opening_hours,
    imported_at: nowIso,
    last_seen_at: nowIso,
  };
}

function toOsmRefreshPayload(existing: ExistingCourtRow, court: OsmCourt, nowIso: string, geocoded: NominatimAddress | null): CourtSeedUpdate {
  const sportTypes = normalizeSportTypes(court.sport);
  return {
    id: existing.id,
    osm_type: court.osm_type,
    name: resolveCourtName(court.name, sportTypes, court.operator, geocoded),
    address: resolveCourtAddress(court.name, geocoded),
    latitude: court.latitude,
    longitude: court.longitude,
    sport_types: sportTypes,
    surface: court.surface,
    lighting: court.lit,
    access_type: court.access,
    operator: court.operator,
    opening_hours: court.opening_hours,
    last_seen_at: nowIso,
    updated_at: nowIso,
  };
}

function toExistingRefreshPayload(existing: ExistingCourtRow, nowIso: string): CourtSeedUpdate {
  return {
    id: existing.id,
    last_seen_at: nowIso,
  };
}

export async function persistOsmCourts(courts: OsmCourt[]): Promise<PersistOsmCourtsResult> {
  const dedupedCourts = uniqueCourtsByOsmId(courts);
  if (dedupedCourts.length === 0) {
    return { inserted: 0, updated: 0, refreshed: 0, total: 0 };
  }

  const { data: existingRows, error: selectError } = await supabaseAdmin
    .from('courts')
    .select('id, osm_id, source')
    .in('osm_id', dedupedCourts.map((court) => court.osm_id));

  if (selectError) {
    throw new Error(selectError.message || 'Failed to load existing courts');
  }

  const existingByOsmId = new Map<number, ExistingCourtRow>();
  for (const row of (existingRows || []) as ExistingCourtRow[]) {
    if (typeof row.osm_id === 'number') {
      existingByOsmId.set(row.osm_id, row);
    }
  }

  const nowIso = new Date().toISOString();
  const inserts: CourtSeedInsert[] = [];
  const osmUpdates: CourtSeedUpdate[] = [];
  const existingRefreshes: CourtSeedUpdate[] = [];

  // Reverse geocode unnamed courts (rate-limited, sequential)
  const geocodeCache = new Map<string, NominatimAddress | null>();

  async function getGeocoded(court: OsmCourt): Promise<NominatimAddress | null> {
    // Only geocode if court has no name
    if (court.name && court.name.trim()) return null;

    // Cache by rounded coordinates to avoid duplicate requests for nearby courts
    const key = `${court.latitude.toFixed(4)},${court.longitude.toFixed(4)}`;
    if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;

    const result = await reverseGeocode(court.latitude, court.longitude);
    const address = result?.address ?? null;
    geocodeCache.set(key, address);
    return address;
  }

  for (const court of dedupedCourts) {
    const existing = existingByOsmId.get(court.osm_id);
    if (!existing) {
      const geocoded = await getGeocoded(court);
      inserts.push(toInsertPayload(court, nowIso, geocoded));
      continue;
    }

    if (existing.source === 'osm') {
      const geocoded = await getGeocoded(court);
      osmUpdates.push(toOsmRefreshPayload(existing, court, nowIso, geocoded));
      continue;
    }

    existingRefreshes.push(toExistingRefreshPayload(existing, nowIso));
  }

  if (inserts.length > 0) {
    const { error: insertError } = await supabaseAdmin.from('courts').insert(inserts);
    if (insertError) {
      throw new Error(insertError.message || 'Failed to insert OSM courts');
    }
  }

  const updates = [...osmUpdates, ...existingRefreshes];
  if (updates.length > 0) {
    const updateResults = await Promise.all(
      updates.map(async ({ id, ...payload }) =>
        supabaseAdmin
          .from('courts')
          .update(payload)
          .eq('id', id)
      )
    );

    const updateError = updateResults.find((result) => result.error)?.error;
    if (updateError) {
      throw new Error(updateError.message || 'Failed to refresh existing courts');
    }
  }

  return {
    inserted: inserts.length,
    updated: osmUpdates.length,
    refreshed: existingRefreshes.length,
    total: dedupedCourts.length,
  };
}

export async function importOsmCourtsForBounds(
  south: number,
  west: number,
  north: number,
  east: number,
  options?: { persist?: boolean }
): Promise<{ courts: OsmCourt[]; persisted: PersistOsmCourtsResult | null }> {
  const bounds = { south, west, north, east };
  const courts = await fetchOsmCourtsResilient(bounds);

  if (!options?.persist) {
    return { courts, persisted: null };
  }

  const persisted = await persistOsmCourts(courts);
  return { courts, persisted };
}

async function fetchOsmCourtsResilient(bounds: Bounds, depth = 0): Promise<OsmCourt[]> {
  try {
    return await fetchOsmCourts(bounds.south, bounds.west, bounds.north, bounds.east);
  } catch (error) {
    if (!(error instanceof OverpassRequestError) || !error.retriable) {
      throw error;
    }

    const { latSpan, lonSpan } = getBoundsSpan(bounds);
    const canSubdivide =
      depth < MAX_SUBDIVISION_DEPTH &&
      (latSpan > MIN_SUBDIVISION_SPAN || lonSpan > MIN_SUBDIVISION_SPAN);

    if (!canSubdivide) {
      throw error;
    }

    const segments = subdivideBounds(bounds);
    const segmentResults: OsmCourt[][] = [];

    for (const segment of segments) {
      segmentResults.push(await fetchOsmCourtsResilient(segment, depth + 1));
    }

    return uniqueCourtsByOsmId(segmentResults.flat());
  }
}

export function splitBoundsIntoTiles(bounds: Bounds, maxSpan = 0.45): Bounds[] {
  const latSpan = bounds.north - bounds.south;
  const lonSpan = bounds.east - bounds.west;
  const latSteps = Math.max(1, Math.ceil(latSpan / maxSpan));
  const lonSteps = Math.max(1, Math.ceil(lonSpan / maxSpan));
  const latStepSize = latSpan / latSteps;
  const lonStepSize = lonSpan / lonSteps;
  const tiles: Bounds[] = [];

  for (let latIndex = 0; latIndex < latSteps; latIndex += 1) {
    const south = bounds.south + latIndex * latStepSize;
    const north = latIndex === latSteps - 1 ? bounds.north : south + latStepSize;

    for (let lonIndex = 0; lonIndex < lonSteps; lonIndex += 1) {
      const west = bounds.west + lonIndex * lonStepSize;
      const east = lonIndex === lonSteps - 1 ? bounds.east : west + lonStepSize;

      tiles.push({ south, west, north, east });
    }
  }

  return tiles;
}
