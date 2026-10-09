import { z } from 'zod';

export const siteSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  district: z.string().min(1).max(80),
  ecosystem: z.enum(['Forest', 'Wetland', 'Grassland', 'Riverbank', 'Coastal']),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  area_ha: z.coerce.number().positive().max(1000000),
  vegetation_pct: z.coerce.number().min(0).max(100),
  soil_health: z.coerce.number().min(0).max(100),
  water_stress: z.coerce.number().min(0).max(100),
  biodiversity: z.coerce.number().min(0).max(100),
  erosion_risk: z.coerce.number().min(0).max(100),
  observed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Invalid date'),
  site_id: z.string().min(1).max(80).optional(),
  observation_id: z.string().min(1).max(80).optional(),
  source: z.string().max(240).optional(),
  units: z.string().max(120).optional(),
  measurement_method: z.string().max(240).optional(),
  provenance_type: z.enum(['observed', 'derived', 'synthetic', 'unknown']).optional(),
  reviewer_status: z.enum(['unreviewed', 'accepted', 'corrected', 'excluded']).optional(),
  reviewed_priority_score: z.coerce.number().min(0).max(100).optional(),
  expert_priority: z.string().max(120).optional(),
  region_group: z.string().max(120).optional(),
  label_source: z.string().max(120).optional(),
  location_name: z.string().max(160).optional(),
  state: z.string().max(120).optional(),
  coordinate_source: z.string().max(120).optional(),
  data_status: z.enum(['observed', 'derived', 'synthetic', 'unknown']).default('observed'),
}).passthrough();

export type Site = z.infer<typeof siteSchema>;
export type Weights = { vegetation: number; soil: number; water: number; biodiversity: number; erosion: number };
export const defaults: Weights = { vegetation: 30, soil: 20, water: 15, biodiversity: 15, erosion: 20 };
export const weightsSchema = z.object({
  vegetation: z.number().min(0).max(100),
  soil: z.number().min(0).max(100),
  water: z.number().min(0).max(100),
  biodiversity: z.number().min(0).max(100),
  erosion: z.number().min(0).max(100),
}).refine(w => Object.values(w).reduce((a, b) => a + b, 0) > 0, 'Set at least one positive weight');

export const canonicalAliases: Record<string, string> = {
  sample_id: 'id',
  sample: 'observation_id',
  survey_id: 'observation_id',
  location_name: 'name',
  site_name: 'name',
  lat: 'latitude',
  lon: 'longitude',
  sample_date: 'observed_at',
  survey_date: 'observed_at',
  area_km2: 'area_ha',
  area_sq_km: 'area_ha',
  vegetation: 'vegetation_pct',
  soil: 'soil_health',
  water: 'water_stress',
  biodiversity_index: 'biodiversity',
  erosion_index: 'erosion_risk',
  watershed: 'district',
};

export function isCsvFile(file: { name: string; type: string }) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return name.endsWith('.csv') || type === 'text/csv' || type === 'application/csv';
}

export function normalizeHeader(key: string) {
  return key.trim().toLowerCase().replace(/^\ufeff/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function toText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function normalizeImportRow(raw: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {};
  const seen = new Set<string>();
  const areaKm2Value = Object.entries(raw).find(([key]) => {
    const normalizedKey = normalizeHeader(key);
    return normalizedKey === 'area_km2' || normalizedKey === 'area_sq_km';
  })?.[1];

  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = normalizeHeader(key);
    const canonicalKey = canonicalAliases[normalizedKey] ?? normalizedKey;
    if (!normalizedKey || seen.has(canonicalKey)) continue;

    if (normalizedKey === 'area_ha' && (value === undefined || value === null || String(value).trim() === '') && areaKm2Value !== undefined && areaKm2Value !== null && String(areaKm2Value).trim() !== '') {
      continue;
    }

    if (normalizedKey === 'area_km2' || normalizedKey === 'area_sq_km') {
      continue;
    }

    seen.add(canonicalKey);
    normalized[canonicalKey] = value;
    if (normalizedKey === 'location_name' && !normalized.name && value !== undefined && value !== null) {
      normalized.name = value;
    }
  }

  if (areaKm2Value !== undefined && areaKm2Value !== null && String(areaKm2Value).trim() !== '') {
    const converted = Number(areaKm2Value) * 100;
    if (!Number.isNaN(converted)) {
      normalized.area_ha = converted;
    }
  }

  if (normalized.location_name && !normalized.name) {
    normalized.name = normalized.location_name;
  }

  if (normalized.name && !normalized.location_name) {
    normalized.location_name = normalized.name;
  }

  if (normalized.data_status === undefined) {
    normalized.data_status = 'unknown';
  }
  normalized.site_id ??= normalized.id;
  normalized.observation_id ??= normalized.id;
  normalized.provenance_type ??= normalized.data_status;
  normalized.reviewer_status ??= 'unreviewed';

  if (normalized.observed_at && typeof normalized.observed_at === 'string') {
    const dateValue = normalized.observed_at.trim();
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(dateValue)) {
      normalized.observed_at = dateValue;
    }
  }

  return normalized;
}

