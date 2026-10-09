'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { latestSiteProfiles } from '../lib/analytics';
import { analyze, defaults } from '../lib/ecology';
import type { Observation, Plan, Ranked, ReviewDecision, Site, Weights, WeightScenario } from '../lib/ecology';

type AnalyticsResponse = {
  datasetVersion: string;
  generatedAt: string;
  source: string;
  excludedRecordIds: string[];
  method: string;
  readiness: {
    recordCount: number;
    independentSiteCount: number;
    missingness: Record<string, number>;
    provenanceCounts: Record<string, number>;
    labeledRecordCount: number;
    independentLabeledSites: number;
    supervisedReady: boolean;
    supervisedReason: string;
  };
  clustering: {
    status: 'ready' | 'unavailable';
    reason?: string;
    seed: number;
    trainingSampleCount: number;
    silhouette?: number;
    membership: Record<string, string>;
    clusters: { id: string; size: number; description: string; median: Record<string, number> }[];
  };
  anomalies: { recordId: string; score: number; unusual: boolean; values: Record<string, number>; peerMedian: Record<string, number>; status: string }[];
  sensitivity: { recordId: string; typicalRank: number; minimumRank: number; maximumRank: number; topFrequency: number }[];
};

type Props = {
  sites: Site[];
  ranked: Ranked[];
  source: string;
  weights: Weights;
  reviews: ReviewDecision[];
  weightScenarios: WeightScenario[];
  observations: Observation[];
  plans: Plan[];
  onReviewsChange: (reviews: ReviewDecision[]) => void;
  onScenariosChange: (scenarios: WeightScenario[]) => void;
  onCorrect: (recordId: string, field: string, value: number, reason: string) => void;
  onClusterChange: (membership: Record<string, string>) => void;
};

