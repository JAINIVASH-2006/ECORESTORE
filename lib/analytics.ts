import type { Ranked, Site, Weights } from './ecology';

export const ecologicalFeatures = [
  'vegetation_pct',
  'soil_health',
  'water_stress',
  'biodiversity',
  'erosion_risk',
] as const;

export type ClusterSummary = {
  id: string;
  size: number;
  median: Record<(typeof ecologicalFeatures)[number], number>;
  description: string;
};

export type ClusterResult = {
  status: 'ready' | 'unavailable';
  reason?: string;
  algorithm: 'K-means';
  seed: number;
  trainingSampleCount: number;
  silhouette?: number;
  membership: Record<string, string>;
  clusters: ClusterSummary[];
};

export type AnomalyResult = {
  recordId: string;
  score: number;
  unusual: boolean;
  values: Record<string, number>;
  peerMedian: Record<string, number>;
  status: 'unusual' | 'within-range' | 'insufficient-peers';
};

export type SensitivityResult = {
  recordId: string;
  typicalRank: number;
  minimumRank: number;
  maximumRank: number;
  topFrequency: number;
};

const getProvenance = (site: Site) => site.provenance_type ?? site.data_status ?? 'unknown';
const getSiteIdentity = (site: Site) => site.site_id ?? site.id;
const vectors = (sites: Site[]) => sites.map(site => ecologicalFeatures.map(key => site[key]));
const euclidean = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0));

