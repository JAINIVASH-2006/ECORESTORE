import {
  assessAnomalies,
  calculateWeightSensitivity,
  clusterEcologicalProfiles,
  getDataReadiness,
  latestSiteProfiles,
} from '../../../lib/analytics';
import { analyze, validateRows, weightsSchema } from '../../../lib/ecology';

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 3_000_000) {
      return Response.json({ error: 'Dataset exceeds 3 MB.' }, { status: 413 });
    }
    const body = JSON.parse(text) as { sites?: unknown; weights?: unknown; excludedRecordIds?: unknown };
    if (!Array.isArray(body.sites)) {
      return Response.json({ error: 'Sites must be an array.' }, { status: 400 });
    }

    const sites = validateRows(body.sites);
    const weights = weightsSchema.parse(body.weights);
    const excludedRecordIds = body.excludedRecordIds === undefined
      ? []
      : Array.isArray(body.excludedRecordIds) && body.excludedRecordIds.every(id => typeof id === 'string')
        ? body.excludedRecordIds as string[]
        : (() => { throw new Error('excludedRecordIds must be an array of record IDs.'); })();
    const siteIds = new Set(sites.map(site => site.id));
    if (excludedRecordIds.some(id => !siteIds.has(id))) {
      return Response.json({ error: 'An excluded record ID is not present in this dataset.' }, { status: 400 });
    }
    const analysisSites = sites.filter(site => !excludedRecordIds.includes(site.id));
    const independentProfiles = latestSiteProfiles(analysisSites);
    const ranked = independentProfiles.map(site => analyze(site, weights));
    const versionInput = JSON.stringify([...sites].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0).map(site => Object.fromEntries(
      Object.entries(site).sort(([left], [right]) => left.localeCompare(right)),
    ))) + `|excluded:${[...excludedRecordIds].sort().join(',')}`;
    let hash = 2166136261;
    for (let i = 0; i < versionInput.length; i++) {
      hash = Math.imul(hash ^ versionInput.charCodeAt(i), 16777619);
    }

    return Response.json({
      datasetVersion: (hash >>> 0).toString(16).padStart(8, '0'),
      generatedAt: new Date().toISOString(),
      source: sites.some(site => (site.provenance_type ?? site.data_status) === 'synthetic')
        ? 'Includes synthetic records'
        : 'User-provided records; provenance is not independently verified',
      excludedRecordIds,
      readiness: getDataReadiness(analysisSites),
      clustering: clusterEcologicalProfiles(analysisSites),
      anomalies: assessAnomalies(analysisSites),
      sensitivity: ranked.length ? calculateWeightSensitivity(ranked, weights) : [],
      method: 'Rule-based deficit v1; unsupervised K-means profile grouping; robust median absolute deviation review',
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : 'Invalid analytics request.',
    }, { status: 400 });
  }
}
