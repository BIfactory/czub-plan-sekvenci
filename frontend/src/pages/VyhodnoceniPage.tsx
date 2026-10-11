import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import type { NodeDefinition, OverPlanItem, ProducedItem, ProducedSummary } from "../api/types";
import { useStaleDataWarning } from "../hooks/useStaleDataWarning";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { useClientSettings } from "../hooks/useClientSettings";
import { useNavSlot } from "../hooks/useNavSlot";
import { usePersistedNodeFilters } from "../hooks/usePersistedNodeFilters";
import { useYesterday } from "../hooks/useYesterday";
import RefreshBar from "../components/RefreshBar";
import ReasonPanel from "../components/ReasonPanel";
import FilterSelect from "../components/FilterSelect";

function distinctSorted(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b));
}

export default function VyhodnoceniPage() {
  const stale = useStaleDataWarning();
  const clientSettings = useClientSettings();
  const navSlot = useNavSlot();

  const [nodes, setNodes] = useState<NodeDefinition[]>([]);
  const [reasons, setReasons] = useState<string[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProducedSummary | null>(null);
  const [overPlan, setOverPlan] = useState<OverPlanItem[]>([]);

  // PRD 6.2: vychozi datum je "vcera" a posouva se s pulnoci (useYesterday). selectedDate
  // je jen rucni volba uzivatele - dokud je null, plati automaticke "vcera", takze
  // zalozka nechana otevrena pres noc prejde na novy den a nenacita dal ten puvodni.
  const defaultDate = useYesterday();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const date = selectedDate ?? defaultDate;
  // PRD 6.2 / Vyhodnocení.pa.yaml (filter_date.StartDate/EndDate) - vyber datumu je
  // omezeny na rozsah z v_calendar_last_3_workdays (nejstarsi..nejnovejsi).
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const { plant, setPlant, dept, setDept, teamLeader, setTeamLeader, node, setNode, rgid, setRgid } =
    usePersistedNodeFilters(clientSettings.filterCookieExpiryDays);
  const [rgidOptions, setRgidOptions] = useState<string[]>([]);

  const [items, setItems] = useState<ProducedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reasonTarget, setReasonTarget] = useState<ProducedItem | null>(null);

  const plantOptions = useMemo(() => distinctSorted(nodes.map((n) => n.plant)), [nodes]);
  const deptOptions = useMemo(
    () => distinctSorted(nodes.filter((n) => !plant || n.plant === plant).map((n) => n.dept)),
    [nodes, plant],
  );
  const teamLeaderOptions = useMemo(
    () => distinctSorted(nodes.filter((n) => (!plant || n.plant === plant) && (!dept || n.dept === dept)).map((n) => n.teamLeader)),
    [nodes, plant, dept],
  );
  const nodeOptions = useMemo(
    () =>
      distinctSorted(
        nodes
          .filter((n) => (!plant || n.plant === plant) && (!dept || n.dept === dept) && (!teamLeader || n.teamLeader === teamLeader))
          .map((n) => n.node),
      ),
    [nodes, plant, dept, teamLeader],
  );
  const params = useMemo(() => ({ date, node: node || undefined, rgid: rgid || undefined }), [date, node, rgid]);

  // availableDates je serazene sestupne (viz ReferenceService.GetAvailableDatesAsync)
  // - prvni polozka je nejnovejsi datum, posledni nejstarsi.
  const minDate = availableDates.length > 0 ? availableDates[availableDates.length - 1] : undefined;
  const maxDate = availableDates.length > 0 ? availableDates[0] : undefined;

  const loadProduced = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .produced(params)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [params]);

  const loadOverPlan = useCallback(() => {
    api.producedOverPlan(params).then(setOverPlan);
  }, [params]);

  const loadSummary = useCallback(() => {
    if (!node) {
      setSummary(null);
      return;
    }
    api.producedSummary(params).then(setSummary);
  }, [params, node]);

  useEffect(() => {
    api.nodes().then(setNodes);
    api.reasons().then(setReasons);
    api.lastSync().then((r) => setLastSync(r.startTime));
    api.availableDates().then(setAvailableDates);
  }, []);

  useEffect(() => {
    loadProduced();
  }, [loadProduced]);

  useEffect(() => {
    loadOverPlan();
  }, [loadOverPlan]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    api.producedRgids(node || undefined).then(setRgidOptions);
  }, [node]);

  const handleRefresh = () => {
    loadProduced();
    loadOverPlan();
    loadSummary();
    api.lastSync().then((r) => setLastSync(r.startTime));
    // min/max filtru Datum - po pulnoci se rozsah z v_calendar_last_3_workdays posouva.
    api.availableDates().then(setAvailableDates);
    stale.markRefreshed();
  };

  // Fáze 3 (PRD 2, 8.1) - automaticky background refresh misto (puvodne) vyhradne
  // rucniho tlacitka; tlacitko + 30min upozorneni na neaktualni data zustavaji jako
  // fallback (viz useStaleDataWarning). Interval z appsettings.json (useClientSettings).
  useAutoRefresh(handleRefresh, clientSettings.autoRefreshIntervalSeconds * 1000);

  const barTotal =
    (summary?.producedInPlanHod ?? 0) + (summary?.producedOverPlanHod ?? 0) + (summary?.producedOutOfPlanHod ?? 0);
  const barBasis = Math.max(barTotal, summary?.capacityHod ?? 0, 0.0001);

  return (
    <section className="plan-page">
      {navSlot && createPortal(
        <RefreshBar
          lastSync={lastSync}
          onRefresh={handleRefresh}
          showWarning={stale.showWarning}
          refreshing={loading}
        />,
        navSlot,
      )}
      <div className="ps-header-grid ps-header-grid-eval">
        <div className="ps-card ps-filters-card">
          <h1>Vyhodnocení</h1>
          <div className="ps-filter-grid ps-filter-grid-3">
            <label className="filter-select-field">
              <span className="filter-select-label">Datum</span>
              <input
                type="date"
                value={date}
                min={minDate}
                max={maxDate}
                // Volba rovna aktualnimu "vcera" (nebo vymazane pole) = zpet na automaticky
                // rezim, aby se datum posunulo i pri pozdejsim prechodu pres pulnoc.
                onChange={(e) => setSelectedDate(e.target.value && e.target.value !== defaultDate ? e.target.value : null)}
              />
            </label>
            <FilterSelect label="Provoz" value={plant} options={plantOptions} onChange={setPlant} />
            <FilterSelect label="Dílna" value={dept} options={deptOptions} onChange={setDept} />
            <FilterSelect label="Team Leader" value={teamLeader} options={teamLeaderOptions} onChange={setTeamLeader} />
            <FilterSelect label="Uzel" value={node} options={nodeOptions} onChange={setNode} />
            <FilterSelect
              label="Skupina zdrojů"
              value={rgid}
              options={rgidOptions}
              onChange={setRgid}
              disabled={!node}
              disabledHint="Filtr je dostupný, pokud je vybráno pracoviště"
            />
          </div>
        </div>

        <div className="ps-eval-row">
          <div className="ps-card ps-summary-card">
            <div className="ps-card-header">
              <h2>Vyhodnocení plánu</h2>
            </div>
            <div className="ps-summary-grid ps-summary-grid-1col">
              <div className="ps-summary-cell">
                <span className="arrow-icon arrow-pink">➜</span>
                <span className="ps-summary-label">Celkem v plánu</span>
                <span>: {formatHod(summary?.planHod)}</span>
              </div>
              <div className="ps-summary-cell">
                <span className="arrow-icon arrow-pink">➜</span>
                <span className="ps-summary-label">Vyrobeno</span>
                <span>: {formatHod(summary?.producedInPlanHod)}</span>
              </div>
              <div className="ps-summary-cell">
                <span className="arrow-icon arrow-orange">➜</span>
                <span className="ps-summary-label">Nad plán</span>
                <span>: {formatHod(summary?.producedOverPlanHod)}</span>
              </div>
              <div className="ps-summary-cell">
                <span className="arrow-icon arrow-grey">➜</span>
                <span className="ps-summary-label">Mimo plán</span>
                <span>: {formatHod(summary?.producedOutOfPlanHod)}</span>
              </div>
            </div>
            <div className="ps-summary-footer">
              <span>Kapacita: {formatHod(summary?.capacityHod)}</span>
            </div>
          </div>

          <div className="ps-card ps-graph-card">
            <h3>Graf vyhodnocení</h3>
            <div className="eval-bar-vertical">
              <div className="eval-bar-segment-v eval-vyrobeno" style={{ height: pct(summary?.producedInPlanHod, barBasis) }} title="vyrobeno" />
              <div className="eval-bar-segment-v eval-nadplan" style={{ height: pct(summary?.producedOverPlanHod, barBasis) }} title="nad plán" />
              <div className="eval-bar-segment-v eval-mimoplan" style={{ height: pct(summary?.producedOutOfPlanHod, barBasis) }} title="mimo plán" />
              {summary?.capacityHod !== null && summary?.capacityHod !== undefined && (
                <div className="eval-bar-cap-marker-v" style={{ bottom: pct(summary.capacityHod, barBasis) }} title={`kapacita: ${summary.capacityHod} hod`} />
              )}
            </div>
            <div className="eval-legend">
              <span><i className="eval-swatch eval-vyrobeno" /> vyrobeno</span>
              <span><i className="eval-swatch eval-nadplan" /> nad plán</span>
              <span><i className="eval-swatch eval-mimoplan" /> mimo plán</span>
            </div>
          </div>
        </div>

        <div className="ps-card ps-history-card">
          <h2>Historie</h2>
          <div className="eval-history-row">
            <span className="ps-summary-label">Plnění plánu</span>
            <span className={pctClass(summary?.sa ?? null, 0.5, 0.95)}>
              {formatPct(summary?.sa ?? null)} {summary?.sa !== null && summary?.sa !== undefined && summary.sa >= 0.93 && "🙂"}
            </span>
          </div>
          <div className="eval-history-row">
            <span className="ps-summary-label">Výkon</span>
            <span className={pctClass(summary?.performance ?? null, 0.5, 0.85)}>
              {formatPct(summary?.performance ?? null)} {summary?.performance !== null && summary?.performance !== undefined && summary.performance >= 0.85 && "🙂"}
            </span>
          </div>
        </div>
      </div>

      {error && <p className="reason-error">{error}</p>}

      <div className="table-scroll">
        <table className="workplan-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>JobSuffix</th>
              <th>Položka</th>
              <th>Popis</th>
              <th>Plán [hod]</th>
              <th>Vyrobeno [hod]</th>
              <th>Plán [ks]</th>
              <th>Vyrobeno [ks]</th>
              <th>Sequence date</th>
              <th>Důvod</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td className="center">
                  {statusIcon(row)}
                  {row.prio === 1 && <span className="mprio-flag">P</span>}
                </td>
                <td title={row.rgid ?? undefined}>{row.idJobSuffixOper}</td>
                <td>{row.item}</td>
                <td>{row.itemDesc}</td>
                <td className="num">{round(row.hodPlan, 2)}</td>
                <td className="num">{round(row.hodProduced, 2)}</td>
                <td className="num">{row.qtyTodo}</td>
                <td className="num">{row.qtyDone}</td>
                <td className="num">{formatDate(row.sequenceDateTime)}</td>
                <td title={row.reasonNote ?? undefined}>{row.reason}</td>
                <td className="center">
                  {row.produced === 0 && row.reasonEnabled === 1 && row.status === 2 && (
                    <button
                      type="button"
                      className={"icon-button warning-icon" + (row.reason ? "" : " warning-icon-active")}
                      title="Zapsat důvod"
                      onClick={() => setReasonTarget(row)}
                    >
                      ⚠
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={11} className="empty-row">Žádná data pro zvolené filtry.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Vyhodnocení nad plán nebo mimo plán</h2>
      <div className="table-scroll">
        <table className="workplan-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>JobSuffix</th>
              <th>Položka</th>
              <th>Popis</th>
              <th>Vyrobeno [hod]</th>
              <th>Vyrobeno [ks]</th>
              <th>Sequence date</th>
              <th>Popis stavu</th>
            </tr>
          </thead>
          <tbody>
            {overPlan.map((row) => (
              <tr key={row.id}>
                <td className="center">
                  {row.status === 3 && <span className="overplan-dot" />}
                  {row.prio === 1 && <span className="mprio-flag">P</span>}
                </td>
                <td>{row.idJobSuffixOper}</td>
                <td>{row.item}</td>
                <td>{row.itemDesc}</td>
                <td className="num">{round(row.hodProduced, 1)}</td>
                <td className="num">{round(row.qtyDone, 2)}</td>
                <td className="num">{formatDate(row.sequenceDateTime)}</td>
                <td>{row.statusDesc}</td>
              </tr>
            ))}
            {overPlan.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-row">Žádné položky nad plán ani mimo plán.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {reasonTarget && (
        <ReasonPanel
          title="Zadání důvodu neplnění"
          targetLabel={reasonTarget.idJobSuffixOper ?? ""}
          reasons={reasons}
          onSubmit={async (reason, note) => {
            // Klic radku (ne id - viz api/client.ts); datum z radku, ne z filtru.
            if (!reasonTarget.idJobSuffixOper || !reasonTarget.node || !reasonTarget.date) {
              throw new Error("Záznam nemá úplný klíč (operace/uzel/datum), důvod nelze uložit.");
            }
            await api.submitProducedReason(
              { idJobSuffixOper: reasonTarget.idJobSuffixOper, node: reasonTarget.node, date: reasonTarget.date },
              reason,
              note,
            );
            loadProduced();
          }}
          onClose={() => setReasonTarget(null)}
        />
      )}
    </section>
  );
}

function statusIcon(row: ProducedItem) {
  if (row.status === 1 && row.qtyDone === row.qtyTodo) return <span className="status-ok">✓</span>;
  if (row.status === 2) return <span className="status-error">✕</span>;
  if (row.status === 5) return <span className="status-warning">⚠</span>;
  return null;
}

function round(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "";
  return value.toFixed(digits);
}

function formatHod(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.toFixed(2) + " hod";
}

function formatPct(value: number | null): string {
  if (value === null || value === undefined) return "";
  return (value * 100).toFixed(2).replace(".", ",") + "%";
}

function pctClass(value: number | null, lowThreshold: number, highThreshold: number): string {
  if (value === null || value === undefined) return "";
  if (value <= lowThreshold) return "pct-red";
  if (value < highThreshold) return "pct-yellow";
  return "pct-green";
}

function pct(value: number | null | undefined, basis: number): string {
  const v = value ?? 0;
  return `${Math.min(100, Math.max(0, (v / basis) * 100))}%`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return d.toLocaleDateString("cs-CZ");
}