export function analyze(s: Site, w: Weights = defaults) {
  const total = Object.values(w).reduce((a, b) => a + b, 0); if (!total) throw new Error('At least one weight must be positive');
  const factors = { vegetation: 100 - s.vegetation_pct, soil: 100 - s.soil_health, water: s.water_stress, biodiversity: 100 - s.biodiversity, erosion: s.erosion_risk };
  const breakdown = Object.entries(factors).map(([key, value]) => ({ key, value, contribution: value * w[key as keyof Weights] / total }));
  const score = Math.round(breakdown.reduce((a, b) => a + b.contribution, 0));
  const action = s.ecosystem === 'Wetland' ? 'Restore wetland hydrology' : s.ecosystem === 'Coastal' ? 'Assess coastal habitat recovery' : s.erosion_risk >= 65 ? 'Stabilize soil and restore ground cover' : s.ecosystem === 'Grassland' ? 'Restore native grassland' : s.ecosystem === 'Riverbank' ? 'Restore riparian vegetation' : 'Assist native regeneration';
  const rate = s.ecosystem === 'Wetland' ? 65000 : s.ecosystem === 'Coastal' ? 85000 : s.ecosystem === 'Grassland' ? 25000 : 45000;
  const actionRationale = s.ecosystem === 'Wetland'
    ? 'The suggested action is habitat-specific and prioritizes hydrological assessment; confirm local hydrology and wetland reference conditions before intervention.'
    : s.ecosystem === 'Coastal'
      ? 'The suggested action is a coastal habitat assessment; confirm shoreline dynamics and local conditions before selecting an intervention.'
      : s.ecosystem === 'Grassland'
        ? 'The suggested action preserves grassland as its own ecosystem; low vegetation cover alone is not a reason to plant trees.'
        : s.ecosystem === 'Riverbank'
          ? 'The suggested action targets riparian vegetation; confirm bank condition, flow regime, and reference habitat before intervention.'
          : s.erosion_risk >= 65
            ? 'Elevated erosion risk contributes to this soil-stabilization suggestion; field-check erosion processes and habitat before implementation.'
            : 'The suggested action is a forest regeneration baseline; confirm reference habitat, land access, and natural regeneration potential in the field.';
  const fieldChecks = [
    'Confirm land tenure, access, permissions, and community participation.',
    'Verify the reference ecosystem and indicator measurement methods.',
    s.ecosystem === 'Wetland' ? 'Assess hydrology and seasonal water conditions.' :
      s.ecosystem === 'Coastal' ? 'Assess shoreline dynamics and coastal exposure.' :
        s.ecosystem === 'Riverbank' ? 'Assess bank stability and flow regime.' :
          s.ecosystem === 'Grassland' ? 'Confirm native grassland structure; do not presume afforestation.' :
            'Confirm forest reference condition and existing natural regeneration.',
  ];
  const maintenanceRequirements = [
    'Agree a locally appropriate maintenance schedule before work begins.',
    'Record maintenance activities, field conditions, and any intervention failures.',
    'Use the same documented methods for comparable follow-up observations.',
  ];
  const monitoringIndicators = [
    'Vegetation cover (%) using a documented field method.',
    'Soil-health and biodiversity indices only when the same rubric is used.',
    'Water stress and erosion risk using consistent units and methods.',
  ];
  return {
    ...s,
    score,
    priority: score >= 65 ? 'High' : score >= 40 ? 'Moderate' : 'Low',
    action,
    actionRationale,
    fieldChecks,
    maintenanceRequirements,
    monitoringIndicators,
    costRatePerHa: rate,
    cost: Math.round(s.area_ha * rate),
    breakdown,
  };
}

