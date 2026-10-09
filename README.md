# EcoRestore — Ecological Restoration Planning & Analytics

An EVS research/demo decision-support application for moving from environmental observations to explainable priorities, restoration plans, data-quality review and field monitoring. The active priority score is a transparent rule-based baseline, not trained AI.

## What works

- Responsive workspace: overview, site explorer, datasets, priority analysis, analytics, restoration plans, monitoring, connections.
- Leaflet/OpenStreetMap map with selectable site markers, search and ecosystem filters.
- CSV ingestion: quoted fields, header normalization, required fields, numeric ranges, unique IDs and calendar-date validation; up to 5,000 rows / 3 MB.
- One active dataset drives every ranking, map, statistic, intervention suggestion and budget scenario. Import replaces the old dataset and clears old plans/observations after explicit confirmation in the import dialog.
- Explainable weighted ecological-deficit scoring with normalized, adjustable weights and per-site contributions.
- Analytics API: provenance and missingness readiness, ecological-profile K-means clustering, robust median/MAD unusual-record review, and deterministic weight-sensitivity rankings. Clustering and sensitivity use each site's latest observation, so repeated observations do not inflate independent-site counts.
- Review actions (accept, correct, exclude) with required reasons; exclusions remain recorded and are applied to subsequent analytics runs without deleting records.
- Named weight scenarios and side-by-side baseline/current/saved-scenario ranking comparisons.
- JSON analysis report export with dataset version/provenance, factor contributions, review decisions, intervention and monitoring summaries, budget assumptions, and limitations.
- Budget scenarios, illustrative per-hectare rates, habitat-specific intervention rationale, field checks, maintenance guidance, estimated plan costs, and monitoring indicators.
- Live Open-Meteo model weather and 7-day forecast by selected site coordinates. Includes provenance, provider time, retrieval time, timeout and no synthetic fallback. Fetch on demand; HTTP caching up to 15 minutes.
- Field observations with vegetation cover, plant survival, notes and baseline comparison.
- CSV exports with spreadsheet formula escaping; complete JSON backup and restore; browser persistence.
- Supabase email/password authentication and private cloud snapshots implemented, but NOT connected to a live project in this delivery. Database SQL includes row-level security and immutable snapshots.

## Stack and connectivity

| Layer | Implementation | Connection |
|---|---|---|
| Design | Editable Figma dashboard | https://www.figma.com/design/ZCgGtHpsxBzVFbPM73SIEg |
| Frontend | React 19 + TypeScript | Same-origin backend API; Supabase JS client |
| Application runtime | Vinext / Vite, Next-compatible App Router | Cloudflare Workers deployment |
| Validation / decision engine | Zod + TypeScript | POST /api/analyze |
| Analytics | TypeScript in the application runtime | POST /api/analytics |
| Maps | Leaflet 1.9.4 | OpenStreetMap tile service |
| CSV | Papa Parse 5.7.0 | Validate in browser and backend |
| Cloud data | Supabase PostgreSQL + Auth | @supabase/supabase-js 2.117.2, RLS |
| Weather | Open-Meteo | GET /api/weather?lat=...&lon=... |
| Charts | CSS data bars | Computed from current dataset or provider response |

Flow: CSV → client/server validation → versioned rule-based score → dashboard/map/plans/monitoring; analytics requests additionally run provenance readiness, clustering, anomaly review and ranking sensitivity through the same-origin `/api/analytics` route. Weather flows through its server proxy and remains separate from baseline ecological indices.

The current analytics methods are implemented in TypeScript in `lib/analytics.ts` and execute in the existing Cloudflare-compatible application runtime. No Python runtime or separate service was added: the immediately usable analyses do not need the complexity of a second deployment, and no supervised training service is yet configured. This preserves the core application if the optional analytics request fails.

## Project structure