export function latestSiteProfiles(sites: Site[]) {
  const latestBySite = new Map<string, Site>();
  for (const site of sites) {
    const identity = getSiteIdentity(site);
    const current = latestBySite.get(identity);
    if (!current || site.observed_at > current.observed_at || (site.observed_at === current.observed_at && site.id < current.id)) {
      latestBySite.set(identity, site);
    }
  }
  return [...latestBySite.values()];
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function standardize(rows: number[][]) {
  const means = rows[0].map((_, column) => rows.reduce((sum, row) => sum + row[column], 0) / rows.length);
  const scales = means.map((_, column) => {
    const variance = rows.reduce((sum, row) => sum + (row[column] - means[column]) ** 2, 0) / rows.length;
    return Math.sqrt(variance);
  });
  return rows.map(row => row.map((value, column) => scales[column] ? (value - means[column]) / scales[column] : 0));
}

function fitKMeans(rows: number[][], k: number, seed: number) {
  const random = seededRandom(seed);
  let best: { labels: number[]; centers: number[][]; inertia: number } | undefined;

  for (let restart = 0; restart < 4; restart++) {
    const centers = [rows[Math.floor(random() * rows.length)]];
    while (centers.length < k) {
      const distances = rows.map(row => Math.min(...centers.map(center => euclidean(row, center) ** 2)));
      const total = distances.reduce((sum, value) => sum + value, 0);
      if (total === 0) break;
      let target = random() * total;
      let selected = 0;
      for (let i = 0; i < distances.length; i++) {
        target -= distances[i];
        if (target <= 0) {
          selected = i;
          break;
        }
      }
      centers.push(rows[selected]);
    }
    if (centers.length !== k) continue;

    let labels = rows.map(() => -1);
    for (let iteration = 0; iteration < 100; iteration++) {
      const nextLabels = rows.map(row => {
        let nearest = 0;
        let distance = Number.POSITIVE_INFINITY;
        centers.forEach((center, index) => {
          const candidate = euclidean(row, center);
          if (candidate < distance) {
            nearest = index;
            distance = candidate;
          }
        });
        return nearest;
      });
      const nextCenters = centers.map((center, index) => {
        const members = rows.filter((_, rowIndex) => nextLabels[rowIndex] === index);
        return members.length
          ? center.map((_, column) => members.reduce((sum, row) => sum + row[column], 0) / members.length)
          : center;
      });
      const unchanged = nextLabels.every((label, index) => label === labels[index]);
      labels = nextLabels;
      nextCenters.forEach((center, index) => { centers[index] = center; });
      if (unchanged) break;
    }
    const inertia = rows.reduce((sum, row, index) => sum + euclidean(row, centers[labels[index]]) ** 2, 0);
    if (!best || inertia < best.inertia) best = { labels, centers, inertia };
  }
  return best;
}

function silhouetteScore(rows: number[][], labels: number[]) {
  const clusterIds = [...new Set(labels)];
  if (clusterIds.length < 2 || labels.length < 3) return undefined;
  const sampleSize = Math.min(200, rows.length);
  const stride = rows.length / sampleSize;
  const sampleIndices = Array.from({ length: sampleSize }, (_, i) => Math.floor(i * stride));
  const scores = sampleIndices.map(index => {
    const same = rows.map((row, candidate) => candidate !== index && labels[candidate] === labels[index] ? euclidean(rows[index], row) : -1).filter(distance => distance >= 0);
    if (same.length === 0) return 0;
    const ownDistance = same.reduce((sum, value) => sum + value, 0) / same.length;
    const otherDistances = clusterIds.filter(id => id !== labels[index]).map(id => {
      const distances = rows.filter((_, candidate) => labels[candidate] === id).map(row => euclidean(rows[index], row));
      return distances.length ? distances.reduce((sum, value) => sum + value, 0) / distances.length : Number.POSITIVE_INFINITY;
    });
    const peerDistance = Math.min(...otherDistances);
    return Math.max(ownDistance, peerDistance) ? (peerDistance - ownDistance) / Math.max(ownDistance, peerDistance) : 0;
  });
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

export function clusterEcologicalProfiles(sites: Site[], seed = 42): ClusterResult {
  const base = { algorithm: 'K-means' as const, seed, trainingSampleCount: 0, membership: {}, clusters: [] };
  const profiles = latestSiteProfiles(sites);
  if (profiles.length < 3) return { ...base, status: 'unavailable', reason: 'At least three independent sites with complete latest observations are required.' };
  if (profiles.some(site => ecologicalFeatures.some(key => !Number.isFinite(site[key])))) {
    return { ...base, status: 'unavailable', reason: 'Clustering requires complete numeric indicator values; missing values are not imputed.' };
  }

  const raw = vectors(profiles);
  const standardized = standardize(raw);
  if (standardized.every(row => row.every(value => value === 0))) {
    return { ...base, status: 'unavailable', reason: 'All selected ecological indicator profiles are identical.' };
  }

  const step = Math.max(1, Math.ceil(standardized.length / 1000));
  const trainingRows = standardized.filter((_, index) => index % step === 0).slice(0, 1000);
  const candidates: { k: number; fit: NonNullable<ReturnType<typeof fitKMeans>>; silhouette: number }[] = [];
  for (let k = 2; k <= Math.min(5, trainingRows.length - 1); k++) {
    const fit = fitKMeans(trainingRows, k, seed + k);
    if (!fit || new Set(fit.labels).size < 2) continue;
    const silhouette = silhouetteScore(trainingRows, fit.labels);
    if (silhouette !== undefined) candidates.push({ k, fit, silhouette });
  }
  if (candidates.length === 0) return { ...base, status: 'unavailable', reason: 'No valid partition could be formed from these indicator profiles.' };

  const best = candidates.sort((a, b) => b.silhouette - a.silhouette)[0];
  const groups = [...new Set(best.fit.labels)].sort((a, b) => a - b);
  const labels = standardized.map(row => {
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    best.fit.centers.forEach((center, index) => {
      const candidate = euclidean(row, center);
      if (candidate < distance) {
        nearest = index;
        distance = candidate;
      }
    });
    return nearest;
  });
  const membership: Record<string, string> = {};
  const clusters = groups.map((group, index) => {
    const members = profiles.map((site, rowIndex) => ({ site, rowIndex })).filter(item => labels[item.rowIndex] === group);
    const memberIdentities = new Set(members.map(({ site }) => getSiteIdentity(site)));
    sites.filter(site => memberIdentities.has(getSiteIdentity(site))).forEach(site => { membership[site.id] = `C${index + 1}`; });
    const medianValues = Object.fromEntries(ecologicalFeatures.map((feature, column) => [
      feature,
      median(members.map(({ rowIndex }) => raw[rowIndex][column])),
    ])) as ClusterSummary['median'];
    const dominant = [
      { key: 'vegetation cover', value: 100 - medianValues.vegetation_pct },
      { key: 'soil-health deficit', value: 100 - medianValues.soil_health },
      { key: 'water stress', value: medianValues.water_stress },
      { key: 'biodiversity deficit', value: 100 - medianValues.biodiversity },
      { key: 'erosion risk', value: medianValues.erosion_risk },
    ].sort((a, b) => b.value - a.value)[0];
    return { id: `C${index + 1}`, size: members.length, median: medianValues, description: `Highest median pressure indicator: ${dominant.key} (${Math.round(dominant.value)}/100).` };
  });
  return { ...base, status: 'ready', trainingSampleCount: trainingRows.length, silhouette: best.silhouette, membership, clusters };
}

export function assessAnomalies(sites: Site[]): AnomalyResult[] {
  const profiles = latestSiteProfiles(sites);
  if (profiles.length < 4) {
    return sites.map(site => ({ recordId: site.id, score: 0, unusual: false, values: {}, peerMedian: {}, status: 'insufficient-peers' }));
  }
  const medians = Object.fromEntries(ecologicalFeatures.map(key => [key, median(profiles.map(site => site[key]))])) as Record<(typeof ecologicalFeatures)[number], number>;
  const mads = Object.fromEntries(ecologicalFeatures.map(key => [key, median(profiles.map(site => Math.abs(site[key] - medians[key])))])) as Record<(typeof ecologicalFeatures)[number], number>;
  return sites.map(site => {
    const values: Record<string, number> = {};
    let largest = 0;
    for (const key of ecologicalFeatures) {
      const deviation = Math.abs(site[key] - medians[key]);
      const robustScore = mads[key] ? deviation / (1.4826 * mads[key]) : deviation === 0 ? 0 : Number.POSITIVE_INFINITY;
      values[key] = site[key];
      largest = Math.max(largest, robustScore);
    }
    const score = Number.isFinite(largest) ? Number(largest.toFixed(2)) : 99;
    const unusual = largest >= 2.5;
    const status: AnomalyResult['status'] = unusual ? 'unusual' : 'within-range';
    return {
      recordId: site.id,
      score,
      unusual,
      values,
      peerMedian: { ...medians },
      status,
    };
  }).sort((a, b) => b.score - a.score);
}

export function getDataReadiness(sites: Site[]) {
  const fields = [...ecologicalFeatures, 'observed_at', 'site_id', 'observation_id', 'source', 'units', 'measurement_method', 'provenance_type'] as const;
  const missingness = Object.fromEntries(fields.map(field => [
    field,
    sites.filter(site => {
      const value = field === 'site_id' ? getSiteIdentity(site)
        : field === 'observation_id' ? site.observation_id ?? site.id
          : field === 'provenance_type' ? getProvenance(site)
            : site[field];
      return value === undefined || value === null || value === '';
    }).length,
  ]));
  const provenanceCounts = sites.reduce<Record<string, number>>((counts, site) => {
    const provenance = getProvenance(site);
    counts[provenance] = (counts[provenance] ?? 0) + 1;
    return counts;
  }, {});
  const realLabeledRecords = sites.filter(site =>
    getProvenance(site) === 'observed' &&
    site.reviewer_status === 'accepted' &&
    Number.isFinite(site.reviewed_priority_score),
  );
  const independentLabeledSites = new Set(realLabeledRecords.map(getSiteIdentity)).size;
  return {
    recordCount: sites.length,
    independentSiteCount: new Set(sites.map(getSiteIdentity)).size,
    missingness,
    provenanceCounts,
    labeledRecordCount: realLabeledRecords.length,
    independentLabeledSites,
    supervisedReady: independentLabeledSites >= 20,
    supervisedReason: independentLabeledSites >= 20
      ? 'Reviewed observed labels meet the minimum initial group count for a benchmark review.'
      : `Insufficient reviewed priority labels: ${independentLabeledSites} independent observed sites; at least 20 are required before benchmark design review.`,
  };
}

export function calculateWeightSensitivity(
  rows: Ranked[],
  baseWeights: Weights,
  options: { samples?: number; spread?: number; seed?: number; topCount?: number } = {},
): SensitivityResult[] {
  const samples = options.samples ?? 120;
  const spread = options.spread ?? 0.1;
  const topCount = Math.max(1, Math.min(rows.length, options.topCount ?? Math.ceil(rows.length * 0.2)));
  const weightValues = Object.values(baseWeights);
  if (weightValues.some(value => !Number.isFinite(value) || value < 0 || value > 100) || weightValues.every(value => value === 0)) {
    throw new Error('Sensitivity weights must be finite, within 0–100, and include a positive value.');
  }
  if (!rows.length) return [];
  if (!Number.isInteger(samples) || samples < 1 || samples > 1000 || !Number.isFinite(spread) || spread < 0 || spread > 0.5) {
    throw new Error('Sensitivity analysis requires sites, 1–1,000 samples, and a spread from 0 to 0.5.');
  }
  const random = seededRandom(options.seed ?? 42);
  const ranks = new Map(rows.map(row => [row.id, [] as number[]]));
  const features = Object.keys(baseWeights) as (keyof Weights)[];

  for (let sample = 0; sample < samples; sample++) {
    const perturbed = Object.fromEntries(features.map(key => [
      key,
      Math.max(0, baseWeights[key] + (random() * 2 - 1) * 100 * spread),
    ])) as Weights;
    if (Object.values(perturbed).every(value => value === 0)) perturbed.vegetation = 1;
    const sum = Object.values(perturbed).reduce((total, value) => total + value, 0);
    const normalized = Object.fromEntries(features.map(key => [key, perturbed[key] / sum * 100])) as Weights;
    const ordering = [...rows].map(row => ({ id: row.id, score: calculateRuleScore(row, normalized) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    ordering.forEach((row, index) => ranks.get(row.id)?.push(index + 1));
  }

  return rows.map(row => {
    const siteRanks = ranks.get(row.id) ?? [];
    return {
      recordId: row.id,
      typicalRank: median(siteRanks),
      minimumRank: Math.min(...siteRanks),
      maximumRank: Math.max(...siteRanks),
      topFrequency: Number((siteRanks.filter(rank => rank <= topCount).length / samples * 100).toFixed(1)),
    };
  }).sort((a, b) => a.typicalRank - b.typicalRank);
}

function calculateRuleScore(site: Site, weights: Weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const factors = [100 - site.vegetation_pct, 100 - site.soil_health, site.water_stress, 100 - site.biodiversity, site.erosion_risk];
  const values = [weights.vegetation, weights.soil, weights.water, weights.biodiversity, weights.erosion];
  return Math.round(factors.reduce((score, value, index) => score + value * values[index] / total, 0));
}

export function uniqueSiteArea(sites: Site[]) {
  return latestSiteProfiles(sites).reduce((sum, site) => sum + site.area_ha, 0);
}

export function getProvenanceCounts(sites: Site[]) {
  return sites.reduce<Record<string, number>>((counts, site) => {
    const provenance = getProvenance(site);
    counts[provenance] = (counts[provenance] ?? 0) + 1;
    return counts;
  }, {});
}