export type Ranked = ReturnType<typeof analyze>;
export type Plan = {
  id: string;
  siteId: string;
  siteName: string;
  action: string;
  actionRationale?: string;
  fieldChecks?: string[];
  maintenanceRequirements?: string[];
  monitoringIndicators?: string[];
  costRatePerHa?: number;
  cost: number;
  status: 'Proposed' | 'In progress' | 'Completed';
  due: string;
  notes: string;
  created: string;
};
export type Observation = { id: string; siteId: string; date: string; vegetation: number; survival: number; notes: string };
export type Workspace = {
  sites: Site[];
  name: string;
  source: string;
  weights: Weights;
  plans: Plan[];
  observations: Observation[];
  reviews?: ReviewDecision[];
  weightScenarios?: WeightScenario[];
};

export type ImportIssue = {
  rowNumber: number;
  column: string;
  value: string;
  message: string;
};

export type ImportValidationReport = {
  valid: Site[];
  issues: ImportIssue[];
  acceptedCount: number;
  rejectedCount: number;
};

export type ReviewDecision = {
  recordId: string;
  status: 'accepted' | 'corrected' | 'excluded';
  reason: string;
  updatedAt: string;
  correctedField?: string;
  correctedValue?: number;
};

export type WeightScenario = {
  id: string;
  name: string;
  weights: Weights;
  createdAt: string;
};

const rows: [string, string, string, Site['ecosystem'], number, number, number, number, number, number, number, number][] = [
  ['TN-001', 'Pachamalai foothills', 'Perambalur', 'Forest', 11.28, 78.65, 24, 22, 32, 72, 30, 84], ['TN-002', 'Cauvery riparian belt', 'Karur', 'Riverbank', 10.96, 78.12, 18, 35, 40, 63, 38, 76], ['TN-003', 'Vellode wetland edge', 'Erode', 'Wetland', 11.26, 77.66, 32, 43, 48, 70, 45, 38], ['TN-004', 'Sirumalai buffer', 'Dindigul', 'Forest', 10.21, 77.99, 45, 51, 52, 42, 55, 61], ['TN-005', 'Pallikaranai fringe', 'Chennai', 'Wetland', 12.94, 80.21, 16, 20, 29, 81, 24, 45], ['TN-006', 'Point Calimere buffer', 'Nagapattinam', 'Coastal', 10.30, 79.82, 28, 49, 46, 62, 57, 55], ['TN-007', 'Kolli hills clearing', 'Namakkal', 'Grassland', 11.25, 78.34, 12, 62, 60, 35, 58, 40], ['TN-008', 'Vaigai river stretch', 'Madurai', 'Riverbank', 9.93, 78.13, 22, 28, 36, 78, 33, 72], ['TN-009', 'Sathyamangalam buffer', 'Erode', 'Forest', 11.51, 77.25, 54, 74, 71, 26, 72, 23], ['TN-010', 'Yercaud grassland', 'Salem', 'Grassland', 11.78, 78.21, 15, 67, 64, 30, 61, 31], ['TN-011', 'Pichavaram fringe', 'Cuddalore', 'Coastal', 11.43, 79.77, 36, 56, 58, 43, 64, 44], ['TN-012', 'Amaravathi catchment', 'Tiruppur', 'Riverbank', 10.42, 77.26, 20, 39, 44, 66, 40, 68]
];

export const sampleSites: Site[] = rows.map(([id, name, district, ecosystem, latitude, longitude, area_ha, vegetation_pct, soil_health, water_stress, biodiversity, erosion_risk]) => ({
  id, name, district, ecosystem, latitude, longitude, area_ha, vegetation_pct, soil_health, water_stress, biodiversity, erosion_risk, observed_at: '2026-09-20', data_status: 'synthetic', location_name: name,
  expert_priority: 'Synthetic demonstration priority',
  label_source: 'Synthetic demonstration data',
  state: 'Tamil Nadu',
  coordinate_source: 'Synthetic sample geometry',
}));