- `app/page.tsx` — dashboard shell, workspace persistence, import/export, plans, monitoring and connections.
- `app/api/analyze/route.ts` — server-side CSV record validation and weighted rule score.
- `app/api/analytics/route.ts` — readiness, K-means profile clustering, unusual-record ranking, sensitivity output and dataset version.
- `app/api/weather/route.ts` — separate Open-Meteo provider proxy.
- `components/AnalyticsWorkspace.tsx` — Data Quality, Clustering, Reviews, Model Lab and Sensitivity screens.
- `components/SiteMap.tsx` — map and priority/profile-group tooltips.
- `lib/ecology.ts` — schemas, import normalization, baseline score, plans and workspace records.
- `lib/analytics.ts` — deterministic analytical methods and data-readiness gates.
- `database/schema.sql` — existing private, immutable Supabase workspace snapshots; no relational analytics/model tables were added.
- `tests/core.mjs` — validation, score, grouping, unusualness, readiness and sensitivity regression checks.

## Run locally

Requirements: Node.js 22.13+ and the pnpm version declared in package.json. From this directory:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Use the URL printed by the development server. On Windows, run these commands in the project directory in PowerShell. Do not include node_modules when copying the project.

## Connect Supabase

1. Select or create the intended Supabase project and ensure it is active. The connected account contained an inactive project named `JAINIVASH-2006's Project`; it was not changed because its association with this EVS project was unverified.
2. Run `database/schema.sql` once in that project's SQL editor.
3. Copy `.env.example` to `.env.local`, supply the project URL and a **publishable** key, and restart development. In hosted deployment, set the same two environment variables through the hosting provider and redeploy.
4. Enable email/password sign-in. Configure confirmation URLs and SMTP if required by your chosen email flow.
5. Open Connections, create an account/sign in, then Save cloud snapshot. Load snapshots on a second device to verify persistence.
6. Verify isolation with two accounts: each should see only its own snapshots. Do not use service-role/secret keys in the frontend or public config endpoint.

The `/api/config` route exposes only SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, which are intended for browser use. Authorization is enforced by database RLS. Cloud snapshots are immutable; there is no UPDATE permission. Schema SQL is delivered as a setup script rather than a claimed applied migration.

## Required CSV schema

`id,name,district,ecosystem,latitude,longitude,area_ha,vegetation_pct,soil_health,water_stress,biodiversity,erosion_risk,observed_at`

- ecosystem: Forest, Wetland, Grassland, Riverbank or Coastal.
- area_ha: positive hectares; coordinates: decimal degrees.
- vegetation_pct: 0–100 percent vegetation coverage.
- soil_health and biodiversity: 0–100 indices, higher is healthier.
- water_stress and erosion_risk: 0–100 indices, higher is worse.
- observed_at: YYYY-MM-DD.
- Optional identity/provenance metadata: `site_id`, `observation_id`, `source`, `units`, `measurement_method`, `provenance_type`, and `reviewer_status`. Existing files remain compatible; absent provenance is normalized to `unknown`, not assumed real. `site_id` identifies the persistent place; `id` remains the unique row/record identifier for older files.
- The in-app sample download is synthetic, not a real-world dataset. Use a consistent documented survey rubric for all index fields.

## Analytics methods and prerequisites

- **Data Quality:** reports available records, independent site identities, indicator and metadata missingness, provenance counts, and the reason a supervised model is unavailable. Missing measurements are not imputed as zero.
- **Clustering:** standardized K-means on vegetation cover, soil health, water stress, biodiversity and erosion risk only. IDs, labels, names, coordinates and existing priority scores are excluded. Candidate `k` values are 2–5 where the record count permits; fixed seed 42, four initializations, up to 100 iterations, best silhouette selection. Large datasets use a deterministic, evenly spaced fit sample of at most 1,000 records; memberships and medians are then calculated for all active records. Clusters are exploratory profiles, not validated ecological classes.
- **Anomaly review:** schema/range checks reject invalid records at import. A deterministic median/MAD screen ranks valid but unusual records (flag threshold 2.5 robust deviations); users must accept, correct or exclude with a reason. No record is automatically deleted. Exclusions are included in the analysis version and only affect analytics runs, not the rule-based dashboard.
- **Sensitivity:** 120 deterministic weight perturbations (seed 42, each raw weight varied within ±10 percentage points then renormalized). Typical rank is the median; rank range is min–max; top-fifth frequency is a sensitivity frequency, not success probability or a confidence interval. Named scenarios are saved in the compatible workspace backup.
- **Supervised priority model:** not trained or deployed. It requires independently reviewed numeric labels on observed records for at least 20 independent site identities. Synthetic labels and labels copied from the rule score do not count as independent evidence. The planned benchmark is gated until data, grouped evaluation and a trusted training/registry service are in place.
- **Outcome model and forecasting:** not implemented. The Model Lab explains the outcome data that must be captured first; no history is invented from a single snapshot and no success prediction is shown.

