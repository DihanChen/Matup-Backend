import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { courtsOsmRateLimit } from '../middleware/rate-limit';
import { fetchOsmCourts } from '../services/overpass.service';
import { supabaseAdmin } from '../utils/supabase';

const router = Router();
const DEFAULT_OSM_COURT_NAME = 'Public Court';

type OsmImportBody = {
  osm_id: number;
  osm_type: string;
  name: string;
  latitude: number;
  longitude: number;
  sport_types: string[];
  surface: string | null;
  address: string;
};

type CourtDetailsPatchBody = {
  surface?: string | null;
  num_courts?: number | null;
  lighting?: boolean | null;
  access_type?: string | null;
  amenities?: string[];
  opening_hours?: string | null;
};

function parseNumberParam(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return Number.NaN;
  return Number.parseFloat(raw);
}

router.get('/osm', courtsOsmRateLimit, async (req: Request, res: Response) => {
  try {
    const south = parseNumberParam(req.query.south);
    const west = parseNumberParam(req.query.west);
    const north = parseNumberParam(req.query.north);
    const east = parseNumberParam(req.query.east);

    if (![south, west, north, east].every((value) => Number.isFinite(value))) {
      res.status(400).json({ error: 'south, west, north, east must be valid numbers' });
      return;
    }

    const latSpan = Math.abs(north - south);
    const lonSpan = Math.abs(east - west);

    if (latSpan > 0.5 || lonSpan > 0.5) {
      res.status(400).json({ error: 'Bounding box span must be <= 0.5 degrees on each axis' });
      return;
    }

    if (north <= south || east <= west) {
      res.status(400).json({ error: 'Bounding box coordinates are invalid' });
      return;
    }

    const courts = await fetchOsmCourts(south, west, north, east);
    res.json({ courts });
  } catch (error) {
    console.error('OSM courts fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch OSM courts' });
  }
});

router.post('/osm/import', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<OsmImportBody>;
    const normalizedName =
      typeof body.name === 'string' && body.name.trim() !== ''
        ? body.name.trim()
        : DEFAULT_OSM_COURT_NAME;

    if (
      typeof body.osm_id !== 'number' ||
      !Number.isFinite(body.osm_id) ||
      typeof body.osm_type !== 'string' ||
      body.osm_type.trim() === '' ||
      typeof body.latitude !== 'number' ||
      !Number.isFinite(body.latitude) ||
      typeof body.longitude !== 'number' ||
      !Number.isFinite(body.longitude) ||
      !Array.isArray(body.sport_types) ||
      body.sport_types.length === 0 ||
      body.sport_types.some((sport) => typeof sport !== 'string' || sport.trim() === '') ||
      typeof body.address !== 'string' ||
      body.address.trim() === ''
    ) {
      res.status(400).json({ error: 'Invalid import payload' });
      return;
    }

    const osmId = body.osm_id;

    const { data: existingCourt, error: existingCourtError } = await supabaseAdmin
      .from('courts')
      .select('id')
      .eq('osm_id', osmId)
      .maybeSingle();

    if (existingCourtError) {
      res.status(500).json({ error: existingCourtError.message || 'Failed to import court' });
      return;
    }

    if (existingCourt) {
      const { data: updatedCourt, error: updateError } = await supabaseAdmin
        .from('courts')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', existingCourt.id)
        .select('*')
        .single();

      if (updateError || !updatedCourt) {
        res.status(500).json({ error: updateError?.message || 'Failed to import court' });
        return;
      }

      res.json({ court: updatedCourt });
      return;
    }

    const { data: insertedCourt, error: insertError } = await supabaseAdmin
      .from('courts')
      .insert({
        osm_id: osmId,
        osm_type: body.osm_type.trim(),
        source: 'osm',
        status: 'approved',
        created_by: null,
        name: normalizedName,
        latitude: body.latitude,
        longitude: body.longitude,
        sport_types: body.sport_types.map((sport) => sport.trim().toLowerCase()),
        surface: body.surface || null,
        address: body.address.trim(),
      })
      .select('*')
      .single();

    if (insertError || !insertedCourt) {
      res.status(500).json({ error: insertError?.message || 'Failed to import court' });
      return;
    }

    res.json({ court: insertedCourt });
  } catch (error) {
    console.error('OSM court import error:', error);
    res.status(500).json({ error: 'Failed to import court' });
  }
});

router.patch('/:id/details', requireAuth, async (req: Request, res: Response) => {
  try {
    const courtId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!courtId) {
      res.status(400).json({ error: 'court id is required' });
      return;
    }

    const body = req.body as CourtDetailsPatchBody;
    const updates: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(body, 'surface')) {
      if (body.surface !== null && typeof body.surface !== 'string') {
        res.status(400).json({ error: 'surface must be a string or null' });
        return;
      }
      updates.surface = body.surface === '' ? null : body.surface ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'num_courts')) {
      const numCourts = body.num_courts;
      if (numCourts !== null && numCourts !== undefined && (!Number.isInteger(numCourts) || numCourts < 0)) {
        res.status(400).json({ error: 'num_courts must be a non-negative integer or null' });
        return;
      }
      updates.num_courts = numCourts ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'lighting')) {
      if (body.lighting !== null && typeof body.lighting !== 'boolean') {
        res.status(400).json({ error: 'lighting must be a boolean or null' });
        return;
      }
      updates.lighting = body.lighting ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'access_type')) {
      if (body.access_type !== null && typeof body.access_type !== 'string') {
        res.status(400).json({ error: 'access_type must be a string or null' });
        return;
      }
      updates.access_type = body.access_type === '' ? null : body.access_type ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'amenities')) {
      if (!Array.isArray(body.amenities) || body.amenities.some((item) => typeof item !== 'string')) {
        res.status(400).json({ error: 'amenities must be an array of strings' });
        return;
      }
      updates.amenities = body.amenities;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'opening_hours')) {
      if (body.opening_hours !== null && typeof body.opening_hours !== 'string') {
        res.status(400).json({ error: 'opening_hours must be a string or null' });
        return;
      }
      updates.opening_hours = body.opening_hours === '' ? null : body.opening_hours ?? null;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields provided for update' });
      return;
    }

    updates.updated_at = new Date().toISOString();

    const { data: updatedCourt, error: updateError } = await supabaseAdmin
      .from('courts')
      .update(updates)
      .eq('id', courtId)
      .select('*')
      .single();

    if (updateError || !updatedCourt) {
      res.status(500).json({ error: updateError?.message || 'Failed to update court details' });
      return;
    }

    res.json({ court: updatedCourt });
  } catch (error) {
    console.error('Court details update error:', error);
    res.status(500).json({ error: 'Failed to update court details' });
  }
});

export default router;