export const initialWorkspace: Workspace = { sites: sampleSites, name: 'Tamil Nadu · demonstration survey', source: 'Synthetic demonstration data — not field measurements', weights: defaults, plans: [], observations: [], reviews: [], weightScenarios: [] };
export const columns = Object.keys(sampleSites[0]);

function issueFromZod(rowNumber: number, raw: Record<string, unknown>, issue: { path: (string | number)[]; message: string }) {
  const path = issue.path.map(String).filter(Boolean).join('.') || 'record';
  const column = path.replace(/\.(\d+)$/, '[$1]');
  const offendingValue = path === 'record' ? JSON.stringify(raw) : toText(raw[path.split('.').at(0) ?? ''] ?? raw[column] ?? raw[path]);
  return { rowNumber, column, value: offendingValue, message: issue.message };
}

export function validateRows(rows: unknown[]) {
  if (rows.length === 0 || rows.length > 5000) throw new Error('Upload 1–5,000 rows.');
  const ids = new Set<string>();
  return rows.map((row, i) => {
    const raw = row as Record<string, unknown>;
    const normalized = normalizeImportRow(raw);
    for (const key of ['id', 'name', 'district', 'ecosystem', 'latitude', 'longitude', 'area_ha', 'vegetation_pct', 'soil_health', 'water_stress', 'biodiversity', 'erosion_risk', 'observed_at']) {
      const value = normalized[key];
      if (value === undefined || value === null || toText(value) === '') throw new Error(`Row ${i + 2}: ${key} is required.`);
    }
    const parsed = siteSchema.safeParse(normalized);
    if (!parsed.success) throw new Error(`Row ${i + 2}: ${parsed.error.issues.map(x => x.path.join('.') + ' ' + x.message).join('; ')}`);
    if (ids.has(parsed.data.id)) throw new Error(`Row ${i + 2}: duplicate id ${parsed.data.id}`);
    ids.add(parsed.data.id);
    return parsed.data;
  });
}

export function buildImportValidation(rows: unknown[]): ImportValidationReport {
  if (rows.length === 0 || rows.length > 5000) {
    throw new Error('Upload 1–5,000 rows.');
  }

  const valid: Site[] = [];
  const issues: ImportIssue[] = [];
  const seenIds = new Set<string>();
  const rejectedRows = new Set<number>();

  rows.forEach((row, index) => {
    const raw = row as Record<string, unknown>;
    const normalized = normalizeImportRow(raw);
    const requiredKeys = ['id', 'name', 'district', 'ecosystem', 'latitude', 'longitude', 'area_ha', 'vegetation_pct', 'soil_health', 'water_stress', 'biodiversity', 'erosion_risk', 'observed_at'];
    let rowRejected = false;

    for (const key of requiredKeys) {
      const value = normalized[key];
      if (value === undefined || value === null || toText(value) === '') {
        issues.push({ rowNumber: index + 2, column: key, value: toText(value), message: `${key} is required.` });
        rowRejected = true;
      }
    }

    if (rowRejected) {
      rejectedRows.add(index + 2);
      return;
    }

    const parsed = siteSchema.safeParse(normalized);
    if (!parsed.success) {
      rejectedRows.add(index + 2);
      for (const issue of parsed.error.issues) {
        const path = issue.path.map(String).join('.');
        issues.push({
          rowNumber: index + 2,
          column: path || 'record',
          value: toText(raw[path] ?? normalized[path] ?? raw[Object.keys(raw).find(k => normalizeHeader(k) === path) ?? '']),
          message: issue.message,
        });
      }
      return;
    }

    const site = parsed.data;
    if (seenIds.has(site.id)) {
      rejectedRows.add(index + 2);
      issues.push({ rowNumber: index + 2, column: 'id', value: String(site.id), message: `Duplicate record ID: ${site.id}` });
      return;
    }

    seenIds.add(site.id);
    valid.push(site);
  });

  return {
    valid,
    issues,
    acceptedCount: valid.length,
    rejectedCount: rejectedRows.size,
  };
}

export function budgetSelection(rows: Ranked[], budget: number) {
  let spent = 0;
  const selected: Ranked[] = [];
  for (const s of [...rows].sort((a, b) => b.score - a.score)) {
    if (spent + s.cost <= budget) {
      selected.push(s);
      spent += s.cost;
    }
  }
  return { selected, spent };
}