const tabs = ['Data Quality', 'Clustering', 'Reviews', 'Model Lab', 'Sensitivity'] as const;
const reviewFields = [
  'vegetation_pct',
  'soil_health',
  'water_stress',
  'biodiversity',
  'erosion_risk',
] as const;
const humanize = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export default function AnalyticsWorkspace({
  sites,
  ranked,
  source,
  weights,
  reviews,
  weightScenarios,
  observations,
  plans,
  onReviewsChange,
  onScenariosChange,
  onCorrect,
  onClusterChange,
}: Props) {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('Data Quality');
  const [reportState, setReportState] = useState<{ requestKey: string; report: AnalyticsResponse } | null>(null);
  const [settledRequestKey, setSettledRequestKey] = useState('');
  const [errorState, setErrorState] = useState<{ requestKey: string; message: string } | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [fieldById, setFieldById] = useState<Record<string, string>>({});
  const [valueById, setValueById] = useState<Record<string, string>>({});
  const [scenarioName, setScenarioName] = useState('');
  const [comparedScenarioId, setComparedScenarioId] = useState('');

  const excludedIds = useMemo(() => reviews.filter(review => review.status === 'excluded').map(review => review.recordId), [reviews]);
  const requestKey = useMemo(() => JSON.stringify({ sites, weights, excludedIds, retryKey }), [sites, weights, excludedIds, retryKey]);
  const report = reportState?.requestKey === requestKey ? reportState.report : null;
  const loading = settledRequestKey !== requestKey;
  const error = errorState?.requestKey === requestKey ? errorState.message : '';
  const fetchAnalytics = useCallback(async (signal: AbortSignal) => {
    const response = await fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sites, weights, excludedRecordIds: excludedIds }),
      signal,
    });
    const data = await response.json() as AnalyticsResponse | { error?: string };
    if (!response.ok) throw new Error('error' in data ? data.error : 'Analytics request failed.');
    setReportState({ requestKey, report: data as AnalyticsResponse });
  }, [sites, weights, excludedIds, requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve()
      .then(() => fetchAnalytics(controller.signal))
      .catch(problem => {
        if (problem instanceof DOMException && problem.name === 'AbortError') return;
        setErrorState({ requestKey, message: problem instanceof Error ? problem.message : 'Analytics are unavailable.' });
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettledRequestKey(requestKey);
      });
    return () => controller.abort();
  }, [fetchAnalytics, requestKey]);

  useEffect(() => {
    if (report?.clustering.status === 'ready') onClusterChange(report.clustering.membership);
    else onClusterChange({});
  }, [report?.clustering, onClusterChange]);

  function saveReview(recordId: string, status: ReviewDecision['status']) {
    const reason = reasonById[recordId]?.trim();
    if (!reason) {
      setErrorState({ requestKey, message: 'Add a review reason before saving a decision.' });
      return;
    }
    onReviewsChange([
      ...reviews.filter(review => review.recordId !== recordId),
      { recordId, status, reason, updatedAt: new Date().toISOString() },
    ]);
  }

  function correct(recordId: string) {
    const reason = reasonById[recordId]?.trim();
    const field = fieldById[recordId] ?? reviewFields[0];
    const value = Number(valueById[recordId]);
    if (!reason) {
      setErrorState({ requestKey, message: 'Add a review reason before saving a correction.' });
      return;
    }
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setErrorState({ requestKey, message: 'Enter a corrected indicator value from 0 to 100.' });
      return;
    }
    onCorrect(recordId, field, value, reason);
    onReviewsChange([
      ...reviews.filter(review => review.recordId !== recordId),
      { recordId, status: 'corrected', reason, correctedField: field, correctedValue: value, updatedAt: new Date().toISOString() },
    ]);
  }

  function saveScenario() {
    const name = scenarioName.trim();
    if (!name) {
      setErrorState({ requestKey, message: 'Enter a name for this weight scenario.' });
      return;
    }

    if (weightScenarios.some(scenario => scenario.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setErrorState({ requestKey, message: 'A weight scenario with this name already exists.' });
      return;
    }
    onScenariosChange([
      ...weightScenarios,
      { id: crypto.randomUUID(), name, weights: { ...weights }, createdAt: new Date().toISOString() },
    ]);
    setScenarioName('');
    setErrorState(null);
  }

  function exportReport() {
    if (!report) {
      setErrorState({ requestKey, message: 'Wait for the current analytics run before exporting its report.' });
      return;
    }
    const monitoringSummary = sites.map(site => {
      const records = observations.filter(observation => observation.siteId === site.id).sort((a, b) => a.date.localeCompare(b.date));
      const baseline = records[0] ?? null;
      const latest = records.at(-1) ?? null;
      return {
        siteId: site.site_id ?? site.id,
        observationCount: records.length,
        baseline,
        latest,
        absoluteChange: baseline && latest ? {
          vegetation: latest.vegetation - baseline.vegetation,
          survival: latest.survival - baseline.survival,
        } : null,
      };
    });
    const reportData = {
      exportedAt: new Date().toISOString(),
      dataset: { name: source, version: report.datasetVersion, sourceSummary: report.source, readiness: report.readiness },
      method: 'Weighted ecological deficit v1 (rule-based baseline)',
      weights,
      rankedSites: ranked.map(({ breakdown, ...site }) => ({
        ...site,
        provenance: site.provenance_type ?? site.data_status ?? 'unknown',
        provenanceBadge: (site.provenance_type ?? site.data_status) === 'synthetic' ? 'Synthetic demonstration data' : undefined,
        factorContributions: breakdown,
      })),
      savedWeightScenarios: weightScenarios,
      savedReviewDecisions: reviews,
      interventions: plans,
      monitoringSummary,
      budgetAssumptionsInrPerHa: { Grassland: 25000, Forest: 45000, Riverbank: 45000, Wetland: 65000, Coastal: 85000 },
      limitations: [
        'Rule scores and habitat actions are a research/demo baseline, not trained predictions or validated ecological outcomes.',
        'Budget rates are illustrative assumptions, not quotations.',
        'User-supplied provenance and review decisions are not independently verified.',
        'Profile clusters are exploratory, not validated ecological classes.',
        'Anomaly review identifies statistical unusualness, not invalidity or measurement error.',
        'Sensitivity frequencies are not probabilities of restoration success or confidence intervals.',
        'Monitoring change is observational and does not establish intervention causality.',
      ],
    };
    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ecorestore-analysis-report.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const sitesById = new Map(sites.map(site => [site.id, site]));
  const decisions = new Map(reviews.map(review => [review.recordId, review]));
  const anomalyRows = report?.anomalies.filter(item => item.unusual) ?? [];
  const activeSites = sites.filter(site => !report?.excludedRecordIds.includes(site.id));
  const independentSites = latestSiteProfiles(activeSites);
  const independentSiteIds = new Set(independentSites.map(site => site.id));
  const activeRanked = ranked.filter(site => independentSiteIds.has(site.id));
  const baselineRanks = new Map(independentSites.map(site => ({ id: site.id, score: analyze(site, defaults).score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((site, index) => [site.id, index + 1]));
  const comparedScenario = weightScenarios.find(scenario => scenario.id === comparedScenarioId);
  const comparedRanks = comparedScenario
    ? new Map(independentSites.map(site => ({ id: site.id, score: analyze(site, comparedScenario.weights).score }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .map((site, index) => [site.id, index + 1]))
    : undefined;

  return (
    <div className="analytics-workspace">
      <div className="analytics-tabs" role="tablist" aria-label="Analytics sections">
        {tabs.map(tab => (
          <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </div>
      <div className="analytics-context">
        <div>
          <strong>Active dataset: {source}</strong>
          <p>{report ? `Dataset version ${report.datasetVersion} · ${report.method}` : 'Analytics run on the active dataset only.'}</p>
        </div>
        <div className="button-row">
          <button type="button" className="button" onClick={() => setRetryKey(value => value + 1)} disabled={loading}>
            {loading ? 'Analyzing…' : 'Refresh analysis'}
          </button>
          <button type="button" className="button" onClick={exportReport} disabled={!report}>Export report</button>
        </div>
      </div>
      {error && <div className="notice" role="alert"><span>{error}</span><button type="button" onClick={() => setErrorState(null)} aria-label="Dismiss error">×</button></div>}
      {loading && !report && <section className="panel panel-padding" role="status">Running analyses for this dataset…</section>}
      {error && !report && <section className="panel panel-padding"><p>Could not load the analytics response. The rule-based priority analysis remains available.</p><button className="button" onClick={() => setRetryKey(value => value + 1)}>Retry</button></section>}
      {report && activeTab === 'Data Quality' && (
        <>
          <section className="panel">
            <div className="panel-heading"><div><h2>Data readiness</h2><p>Why each analysis can or cannot run</p></div><span className="tag">{report.readiness.independentSiteCount} independent sites</span></div>
            <div className="readiness-grid">
              <div><span>Records / independent sites</span><strong>{report.readiness.recordCount} / {report.readiness.independentSiteCount}</strong></div>
              <div><span>Expert-labeled records</span><strong>{report.readiness.labeledRecordCount}</strong></div>
              <div><span>Independent labeled sites</span><strong>{report.readiness.independentLabeledSites}</strong></div>
              <div><span>Supervised priority model</span><strong>{report.readiness.supervisedReady ? 'Eligible for benchmark review' : 'Not ready'}</strong></div>
            </div>
            <div className="panel-padding">
              <h3>Provenance summary</h3>
              <div className="provenance-list">{Object.entries(report.readiness.provenanceCounts).map(([kind, count]) => <span key={kind}><strong>{count}</strong> {kind}{kind === 'synthetic' && <em className="data-badge">Synthetic demo</em>}</span>)}</div>
              <p className="muted small">Provenance comes from an explicit record field. A place name is not evidence that measurements were collected there; user-supplied provenance is not independently verified.</p>
              <h3>Missing values (not imputed)</h3>
              <div className="provenance-list">{Object.entries(report.readiness.missingness).map(([field, count]) => <span key={field}><strong>{count}</strong> {humanize(field)}</span>)}</div>
            </div>
          </section>
          <section className="panel panel-padding">
            <h2>Model readiness gates</h2>
            <div className="model-requirements">
              <p><strong>Ecological-profile clustering:</strong> requires at least three complete indicator profiles. Missing indicators are not replaced with zero.</p>
              <p><strong>Anomaly review:</strong> deterministic schema/range validation first; statistical unusualness is available only with at least four peer records.</p>
              <p><strong>Supervised benchmark:</strong> {report.readiness.supervisedReason}</p>
              <p><strong>Data source:</strong> {report.source}</p>
            </div>
          </section>
        </>
      )}
      {report && activeTab === 'Clustering' && (
        <>
          <section className="panel panel-padding">
            <div className="eyebrow">UNSUPERVISED PROFILE GROUPING</div>
            <h2>Ecological indicator clusters</h2>
            <p className="muted">Question: which records have similar ecological indicator profiles? Features are vegetation cover, soil health, water stress, biodiversity, and erosion risk. IDs, names, coordinates, labels, and current priority scores are excluded. Values are standardized; no missing-value imputation is used.</p>
            {report.clustering.status === 'ready'
              ? <p className="small muted">Best candidate silhouette: {report.clustering.silhouette?.toFixed(3)} · fixed seed {report.clustering.seed} · clustering fit sample {report.clustering.trainingSampleCount} records. This describes geometric separation, not classification accuracy or validated ecological classes.</p>
              : <p className="insufficient-state">{report.clustering.reason}</p>}
          </section>
          {report.clustering.status === 'ready' && <>
            <section className="cluster-grid">{report.clustering.clusters.map(cluster => <article className="panel cluster-card" key={cluster.id}>
              <span className="tag">{cluster.id} · {cluster.size} records</span>
              <h3>{cluster.description}</h3>
              <dl>{Object.entries(cluster.median).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{value.toFixed(1)}</dd></div>)}</dl>
            </article>)}</section>
            <section className="panel">
              <div className="panel-heading"><div><h2>Cluster membership</h2><p>Neutral IDs; derived descriptions are not priority recommendations.</p></div></div>
              <div className="table-scroll"><table><thead><tr><th>Site</th><th>Group</th><th>Analytics status</th><th>Provenance</th></tr></thead><tbody>{sites.map(site => <tr key={site.id}><td>{site.name}<small>{site.site_id ?? site.id} · {site.id}</small></td><td><span className="tag">{report.clustering.membership[site.id] ?? 'Unassigned'}</span></td><td>{report.excludedRecordIds.includes(site.id)?'Excluded by review':report.clustering.membership[site.id]?'Included':'Not clustered'}</td><td>{(site.provenance_type ?? site.data_status) === 'synthetic' ? <em className="data-badge">Synthetic demo</em> : site.provenance_type ?? site.data_status ?? 'unknown'}</td></tr>)}</tbody></table></div>
            </section>
          </>}
        </>
      )}
      {report && activeTab === 'Reviews' && (
        <>
          <section className="panel panel-padding">
            <div className="eyebrow">REVIEW QUEUE</div><h2>Unusual is not invalid</h2>
            <p className="muted">Schema and physical-range violations are rejected at import. These records passed validation but are statistically unusual relative to this dataset, using a robust median/MAD screen. This is not a causal explanation and does not establish measurement error. Outliers are never removed automatically.</p>
            <p className="muted small">{anomalyRows.length} unusual records · {reviews.length} saved review decisions. Excluded records remain in the dataset and rule-based dashboard but are excluded from analytics runs.</p>
          </section>
          {anomalyRows.map(item => {
            const site = sitesById.get(item.recordId);
            const decision = decisions.get(item.recordId);
            return <section className="panel review-card" key={item.recordId}>
              <div className="panel-heading"><div><h2>{site?.name ?? item.recordId}</h2><p>{site?.ecosystem} · {site?.site_id ?? site?.id} · unusualness score {item.score}</p></div>
                {decision && <span className={`tag review-${decision.status}`}>{humanize(decision.status)}</span>}
              </div>
              <div className="review-values">{Object.entries(item.values).map(([key, value]) => <span key={key}>{humanize(key)} <strong>{value}</strong> <small>· dataset median {item.peerMedian[key]?.toFixed(1)}</small></span>)}</div>
              <div className="panel-padding">
                <label className="field">Review reason<textarea value={reasonById[item.recordId] ?? decision?.reason ?? ''} onChange={event => setReasonById(previous => ({ ...previous, [item.recordId]: event.target.value }))} rows={2} /></label>
                <div className="review-actions">
                  <button className="button" onClick={() => saveReview(item.recordId, 'accepted')}>Accept as unusual</button>
                  <select aria-label={`Indicator to correct for ${site?.name ?? item.recordId}`} value={fieldById[item.recordId] ?? reviewFields[0]} onChange={event => setFieldById(previous => ({ ...previous, [item.recordId]: event.target.value }))}>
                    {reviewFields.map(field => <option key={field} value={field}>{humanize(field)}</option>)}
                  </select>
                  <input aria-label={`Corrected indicator value for ${site?.name ?? item.recordId}`} type="number" min="0" max="100" value={valueById[item.recordId] ?? ''} onChange={event => setValueById(previous => ({ ...previous, [item.recordId]: event.target.value }))} placeholder="0–100" />
                  <button className="button" onClick={() => correct(item.recordId)}>Correct</button>
                  <button className="button" onClick={() => saveReview(item.recordId, 'excluded')}>Exclude from analytics</button>
                </div>
                {decision && <p className="muted small">Saved {decision.status} decision on {new Date(decision.updatedAt).toLocaleString()}. {decision.correctedField && `Corrected ${humanize(decision.correctedField)} to ${decision.correctedValue}.`}</p>}
              </div>
            </section>;
          })}
          {anomalyRows.length === 0 && <section className="panel panel-padding"><p>No statistical outliers were identified, or the current dataset is too small to compare peers. This does not mean the measurements have been verified.</p></section>}
          {reviews.some(review => !anomalyRows.some(item => item.recordId === review.recordId)) && <section className="panel panel-padding">
            <h2>Resolved review history</h2>
            {reviews.filter(review => !anomalyRows.some(item => item.recordId === review.recordId)).map(review => <p className="review-history" key={review.recordId}><strong>{sitesById.get(review.recordId)?.name ?? review.recordId}</strong> · {humanize(review.status)} · {review.reason}</p>)}
          </section>}
        </>
      )}
      {report && activeTab === 'Model Lab' && (
        <>
        <section className="panel panel-padding">
          <div className="eyebrow">PRIORITY MODEL AVAILABILITY</div>
          <h2>Supervised priority benchmark</h2>
          <p className="muted">Question: can independently reviewed field labels predict ecological priority for previously unseen sites? No model is trained or presented as available until those labels and independent site groups exist.</p>
          <div className={report.readiness.supervisedReady ? 'notice' : 'insufficient-state'}>{report.readiness.supervisedReason}</div>
          <div className="model-requirements">
            <p>Required target: reviewed_priority_score (0–100), independently assessed using a documented protocol.</p>
            <p>Current eligible records: {report.readiness.labeledRecordCount}; independent sites: {report.readiness.independentLabeledSites}.</p>
            <p>Rule-emulation labels, synthetic expert-priority text, unreviewed data, and repeated observations counted as independent sites are not eligible.</p>
            <p>When available, the planned benchmark will compare DummyRegressor, Ridge, RandomForestRegressor, and ExtraTreesRegressor with site-grouped evaluation, training-only preprocessing, held-out metrics, and explicit limitations. {report.readiness.supervisedReady ? 'The records meet a minimum review gate, but no training service or artifact registry is configured, so no model can be trained or approved here.' : 'No training service or artifact registry is configured.'}</p>
          </div>
          <div className="notice"><span>The weighted ecological-deficit v1 baseline remains active and is never silently replaced.</span></div>
        </section>
        <section className="panel panel-padding">
          <div className="eyebrow">OUTCOME MODEL READINESS</div>
          <h2>Insufficient outcome data</h2>
          <p className="muted">No restoration outcome model is available. Outcomes must be captured and reviewed before this question can be evaluated.</p>
          <div className="insufficient-state">Collect intervention type, actual implementation date, pre-intervention conditions, follow-up horizon, maintenance activities, a defined outcome and measurement method, plus failed or incomplete follow-ups.</div>
          <div className="model-requirements">
            <p>Define continuous outcomes separately from success/failure labels.</p>
            <p>Use only information available before the outcome; validate by independent sites and appropriate time periods.</p>
            <p>Outcome capture and a validated evaluation design are not yet implemented; no forecast or success probability is fabricated.</p>
          </div>
        </section>
        </>
      )}
      {report && activeTab === 'Sensitivity' && (
        <>
          <section className="panel panel-padding">
            <div className="eyebrow">BOUNDED WEIGHT SENSITIVITY</div>
            <h2>How stable is the ranking?</h2>
            <p className="muted">Weights are perturbed within ±10 percentage points, renormalized to sum to 100%, and evaluated in 120 deterministic samples (seed 42). Typical rank is the median. Top-frequency reports how often a site appeared among the highest-priority fifth in these sensitivity runs; it is not probability of ecological success or a confidence interval.</p>
            <div className="button-row">
              <input aria-label="Scenario name" placeholder="Name this weight scenario" value={scenarioName} onChange={event => setScenarioName(event.target.value)} />
              <button className="button primary" onClick={saveScenario}>Save current weights</button>
            </div>
            {weightScenarios.length > 0 && <>
              <label className="field">Compare with saved scenario<select value={comparedScenarioId} onChange={event => setComparedScenarioId(event.target.value)}><option value="">No saved scenario</option>{weightScenarios.map(scenario => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}</select></label>
              <div className="scenario-list">{weightScenarios.map(scenario => <div key={scenario.id}><span>{scenario.name}<small>{new Date(scenario.createdAt).toLocaleDateString()}</small></span><button className="button" onClick={() => { onScenariosChange(weightScenarios.filter(item => item.id !== scenario.id)); if (comparedScenarioId === scenario.id) setComparedScenarioId(''); }}>Remove</button></div>)}</div>
            </>}
          </section>
          <section className="panel">
            <div className="panel-heading"><div><h2>Current vs baseline ranking stability</h2><p>Current score uses active weights; sensitivity uses bounded perturbations.</p></div><span className="tag">Rule baseline v1</span></div>
            <div className="table-scroll"><table><thead><tr><th>Site</th><th>Baseline rank</th><th>Current rank</th>{comparedScenario && <th>{comparedScenario.name} rank</th>}<th>Typical rank</th><th>Rank range</th><th>Top-fifth frequency</th><th>Provenance</th></tr></thead><tbody>{report.sensitivity.map(item => {
              const site = sitesById.get(item.recordId);
              const currentRank = activeRanked.findIndex(row => row.id === item.recordId) + 1;
              const provenance = site?.provenance_type ?? site?.data_status ?? 'unknown';
              return <tr key={item.recordId}><td>{site?.name ?? item.recordId}</td><td>{baselineRanks.get(item.recordId) ?? '—'}</td><td>{currentRank}</td>{comparedScenario && <td>{comparedRanks?.get(item.recordId) ?? '—'}</td>}<td>{item.typicalRank}</td><td>{item.minimumRank}–{item.maximumRank}</td><td>{item.topFrequency}%</td><td>{provenance === 'synthetic' ? <em className="data-badge">Synthetic demo</em> : provenance}</td></tr>;
            })}</tbody></table></div>
          </section>
        </>
      )}
    </div>
  );
}
