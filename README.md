# EcoRestore — AI-Based Ecological Restoration Planning System

An EVS project implementation for moving from environmental observations to explainable priorities, restoration plans and field monitoring.

## What works

- Responsive seven-view workspace: overview, site explorer, datasets, priority analysis, restoration plans, monitoring, connections.
- Leaflet/OpenStreetMap map with selectable site markers, search and ecosystem filters.
- CSV ingestion: quoted fields, header normalization, required fields, numeric ranges, unique IDs and calendar-date validation; up to 5,000 rows / 3 MB.
- One active dataset drives every ranking, map, statistic, intervention suggestion and budget scenario. Import replaces the old dataset and clears old plans/observations after explicit confirmation in the import dialog.
- Explainable weighted ecological-deficit scoring with normalized, adjustable weights and per-site contributions.
- Budget scenarios, illustrative per-hectare rates, intervention plan creation/status/dates/notes.
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
| Maps | Leaflet 1.9.4 | OpenStreetMap tile service |
| CSV | Papa Parse 5.7.0 | Validate in browser and backend |
| Cloud data | Supabase PostgreSQL + Auth | @supabase/supabase-js 2.117.2, RLS |
| Weather | Open-Meteo | GET /api/weather?lat=...&lon=... |
| Charts | CSS data bars | Computed from current dataset or provider response |

Flow: CSV → client validation → POST /api/analyze → validated site records → ranked dashboard/map → plan → monitoring → optional private Supabase snapshot. Weather flows through the server proxy and remains separate from baseline ecological indices.

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
- The in-app sample download is synthetic, not a real-world dataset. Use a consistent documented survey rubric for all index fields.

## Scientific interpretation

The current implementation is a **rule-based decision-support baseline**, not a trained machine-learning model. It does not claim prediction accuracy, measured carbon sequestration, or ecological success.

Default score = 0.30 × (100 − vegetation %) + 0.20 × (100 − soil health) + 0.15 × water stress + 0.15 × (100 − biodiversity) + 0.20 × erosion risk. High ≥65; moderate ≥40; low <40. These weights and thresholds are prototype assumptions requiring expert validation. Scores measure ecological need, not restoration feasibility.

Recommendations preserve distinctions among grassland, wetland, riverbank, coastal and forest habitats. Native grassland should not be treated as degraded forest. Site access, land tenure, community participation, hydrology, local species, invasive species and seasonal windows require field assessment.

Budget rate assumptions: Grassland ₹25,000/ha; Forest and Riverbank ₹45,000/ha; Wetland ₹65,000/ha; Coastal ₹85,000/ha. They are placeholders, not researched quotations. Greedy selection is not a guaranteed optimum.

## Roadmap to a research-quality AI system

1. Collect consented and documented field measurements with locations, timestamps, sources, uncertainty and an agreed ecological index rubric.
2. Have domain experts label restoration priority, habitat-specific interventions and observed outcomes. Do not use the baseline score itself as a training label and call it independent validation.
3. Add a separately hosted Python/FastAPI service using pandas/scikit-learn for a trained, versioned model. Split by geography and time; compare against this rules baseline. Report MAE or ranking metrics as appropriate, calibration and uncertainty, with held-out results.
4. Add satellite-derived vegetation features (e.g. cloud-masked Sentinel imagery) with observation dates. Satellite revisits are not continuous real-time measurements.
5. Add device-authenticated sensor ingestion, quality checks, stale-data detection and scheduled jobs only when a real sensor or provider connection exists.
6. Normalize snapshots into projects/members/sites/observations/analysis_runs/interventions/tasks for team collaboration, add per-project role policies, field evidence storage and audit logs.

Not implemented: trained ML inference, satellite download/processing, IoT streams, background scheduled ingestion, multi-user roles, species suitability models or field-validated cost/impact estimates. Weather does not silently overwrite baseline soil or biodiversity values.

## Verification

```sh
node --experimental-strip-types tests/core.mjs
node node_modules/typescript/bin/tsc --noEmit
pnpm build
```

Core checks cover required values, duplicate IDs, coordinate bounds, valid dates, score boundaries, weight sensitivity, budget constraints and dataset recomputation. A live Open-Meteo request succeeded during development. Live Supabase authentication, RLS and persistence await a selected active project. Browser visual QA was unavailable in this environment; Figma layout was visually inspected.

## Data sources

- Open-Meteo documentation: https://open-meteo.com/en/docs
- Map attribution and usage: https://www.openstreetmap.org/copyright
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security

Free-service availability, quotas and terms may change. This prototype has no paid model dependency.