The analytics endpoint is stateless and validates the active workspace payload. It does not store jobs, expose model artifacts, or load user-uploaded pickle/joblib files. If the endpoint is unavailable, existing rule scores and planning views remain usable; the Analytics view shows an error and retry action.

## Scientific interpretation

The current implementation is a **rule-based decision-support baseline**, not a trained machine-learning model. It does not claim prediction accuracy, measured carbon sequestration, or ecological success.

Default score = 0.30 × (100 − vegetation %) + 0.20 × (100 − soil health) + 0.15 × water stress + 0.15 × (100 − biodiversity) + 0.20 × erosion risk. High ≥65; moderate ≥40; low <40. These weights and thresholds are prototype assumptions requiring expert validation. Scores measure ecological need, not restoration feasibility. Where a site has repeated observations, the latest observation (then the lexicographically smallest record ID for equal timestamps) represents that site in clustering, weight-sensitivity rankings, and unique-area totals. Individual observations remain visible for review.

Recommendations preserve distinctions among grassland, wetland, riverbank, coastal and forest habitats. Native grassland should not be treated as degraded forest. Site access, land tenure, community participation, hydrology, local species, invasive species and seasonal windows require field assessment.

Budget rate assumptions: Grassland ₹25,000/ha; Forest and Riverbank ₹45,000/ha; Wetland ₹65,000/ha; Coastal ₹85,000/ha. They are placeholders, not researched quotations. Greedy selection is not a guaranteed optimum.

Suggested actions now expose their habitat-specific rationale and required field checks; low vegetation cover alone does not trigger tree planting in grasslands. Estimated plan costs are read-only, derived from the illustrative habitat rate at plan creation, and are not researched quotations. Reported monitoring changes are observational and do not establish that an intervention caused improvement.

## Roadmap to a research-quality predictive system

1. Collect consented and documented field measurements with locations, timestamps, sources, uncertainty and an agreed ecological index rubric.
2. Have domain experts label restoration priority, habitat-specific interventions and observed outcomes. Do not use the baseline score itself as a training label and call it independent validation.
3. Only after sufficient independent labels exist, add a private, authenticated Python/FastAPI training service using pandas/scikit-learn. Use grouped/chronological evaluation; compare a dummy baseline, simple regressors and the existing rule score only when scales are compatible. Store validated run metadata and trusted artifacts; report MAE/RMSE, meaningful R², rank correlation, ecosystem errors where supportable, and limitations.
4. Add satellite-derived vegetation features (e.g. cloud-masked Sentinel imagery) with observation dates. Satellite revisits are not continuous real-time measurements.
5. Add device-authenticated sensor ingestion, quality checks, stale-data detection and scheduled jobs only when a real sensor or provider connection exists.
6. Normalize snapshots into projects/members/sites/observations/analysis_runs/interventions/tasks for team collaboration, add per-project role policies, field evidence storage and audit logs.

Not implemented: supervised model training/inference, model-run registry or approval workflow, satellite download/processing, IoT streams, background scheduled ingestion, multi-user roles, outcome forecasting, spatial significance/connectivity analysis, species suitability models or field-validated cost/impact estimates. Weather does not silently overwrite baseline soil or biodiversity values.

## Verification

```sh
node --experimental-strip-types tests/core.mjs
node node_modules/typescript/bin/tsc --noEmit
pnpm build
```

Core checks cover required values, duplicate record IDs, independent site identity, provenance preservation, coordinate bounds, valid dates, score boundaries, deterministic K-means, missing/identical clustering states, anomaly review, supervised readiness gates, unique-site area totals, deterministic sensitivity, budget constraints and dataset recomputation. Production build and runtime analytics requests should be checked with `pnpm build` and the local Worker server. Live Supabase authentication, RLS and persistence await a selected active project.

## Data sources

- Open-Meteo documentation: https://open-meteo.com/en/docs
- Map attribution and usage: https://www.openstreetmap.org/copyright
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security

Free-service availability, quotas and terms may change. This prototype has no paid model dependency.
