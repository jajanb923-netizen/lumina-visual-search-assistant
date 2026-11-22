/** Recent analyses, kept in localStorage (thumbnails only, max 8 entries). */

export interface HistoryEntry {
  id: string;
  title: string;
  thumbnail: string; // small data URL
  description: string;
  at: number;
}

const KEY = "lumina.history.v1";
const MAX_ENTRIES = 8;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function saveHistoryEntry(entry: Omit<HistoryEntry, "id" | "at">): HistoryEntry[] {
  const full: HistoryEntry = { ...entry, id: `${Date.now()}`, at: Date.now() };
  const next = [full, ...loadHistory()].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full (large thumbnails) — drop thumbnails and retry once.
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(next.map((e) => ({ ...e, thumbnail: "" }))),
      );
    } catch {
      /* ignore */
    }
  }
  return next;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
