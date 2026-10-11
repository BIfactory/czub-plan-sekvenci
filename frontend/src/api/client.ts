import type {
  ClientSettings,
  DivergenceItem,
  LastSync,
  Me,
  NodeDefinition,
  NodeSummary,
  OverPlanItem,
  ProducedItem,
  ProducedSummary,
  SaHistoryEntry,
  SequenceDetailHeader,
  SerialNumberItem,
  WorkplanFilters,
  WorkplanListResult,
  XSuffixItem,
} from "./types";

// V produkci bezi backend jako vnorena IIS aplikace pod "api" (viz nasazeni),
// takze mimo dev je potreba pripojit i base cestu appky + jeji alias.
// V devu proxy ve vite.config.ts presmeruje "/api" primo na backend, beze zmeny.
const API_PREFIX = import.meta.env.DEV ? "" : `${import.meta.env.BASE_URL}api`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PREFIX}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.title) message = body.title;
    } catch {
      // odpoved bez JSON tela
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function buildQuery(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const api = {
  me: () => request<Me>("/auth/me"),
  clientSettings: () => request<ClientSettings>("/config"),

  nodes: () => request<NodeDefinition[]>("/reference/nodes"),
  reasons: () => request<string[]>("/reference/reasons"),
  lastSync: () => request<LastSync>("/reference/last-sync"),
  availableDates: () => request<string[]>("/reference/available-dates"),
  nodeSummary: (node?: string, rgid?: string) =>
    request<NodeSummary>(`/reference/node-summary${buildQuery({ node, rgid })}`),
  saHistory: (node?: string) =>
    request<SaHistoryEntry[]>(`/reference/sa-history${buildQuery({ node })}`),

  workplan: (filters: WorkplanFilters) =>
    request<WorkplanListResult>(`/workplan${buildQuery(filters)}`),
  workplanRgids: (params: { plant?: string; dept?: string; node?: string; teamLeader?: string }) =>
    request<string[]>(`/workplan/rgids${buildQuery(params)}`),
  workplanInfs: () => request<string[]>("/workplan/infs"),
  workplanGunFamilies: () => request<string[]>("/workplan/gun-families"),
  setFixed: (idJobSuffixOper: string, fixed: boolean) =>
    request<void>(`/workplan/${encodeURIComponent(idJobSuffixOper)}/fixed`, {
      method: "PATCH",
      body: JSON.stringify({ fixed }),
    }),
  setSelected: (idJobSuffixOper: string, selected: boolean) =>
    request<void>(`/workplan/${encodeURIComponent(idJobSuffixOper)}/selected`, {
      method: "PATCH",
      body: JSON.stringify({ selected }),
    }),
  submitWorkplanReason: (idJobSuffixOper: string, node: string | undefined, reason: string, note: string) =>
    request<void>(`/workplan/${encodeURIComponent(idJobSuffixOper)}/reason${buildQuery({ node })}`, {
      method: "POST",
      body: JSON.stringify({ reason, note }),
    }),
  workplanDetail: (idJobSuffix: string) =>
    request<SequenceDetailHeader>(`/workplan/${encodeURIComponent(idJobSuffix)}/detail`),
  workplanSerialNumbers: (idJobSuffixOper: string) =>
    request<SerialNumberItem[]>(`/workplan/${encodeURIComponent(idJobSuffixOper)}/serial-numbers`),
  workplanDivergence: (job: string, suffix: number) =>
    request<DivergenceItem[]>(`/workplan/${encodeURIComponent(job)}/${suffix}/divergence`),
  workplanXSuffix: (idJobSuffixOper: string) =>
    request<XSuffixItem[]>(`/workplan/${encodeURIComponent(idJobSuffixOper)}/x-suffix`),

  produced: (params: { date?: string; node?: string; rgid?: string }) =>
    request<ProducedItem[]>(`/produced${buildQuery(params)}`),
  producedRgids: (node?: string) => request<string[]>(`/produced/rgids${buildQuery({ node })}`),
  // Radek se identifikuje klicem idJobSuffixOper + node + date (ne id - t_workplan_produced
  // se behem dne TRUNCATE-uje a id se meni), date je datum zapisu z radku, ne z filtru.
  submitProducedReason: (
    key: { idJobSuffixOper: string; node: string; date: string },
    reason: string,
    note: string,
  ) =>
    request<void>("/produced/reason", {
      method: "POST",
      body: JSON.stringify({ ...key, reason, note }),
    }),
  producedOverPlan: (params: { date?: string; node?: string; rgid?: string }) =>
    request<OverPlanItem[]>(`/produced/overplan${buildQuery(params)}`),
  producedSummary: (params: { date?: string; node?: string; rgid?: string }) =>
    request<ProducedSummary>(`/produced/summary${buildQuery(params)}`),
};
