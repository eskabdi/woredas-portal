export interface ReportPreset {
  id: string;
  name: string;
  start: string;
  end: string;
  tab: string;
}

const KEY = "woreda.reportPresets.v1";

export function loadPresets(): ReportPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is ReportPreset =>
        !!p && typeof p.id === "string" && typeof p.name === "string" && typeof p.start === "string",
    );
  } catch {
    return [];
  }
}

export function savePresets(presets: ReportPreset[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(presets));
  } catch {
    /* storage unavailable — presets stay in memory only */
  }
}
