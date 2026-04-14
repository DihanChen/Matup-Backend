const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'MatUp/1.0 (court-import)';
const RATE_LIMIT_MS = 1100; // Nominatim requires max 1 req/sec

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();

  return fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });
}

export type NominatimAddress = {
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  country?: string;
};

export type ReverseGeocodeResult = {
  displayName: string;
  address: NominatimAddress;
};

export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<ReverseGeocodeResult | null> {
  try {
    const url = `${NOMINATIM_BASE}/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1&zoom=18`;
    const response = await rateLimitedFetch(url);

    if (!response.ok) return null;

    const data = (await response.json()) as {
      display_name?: string;
      address?: Record<string, string>;
    };

    if (!data.address) return null;

    return {
      displayName: data.display_name || '',
      address: {
        road: data.address.road,
        neighbourhood: data.address.neighbourhood,
        suburb: data.address.suburb,
        city: data.address.city,
        town: data.address.town,
        village: data.address.village,
        state: data.address.state,
        country: data.address.country,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Generate a descriptive court name from available data.
 *
 * Priority:
 * 1. OSM name tag (already handled before calling this)
 * 2. Operator tag → "{Sport} Courts at {Operator}"
 * 3. Street name from geocoding → "{Sport} Courts on {Street}"
 * 4. Suburb/neighbourhood → "{Sport} Courts, {Area}"
 * 5. City/town → "{Sport} Courts, {City}"
 * 6. Fallback → "{Sport} Court"
 */
export function generateCourtName(
  sportTypes: string[],
  operator: string | null,
  geocoded: NominatimAddress | null
): string {
  const sport = formatSportLabel(sportTypes);

  if (operator && operator.trim()) {
    return `${sport} Courts at ${operator.trim()}`;
  }

  if (geocoded) {
    if (geocoded.road) {
      return `${sport} Courts on ${geocoded.road}`;
    }

    const area =
      geocoded.neighbourhood || geocoded.suburb;
    if (area) {
      return `${sport} Courts, ${area}`;
    }

    const city = geocoded.city || geocoded.town || geocoded.village;
    if (city) {
      return `${sport} Courts, ${city}`;
    }
  }

  return `${sport} Court`;
}

/**
 * Build a real street address from geocoded data.
 */
export function buildGeocodedAddress(geocoded: NominatimAddress | null): string | null {
  if (!geocoded) return null;

  const parts: string[] = [];

  if (geocoded.road) parts.push(geocoded.road);

  const area = geocoded.neighbourhood || geocoded.suburb;
  if (area) parts.push(area);

  const city = geocoded.city || geocoded.town || geocoded.village;
  if (city) parts.push(city);

  if (geocoded.state) parts.push(geocoded.state);

  return parts.length > 0 ? parts.join(', ') : null;
}

function formatSportLabel(sportTypes: string[]): string {
  if (sportTypes.length === 0) return 'Public';

  const primary = sportTypes[0];
  return primary.charAt(0).toUpperCase() + primary.slice(1);
}
