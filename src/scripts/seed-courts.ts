import { importOsmCourtsForBounds, splitBoundsIntoTiles, type Bounds } from '../services/court-import.service';

type CliOptions = {
  bbox?: Bounds;
  query?: string;
  maptilerKey?: string;
  tileSpan: number;
  dryRun: boolean;
};

type GeocodeFeature = {
  place_name?: string;
  text?: string;
  center?: [number, number];
  bbox?: [number, number, number, number];
};

type GeocodeResponse = {
  features?: GeocodeFeature[];
};

function printUsage(): void {
  console.log(`
Usage:
  pnpm seed:courts --bbox <south,west,north,east>
  pnpm seed:courts --query "Halifax, Nova Scotia" --maptiler-key <key>

Options:
  --bbox           Bounding box in south,west,north,east format
  --query          Place or city query to geocode with MapTiler
  --maptiler-key   MapTiler API key (or set MAPTILER_API_KEY in env)
  --tile-span      Max tile span in degrees for each Overpass request (default: 0.45)
  --dry-run        Fetch and count courts without persisting them
  --help           Show this message
`);
}

function parseBounds(raw: string): Bounds {
  const values = raw.split(',').map((part) => Number.parseFloat(part.trim()));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Expected --bbox in south,west,north,east format');
  }

  const [south, west, north, east] = values;
  if (north <= south || east <= west) {
    throw new Error('Bounding box coordinates are invalid');
  }

  return { south, west, north, east };
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    tileSpan: 0.45,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--bbox') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --bbox');
      }

      options.bbox = parseBounds(next);
      index += 1;
      continue;
    }

    if (arg === '--query') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --query');
      }

      options.query = next;
      index += 1;
      continue;
    }

    if (arg === '--maptiler-key') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --maptiler-key');
      }

      options.maptilerKey = next;
      index += 1;
      continue;
    }

    if (arg === '--tile-span') {
      const next = argv[index + 1];
      const parsed = next ? Number.parseFloat(next) : Number.NaN;
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Missing or invalid value for --tile-span');
      }

      options.tileSpan = parsed;
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--help') {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.bbox && !options.query) {
    throw new Error('Provide either --bbox or --query');
  }

  return options;
}

function formatBounds(bounds: Bounds): string {
  return [
    bounds.south.toFixed(4),
    bounds.west.toFixed(4),
    bounds.north.toFixed(4),
    bounds.east.toFixed(4),
  ].join(',');
}

async function geocodeQueryToBounds(query: string, explicitKey?: string): Promise<{ bounds: Bounds; label: string }> {
  const key = explicitKey || process.env.MAPTILER_API_KEY || process.env.MAPTILER_KEY || '';
  if (!key) {
    throw new Error('MapTiler API key required for --query. Use --maptiler-key or set MAPTILER_API_KEY');
  }

  const endpoint =
    `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?` +
    new URLSearchParams({
      key,
      limit: '1',
      // MapTiler does not support a "city" type; use the closest admin/place buckets.
      types: 'municipality,locality,county,region,place',
    }).toString();

  const response = await fetch(endpoint);
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `MapTiler geocoding failed: ${response.status}${responseText ? ` - ${responseText}` : ''}`
    );
  }

  const payload = (await response.json()) as GeocodeResponse;
  const feature = payload.features?.[0];
  if (!feature) {
    throw new Error(`No geocoding result found for "${query}"`);
  }

  if (feature.bbox) {
    const [west, south, east, north] = feature.bbox;
    return {
      bounds: { south, west, north, east },
      label: feature.place_name || feature.text || query,
    };
  }

  if (feature.center) {
    const [longitude, latitude] = feature.center;
    const radius = 0.08;
    return {
      bounds: {
        south: latitude - radius,
        west: longitude - radius,
        north: latitude + radius,
        east: longitude + radius,
      },
      label: feature.place_name || feature.text || query,
    };
  }

  throw new Error(`Geocoding result for "${query}" did not contain bounds or center`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const source =
    options.bbox
      ? { bounds: options.bbox, label: 'manual bbox' }
      : await geocodeQueryToBounds(options.query as string, options.maptilerKey);

  const tiles = splitBoundsIntoTiles(source.bounds, options.tileSpan);
  const aggregate = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    refreshed: 0,
  };

  console.log(`Seeding courts for ${source.label}`);
  console.log(`Bounds: ${formatBounds(source.bounds)}`);
  console.log(`Tiles: ${tiles.length} (tile span ${options.tileSpan.toFixed(2)} degrees)`);
  console.log(options.dryRun ? 'Mode: dry-run' : 'Mode: persist');

  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index];
    const { courts, persisted } = await importOsmCourtsForBounds(
      tile.south,
      tile.west,
      tile.north,
      tile.east,
      { persist: !options.dryRun }
    );

    aggregate.fetched += courts.length;
    aggregate.inserted += persisted?.inserted || 0;
    aggregate.updated += persisted?.updated || 0;
    aggregate.refreshed += persisted?.refreshed || 0;

    console.log(
      `[${index + 1}/${tiles.length}] ${formatBounds(tile)} -> fetched=${courts.length}` +
      `${options.dryRun ? '' : ` inserted=${persisted?.inserted || 0} updated=${persisted?.updated || 0} refreshed=${persisted?.refreshed || 0}`}`
    );
  }

  console.log('Done.');
  console.log(`Fetched: ${aggregate.fetched}`);
  if (!options.dryRun) {
    console.log(`Inserted: ${aggregate.inserted}`);
    console.log(`Updated: ${aggregate.updated}`);
    console.log(`Refreshed: ${aggregate.refreshed}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Court seed failed');
  process.exit(1);
});
