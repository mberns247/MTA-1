"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  type SlotConfig,
  type SlotType,
  type BusOption,
  type NormalizedArrival,
  getOptionsByType,
  getOption,
  getStopsByType,
  getDirectionsForStopNormalized,
  getSubwayStations,
  getPlatformsAtStation,
  getOptionIdsForSlot,
  getSubwayDirectionOnlyLabel,
  getSubwayLineLabel,
  getSubwayHeaderDestination,
  MIN_SLOTS,
  MAX_SLOTS,
  MIN_ARRIVALS,
  MAX_ARRIVALS,
} from "@/lib/transit-options";
import { getLineBadgeColor } from "@/lib/line-colors";

const CONFIG_KEY = "mta-dashboard-config";
const DEFAULT_REFRESH_SEC = 20;
const MIN_REFRESH_SEC = 5;
const MAX_REFRESH_SEC = 120;

const DEFAULT_SLOTS: SlotConfig[] = [
  { type: "subway", optionId: "jz-j30n-0", maxArrivals: 4 },
];

/** 30-min increment time options for sleep window: value "HH:mm", label "h:mm AM/PM" */
const SLEEP_TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const out: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h < 12 ? "AM" : "PM";
      const label = `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
      out.push({ value, label });
    }
  }
  return out;
})();

function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function isInSleepWindow(now: Date, startValue: string, endValue: string): boolean {
  const min = now.getHours() * 60 + now.getMinutes();
  const start = timeToMinutes(startValue);
  const end = timeToMinutes(endValue);
  if (start < end) return min >= start && min < end;
  return min >= start || min < end;
}

export type LayoutType = "grid" | "list" | "page";

export type ThemeMode = "dark" | "light";

type Config = {
  refreshIntervalSec: number;
  slots: SlotConfig[];
  layout: LayoutType;
  theme: ThemeMode;
  largeMode: boolean;
  sleepMode: boolean;
  sleepStart: string;
  sleepEnd: string;
};

const defaultConfig: Config = {
  refreshIntervalSec: DEFAULT_REFRESH_SEC,
  slots: DEFAULT_SLOTS,
  layout: "list",
  theme: "dark",
  largeMode: false,
  sleepMode: false,
  sleepStart: "22:00",
  sleepEnd: "06:00",
};

function loadConfig(): Config {
  if (typeof window === "undefined") return defaultConfig;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaultConfig;
    const parsed = JSON.parse(raw) as Partial<Config> & { refreshIntervalMs?: number; subwayStopOverride?: string; theme?: string; largeMode?: boolean; sleepMode?: boolean; sleepStart?: string; sleepEnd?: string };
    let slots: SlotConfig[] = defaultConfig.slots;
    if (Array.isArray(parsed.slots) && parsed.slots.length >= MIN_SLOTS) {
      slots = parsed.slots.slice(0, MAX_SLOTS).map((s) => {
        const option = getOption(s.optionId);
        const valid = option && option.type === s.type;
        const maxArrivals = Math.min(MAX_ARRIVALS, Math.max(MIN_ARRIVALS, s.maxArrivals ?? 4));
        const base = valid
          ? { type: s.type, optionId: s.optionId, maxArrivals }
          : { type: s.type, optionId: getOptionsByType(s.type)[0]?.id ?? "", maxArrivals };
        const optionIds = getOptionIdsForSlot(base);
        return { ...base, optionIds: optionIds.length > 0 ? optionIds : undefined };
      });
    }
    let refreshIntervalSec = defaultConfig.refreshIntervalSec;
    if (typeof parsed.refreshIntervalSec === "number") {
      refreshIntervalSec = Math.max(MIN_REFRESH_SEC, Math.min(MAX_REFRESH_SEC, parsed.refreshIntervalSec));
    } else if (typeof parsed.refreshIntervalMs === "number") {
      refreshIntervalSec = Math.max(MIN_REFRESH_SEC, Math.min(MAX_REFRESH_SEC, Math.round(parsed.refreshIntervalMs / 1000)));
    }
    const layout =
      parsed.layout === "grid" || parsed.layout === "list" || parsed.layout === "page"
        ? parsed.layout
        : defaultConfig.layout;
    const theme = parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : defaultConfig.theme;
    const largeMode = typeof parsed.largeMode === "boolean" ? parsed.largeMode : defaultConfig.largeMode;
    const sleepMode = typeof parsed.sleepMode === "boolean" ? parsed.sleepMode : defaultConfig.sleepMode;
    const validTime = (s: unknown): s is string => typeof s === "string" && SLEEP_TIME_OPTIONS.some((o) => o.value === s);
    const sleepStart = validTime(parsed.sleepStart) ? parsed.sleepStart : defaultConfig.sleepStart;
    const sleepEnd = validTime(parsed.sleepEnd) ? parsed.sleepEnd : defaultConfig.sleepEnd;
    return {
      refreshIntervalSec,
      slots,
      layout,
      theme,
      largeMode,
      sleepMode,
      sleepStart,
      sleepEnd,
    };
  } catch {
    return defaultConfig;
  }
}

function saveConfig(c: Config) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {}
}

interface ArrivalsResultItem {
  optionId: string;
  label: string;
  type: "subway" | "bus";
  arrivals: NormalizedArrival[];
  alerts?: { header: string; description: string }[];
  error?: string;
}

function filterOptions(options: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((s) => s.toLowerCase().includes(q));
}

export default function DashboardPage() {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flippedModuleIndex, setFlippedModuleIndex] = useState<number | null>(null);
  const [results, setResults] = useState<ArrivalsResultItem[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [liveTime, setLiveTime] = useState(() => new Date());
  const [stationSearch, setStationSearch] = useState<Record<number, string>>({});
  const [stopSearch, setStopSearch] = useState<Record<number, string>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState(0);
  const [sleepModeInfoOpen, setSleepModeInfoOpen] = useState(false);
  const [alertModalSlotIndex, setAlertModalSlotIndex] = useState<number | null>(null);
  const refreshProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setLastUpdated(new Date());
    setFetchError(null);
    if (config.slots.length === 0) {
      setResults([]);
      return;
    }
    try {
      const slotsParam = encodeURIComponent(JSON.stringify(config.slots));
      const res = await fetch(`/api/arrivals?slots=${slotsParam}`);
      const contentType = res.headers.get("content-type") ?? "";
      let data: { results?: ArrivalsResultItem[]; error?: string };
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        setFetchError(res.ok ? "Invalid response from server" : `Error ${res.status}: ${text.slice(0, 80)}`);
        setResults(null);
        return;
      }
      if (!res.ok) {
        setFetchError(data.error || res.statusText);
        setResults(null);
        return;
      }
      setResults(data.results ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed");
      setResults(null);
    }
  }, [config.slots]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const ms = Math.max(5000, config.refreshIntervalSec * 1000);
    const id = setInterval(refresh, ms);
    return () => clearInterval(id);
  }, [config.refreshIntervalSec, refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setConfig(loadConfig());
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", config.theme);
  }, [config.theme]);

  useEffect(() => {
    const id = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const updateConfig = (updates: Partial<Config>) => {
    const next = { ...config, ...updates };
    setConfig(next);
    saveConfig(next);
  };

  const updateSlot = (index: number, updates: Partial<SlotConfig>) => {
    const nextSlots = [...config.slots];
    nextSlots[index] = { ...nextSlots[index], ...updates };
    updateConfig({ slots: nextSlots });
  };

  const addSlot = () => {
    if (config.slots.length >= MAX_SLOTS) return;
    const firstOption = getOptionsByType("subway")[0];
    updateConfig({
      slots: [...config.slots, { type: "subway", optionId: firstOption?.id ?? "jz-gates-manhattan", maxArrivals: 4 }],
    });
  };

  const removeSlot = (index: number) => {
    if (config.slots.length <= MIN_SLOTS) return;
    setFlippedModuleIndex(null);
    const nextSlots = config.slots.filter((_, i) => i !== index);
    updateConfig({ slots: nextSlots });
  };

  const handleRefreshClick = useCallback(() => {
    if (refreshProgressIntervalRef.current) {
      clearInterval(refreshProgressIntervalRef.current);
      refreshProgressIntervalRef.current = null;
    }
    setRefreshProgress(0);
    setIsRefreshing(true);
    const durationMs = 1000;
    const stepMs = 50;
    const step = (100 * stepMs) / durationMs;
    refreshProgressIntervalRef.current = setInterval(() => {
      setRefreshProgress((p) => {
        const next = Math.min(100, p + step);
        if (next >= 100 && refreshProgressIntervalRef.current) {
          clearInterval(refreshProgressIntervalRef.current);
          refreshProgressIntervalRef.current = null;
        }
        return next;
      });
    }, stepMs);
    refresh().then(() => {
      setRefreshProgress(100);
      if (refreshProgressIntervalRef.current) {
        clearInterval(refreshProgressIntervalRef.current);
        refreshProgressIntervalRef.current = null;
      }
      window.setTimeout(() => {
        setIsRefreshing(false);
        setRefreshProgress(0);
      }, 400);
    });
  }, [refresh]);

  const boardStyles = {
    panel: {
      backgroundColor: "var(--board-panel)",
      borderColor: "var(--board-border)",
    },
    border: { borderColor: "var(--board-border)" },
    text: { color: "var(--board-text)" as const },
    textDim: { color: "var(--board-text-dim)" as const },
    accent: { color: "var(--board-accent)" as const },
    error: { color: "var(--error)" as const },
    input: {
      backgroundColor: "var(--board-bg)",
      borderColor: "var(--board-border)",
      color: "var(--board-text)",
    },
  };

  const inSleepWindow =
    config.sleepMode && isInSleepWindow(liveTime, config.sleepStart, config.sleepEnd);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("sleep-mode", inSleepWindow);
    return () => document.documentElement.classList.remove("sleep-mode");
  }, [inSleepWindow]);

  return (
    <main className="min-h-screen w-full px-6 pb-10 pt-4 md:px-12 md:pt-6">
      <div
        className="w-full"
        style={{
          maxWidth:
            config.layout === "list"
              ? "42rem"
              : config.layout === "grid"
                ? "56rem"
                : "90rem",
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        <header
          className="mb-6 flex w-full items-center border-b pb-3"
          style={{ ...boardStyles.border, position: "relative" }}
        >
          <h1 className="text-lg font-bold tracking-tight shrink-0" style={boardStyles.text}>
            MTA Arrival Board
          </h1>
          <h2
            className="m-0 ml-3 shrink-0 tabular-nums text-2xl font-bold"
            style={boardStyles.text}
            suppressHydrationWarning
          >
            {liveTime.toLocaleTimeString()}
          </h2>
          <div
            className="flex items-center gap-1"
            style={{
              position: "absolute",
              right: 0,
              top: "50%",
              transform: "translateY(-50%)",
            }}
          >
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              className="relative flex items-center justify-center rounded p-1.5 focus:outline-none hover:opacity-80 disabled:opacity-90"
              style={{
                color: "var(--board-text)",
                background: "none",
                border: "none",
              }}
              title="Refresh"
              aria-label="Refresh arrivals"
            >
              {isRefreshing && (
                <svg
                  className="absolute inset-0 size-6 -rotate-90"
                  viewBox="0 0 24 24"
                  style={{ color: "var(--board-accent)" }}
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 10}
                    strokeDashoffset={2 * Math.PI * 10 * (1 - refreshProgress / 100)}
                    style={{ transition: "stroke-dashoffset 0.05s linear" }}
                  />
                </svg>
              )}
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="relative">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
            </button>
            {config.slots.length < MAX_SLOTS && (
              <button
                type="button"
                onClick={() => addSlot()}
                className="flex items-center justify-center rounded p-1.5 focus:outline-none hover:opacity-80"
                style={{
                  color: "var(--board-text)",
                  background: "none",
                  border: "none",
                }}
                title="Add module"
                aria-label="Add module"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              className="flex items-center justify-center rounded p-1.5 focus:outline-none hover:opacity-80"
              style={{
                color: "var(--board-text)",
                background: "none",
                border: "none",
              }}
              title="Settings"
              aria-label="Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </header>

        {settingsOpen && (
          <>
            <div className="fixed inset-0 z-20 bg-black/40" role="presentation" onClick={() => setSettingsOpen(false)} />
            <div
              className="fixed left-1/2 top-1/2 z-30 w-full max-w-md max-h-[90vh] -translate-x-1/2 -translate-y-1/2 rounded-xl border shadow-lg overflow-auto"
              style={{ ...boardStyles.panel, ...boardStyles.border }}
              role="dialog"
              aria-labelledby="settings-dialog-title"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b px-4 py-3 sticky top-0 z-10" style={{ ...boardStyles.border, ...boardStyles.panel }}>
                <h2 id="settings-dialog-title" className="text-sm font-semibold" style={boardStyles.text}>
                  Settings
                </h2>
              </div>
              <div className="p-4">
                <div className="flex flex-col" style={{ borderTop: "1px solid var(--board-border)" }}>
                  <div className="flex items-center justify-between gap-4 py-3" style={{ borderBottom: "1px solid var(--board-border)" }}>
                    <span className="text-sm font-medium" style={boardStyles.text}>Large Mode</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm" style={boardStyles.textDim}>Regular</span>
                      <button
                        id="large-mode-toggle"
                        type="button"
                        role="switch"
                        aria-checked={config.largeMode}
                        title={config.largeMode ? "Switch to regular view" : "Switch to large-type view"}
                        onClick={() => updateConfig({ largeMode: !config.largeMode })}
                        className="focus:outline-none focus:ring-2 focus:ring-[var(--board-accent)] focus:ring-offset-2 focus:ring-offset-[var(--board-bg)]"
                        style={{
                          width: 44,
                          height: 24,
                          minWidth: 44,
                          padding: 0,
                          border: "none",
                          borderRadius: 12,
                          cursor: "pointer",
                          backgroundColor: config.largeMode ? "var(--board-accent)" : "var(--board-border)",
                          position: "relative",
                        }}
                      >
                        <span role="presentation" style={{ position: "absolute", top: 2, left: config.largeMode ? 2 : 22, width: 20, height: 20, borderRadius: "50%", backgroundColor: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.2)", transition: "left 0.2s ease" }} />
                      </button>
                      <span className="text-sm" style={boardStyles.textDim}>Large</span>
                    </div>
                  </div>
                  <div className="py-3" style={{ borderBottom: "1px solid var(--board-border)" }}>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm font-medium" style={boardStyles.text}>Sleep Mode</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm" style={boardStyles.textDim}>Off</span>
                        <button
                          id="sleep-mode-toggle"
                  type="button"
                  role="switch"
                  aria-checked={config.sleepMode}
                  title={config.sleepMode ? "Turn off sleep mode" : "Turn on sleep mode"}
                  onClick={() => updateConfig({ sleepMode: !config.sleepMode })}
                  className="focus:outline-none focus:ring-2 focus:ring-[var(--board-accent)] focus:ring-offset-2 focus:ring-offset-[var(--board-bg)]"
                  style={{
                    width: 44,
                    height: 24,
                    minWidth: 44,
                    padding: 0,
                    border: "none",
                    borderRadius: 12,
                    cursor: "pointer",
                    backgroundColor: config.sleepMode ? "var(--board-accent)" : "var(--board-border)",
                    position: "relative",
                  }}
                >
                  <span role="presentation" style={{ position: "absolute", top: 2, left: config.sleepMode ? 2 : 22, width: 20, height: 20, borderRadius: "50%", backgroundColor: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.2)", transition: "left 0.2s ease" }} />
                </button>
                        <span className="text-sm" style={boardStyles.textDim}>On</span>
                        <button
                          type="button"
                          onClick={() => setSleepModeInfoOpen((o) => !o)}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--board-accent)]"
                          style={{ ...boardStyles.border, ...boardStyles.text, backgroundColor: "transparent" }}
                          title="What is Sleep Mode?"
                          aria-label="Sleep Mode info"
                        >
                          i
                        </button>
                      </div>
                    </div>
                {sleepModeInfoOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40 bg-black/40"
                      role="presentation"
                      onClick={() => setSleepModeInfoOpen(false)}
                    />
                    <div
                      className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border p-4 shadow-lg"
                      style={{
                        ...boardStyles.panel,
                        ...boardStyles.border,
                      }}
                      role="dialog"
                      aria-labelledby="sleep-mode-info-title"
                      aria-modal="true"
                    >
                      <h3 id="sleep-mode-info-title" className="mb-2 text-sm font-semibold" style={boardStyles.text}>
                        What is Sleep Mode?
                      </h3>
                      <p className="text-sm" style={boardStyles.textDim}>
                        During the Start–Stop hours you choose, the dashboard is dimmed to 25% brightness. It stays on
                        so you can still see arrivals, but it won’t shine unnecessary light into your home at night.
                      </p>
                      <button
                        type="button"
                        onClick={() => setSleepModeInfoOpen(false)}
                        className="mt-3 rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--board-accent)]"
                        style={boardStyles.input}
                      >
                        OK
                      </button>
                    </div>
                  </>
                )}
                    {config.sleepMode && (
                      <div className="mt-2 flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <label className="text-sm" style={boardStyles.textDim}>Start</label>
                          <select value={config.sleepStart} onChange={(e) => updateConfig({ sleepStart: e.target.value })} className="rounded border px-2 py-1.5 text-sm focus:outline-none" style={boardStyles.input}>
                            {SLEEP_TIME_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-sm" style={boardStyles.textDim}>Stop</label>
                          <select value={config.sleepEnd} onChange={(e) => updateConfig({ sleepEnd: e.target.value })} className="rounded border px-2 py-1.5 text-sm focus:outline-none" style={boardStyles.input}>
                            {SLEEP_TIME_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-4 py-3" style={{ borderBottom: "1px solid var(--board-border)" }}>
                    <span className="text-sm font-medium" style={boardStyles.text}>Theme</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm" style={boardStyles.textDim}>Light</span>
                      <button
                        id="theme-toggle"
                        type="button"
                        role="switch"
                        aria-checked={config.theme === "light"}
                        title={config.theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                        onClick={() => updateConfig({ theme: config.theme === "light" ? "dark" : "light" })}
                        className="focus:outline-none focus:ring-2 focus:ring-[var(--board-accent)] focus:ring-offset-2 focus:ring-offset-[var(--board-bg)]"
                        style={{
                          width: 44,
                          height: 24,
                          minWidth: 44,
                          padding: 0,
                          border: "none",
                          borderRadius: 12,
                          cursor: "pointer",
                          backgroundColor: config.theme === "light" ? "var(--board-accent)" : "var(--board-border)",
                          position: "relative",
                        }}
                      >
                        <span role="presentation" style={{ position: "absolute", top: 2, left: config.theme === "light" ? 2 : 22, width: 20, height: 20, borderRadius: "50%", backgroundColor: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.2)", transition: "left 0.2s ease" }} />
                      </button>
                      <span className="text-sm" style={boardStyles.textDim}>Dark</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-3" style={{ borderBottom: "1px solid var(--board-border)" }}>
                    <span className="text-sm font-medium" style={boardStyles.text}>Layout</span>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => updateConfig({ layout: "grid" })} title="Grid (2×2)" aria-label="Grid view" className="flex h-9 w-9 items-center justify-center rounded border focus:outline-none" style={{ ...boardStyles.input, borderWidth: 2, borderColor: config.layout === "grid" ? "var(--board-accent)" : "var(--board-border)" }}>
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden><rect x="1" y="1" width="8" height="8" rx="1" /><rect x="11" y="1" width="8" height="8" rx="1" /><rect x="1" y="11" width="8" height="8" rx="1" /><rect x="11" y="11" width="8" height="8" rx="1" /></svg>
                      </button>
                      <button type="button" onClick={() => updateConfig({ layout: "list" })} title="List (vertical)" aria-label="List view" className="flex h-9 w-9 items-center justify-center rounded border focus:outline-none" style={{ ...boardStyles.input, borderWidth: 2, borderColor: config.layout === "list" ? "var(--board-accent)" : "var(--board-border)" }}>
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden><rect x="3" y="2" width="14" height="3" rx="1" /><rect x="3" y="6.5" width="14" height="3" rx="1" /><rect x="3" y="11" width="14" height="3" rx="1" /><rect x="3" y="15.5" width="14" height="3" rx="1" /></svg>
                      </button>
                      <button type="button" onClick={() => updateConfig({ layout: "page" })} title="Page (horizontal)" aria-label="Page view" className="flex h-9 w-9 items-center justify-center rounded border focus:outline-none" style={{ ...boardStyles.input, borderWidth: 2, borderColor: config.layout === "page" ? "var(--board-accent)" : "var(--board-border)" }}>
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden><rect x="2" y="4" width="3" height="12" rx="1" /><rect x="6.5" y="4" width="3" height="12" rx="1" /><rect x="11" y="4" width="3" height="12" rx="1" /><rect x="15.5" y="4" width="3" height="12" rx="1" /></svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-3">
                    <label htmlFor="settings-refresh-interval" className="text-sm font-medium" style={boardStyles.text}>Refresh interval (sec)</label>
                    <input
                      id="settings-refresh-interval"
                      type="number"
                      min={MIN_REFRESH_SEC}
                      max={MAX_REFRESH_SEC}
                      step={1}
                      value={config.refreshIntervalSec}
                      onChange={(e) => updateConfig({ refreshIntervalSec: Math.max(MIN_REFRESH_SEC, Math.min(MAX_REFRESH_SEC, parseInt(e.target.value, 10) || DEFAULT_REFRESH_SEC)) })}
                      className="w-20 rounded border px-2 py-1.5 text-right text-sm focus:outline-none"
                      style={boardStyles.input}
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {fetchError && (
          <p className="mb-4 text-sm" style={boardStyles.error}>
            {fetchError}
          </p>
        )}

        <div
          className="arrivals-grid"
          style={{
            display: "grid",
            gap: "2.5rem",
            gridTemplateColumns:
              config.layout === "grid"
                ? "repeat(2, minmax(0, 1fr))"
                : config.layout === "page"
                  ? `repeat(${Math.min(4, Math.max(1, config.slots.length))}, minmax(0, 1fr))`
                  : "1fr",
          }}
        >
          {config.slots.map((slot, index) => {
            const result = results?.[index];
            const option = getOption(slot.optionId);
            const label = option?.label ?? slot.optionId;
            const isSubway = slot.type === "subway";
            const arrivals = result?.arrivals ?? [];
            const error = result?.error;
            const loading = results === null && !fetchError;
            const isSubwaySlot = slot.type === "subway";
            const subwayStations = getSubwayStations();
            const currentStation = option?.type === "subway" ? option.stopLabel : subwayStations[0] ?? "";
            const platforms = getPlatformsAtStation(currentStation);
            const stops = getStopsByType(slot.type);
            const currentStop = option?.stopLabel ?? stops[0] ?? "";
            const directions = getDirectionsForStopNormalized(slot.type, currentStop);

            return (
              <div key={index} className="module-flip-container">
                <div className={`module-flip-inner ${flippedModuleIndex === index ? "is-flipped" : ""}`}>
                  <div className="module-flip-front">
              <section
                className="rounded-xl border overflow-hidden relative h-full flex flex-col min-h-0"
                style={boardStyles.panel}
              >
                <div className="border-b px-6 py-4 flex items-center gap-2 flex-wrap flex-shrink-0" style={boardStyles.border}>
                  {result?.alerts && result.alerts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setAlertModalSlotIndex(index)}
                      className="flex-shrink-0 p-1 rounded focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-[var(--board-bg)] focus:ring-[var(--board-text)]"
                      title="View service alerts"
                      aria-label="View service alerts"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--board-text)" }}>
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    </button>
                  )}
                  {isSubway ? (
                    <h2 className="font-bold" style={{ ...boardStyles.text, fontSize: "1.5rem", fontWeight: 700 }}>
                      {option?.type === "subway"
                        ? (() => {
                            const station = option.stopLabel ?? "—";
                            const line = getSubwayLineLabel(option);
                            const dest = getSubwayHeaderDestination(option);
                            return dest
                              ? `Subway · ${station} · ${line} → ${dest}`
                              : `Subway · ${station} · ${line}`;
                          })()
                        : `Subway · ${option?.stopLabel ?? "—"} · ${label}`}
                    </h2>
                  ) : (
                    <>
                      <h2 className="font-bold" style={{ ...boardStyles.text, fontSize: "1.5rem", fontWeight: 700 }}>
                        Bus – {label.split(" · ")[0] ?? "—"} – {option?.stopLabel ?? ""}
                      </h2>
                      {option?.type === "bus" && (option as BusOption).destinationLabel && (
                        <p className="mt-1 font-semibold w-full" style={{ ...boardStyles.textDim, fontSize: "1rem" }}>
                          {(option as BusOption).destinationLabel}
                        </p>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setFlippedModuleIndex(index)}
                    className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full border focus:outline-none focus:ring-2 focus:ring-[var(--board-accent)]"
                    style={{ ...boardStyles.border, ...boardStyles.text, backgroundColor: "transparent" }}
                    title="Configure this module"
                    aria-label="Configure this module"
                  >
                    <span className="text-sm font-bold">i</span>
                  </button>
                </div>
                {alertModalSlotIndex === index && result?.alerts && result.alerts.length > 0 && (
                  <div
                    className="absolute inset-0 z-10 flex items-center justify-center p-4 rounded-xl"
                    style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
                    role="dialog"
                    onClick={() => setAlertModalSlotIndex(null)}
                    aria-modal="true"
                    aria-labelledby="alert-modal-title"
                  >
                    <div
                      className="rounded-xl border shadow-lg max-h-full overflow-auto"
                      style={{
                        ...boardStyles.panel,
                        maxWidth: "28rem",
                        borderWidth: "2px",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between border-b px-4 py-3" style={boardStyles.border}>
                        <h3 id="alert-modal-title" className="font-bold" style={{ ...boardStyles.text, fontSize: "1.125rem" }}>
                          Service alerts
                        </h3>
                        <button
                          type="button"
                          onClick={() => setAlertModalSlotIndex(null)}
                          className="p-1 rounded focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[var(--board-text)]"
                          aria-label="Close"
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--board-text)" }}> <path d="M18 6L6 18M6 6l12 12" /> </svg>
                        </button>
                      </div>
                      <div className="px-4 py-4 space-y-4">
                        {result.alerts.map((a, i) => (
                          <div key={i}>
                            <p className="font-semibold" style={{ ...boardStyles.text, fontSize: "1rem" }}>{a.header}</p>
                            {a.description && (
                              <p className="mt-1 whitespace-pre-wrap" style={{ ...boardStyles.textDim, fontSize: "0.9375rem" }}>{a.description}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div className="arrival-content flex-1 min-h-0 px-6 py-5 overflow-auto">
                  {error && (
                    <p className="mb-4 text-sm" style={boardStyles.error}>
                      {error}
                    </p>
                  )}
                  {loading && (
                    <p className="py-8 text-sm" style={boardStyles.textDim}>
                      Loading…
                    </p>
                  )}
                  {!loading && arrivals.length === 0 && !error && (
                    <p className="py-8 text-sm" style={boardStyles.textDim}>
                      No arrivals
                    </p>
                  )}
                  {!loading && arrivals.length > 0 && (
                    <table className={`arrival-table ${config.largeMode ? "arrival-table--large" : ""}`}>
                      <tbody>
                        {arrivals.map((a, i) => (
                          <tr key={`${a.route}-${a.minutes}-${i}`}>
                            <td className="col-line">
                              <span
                                className="line-badge"
                                style={{
                                  backgroundColor: getLineBadgeColor(a.route, isSubway),
                                  color: "#fff",
                                }}
                              >
                                {a.route}
                              </span>
                            </td>
                            {!config.largeMode && (
                              <td
                                className="col-direction"
                                style={{ ...boardStyles.text, fontSize: "1.5rem", fontWeight: 700 }}
                              >
                                {isSubway ? (
                                  (a.destination || (option?.directionLabel ?? "").replace(/\s*(Northbound|Southbound)\s*$/i, "").trim() || "—")
                                ) : (
                                  <span style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                                    <span>
                                      {a.progressStatus === "scheduled"
                                        ? "Scheduled"
                                        : (a.stopsAway != null && a.stopsAway > 1)
                                          ? `${a.stopsAway} stops away`
                                          : a.stopsAway === 1
                                            ? "1 stop away"
                                            : (a.destination || option?.directionLabel || "—")}
                                    </span>
                                  </span>
                                )}
                              </td>
                            )}
                            <td className="col-time">
                              <span
                                className="col-time-inner"
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: config.largeMode ? "center" : "flex-end",
                                  gap: "0.125rem",
                                }}
                              >
                                <span
                                  className="tabular-nums block"
                                  style={{
                                    ...boardStyles.text,
                                    fontSize: config.largeMode ? "2.5rem" : "1.5rem",
                                    fontWeight: 700,
                                  }}
                                >
                                  {a.minutes}
                                </span>
                                <span
                                  className="uppercase tracking-wider block"
                                  style={{
                                    ...boardStyles.accent,
                                    fontSize: config.largeMode ? "1.25rem" : "0.75rem",
                                    fontWeight: 700,
                                  }}
                                >
                                  MIN
                                </span>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
                  </div>
                  <div className="module-flip-back rounded-xl border overflow-auto" style={boardStyles.panel}>
                    <div className="border-b px-4 py-3 flex items-center justify-between" style={boardStyles.border}>
                      <span className="text-sm font-semibold" style={boardStyles.text}>Configure module</span>
                      <button type="button" onClick={() => setFlippedModuleIndex(null)} className="rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--board-accent)]" style={boardStyles.input}>Done</button>
                    </div>
                    <div className="p-4 space-y-3">
                      <div>
                        <label className="mb-1 block text-xs" style={boardStyles.textDim}>Type</label>
                        <select value={slot.type} onChange={(e) => { const type = (e.target.value as SlotType); const options = getOptionsByType(type); updateSlot(index, { type, optionId: options[0]?.id ?? "" }); }} className="w-full rounded border px-3 py-2 text-sm focus:outline-none" style={boardStyles.input}>
                          <option value="subway">Subway</option>
                          <option value="bus">Bus</option>
                        </select>
                      </div>
                      {isSubwaySlot ? (
                        <>
                          <div>
                            <label className="mb-1 block text-xs" style={boardStyles.textDim}>Station</label>
                            <input type="text" placeholder="Search stations…" value={stationSearch[index] ?? ""} onChange={(e) => setStationSearch((prev) => ({ ...prev, [index]: e.target.value }))} className="mb-1.5 w-full rounded border px-3 py-2 text-sm focus:outline-none" style={boardStyles.input} />
                            <select value={currentStation} onChange={(e) => { const station = e.target.value; const plats = getPlatformsAtStation(station); const first = plats[0]; if (first) updateSlot(index, { optionId: first.optionIds[0], optionIds: first.optionIds }); else updateSlot(index, { optionId: "", optionIds: undefined }); }} className="w-full rounded border px-3 py-2 text-sm focus:outline-none" style={boardStyles.input}>
                              {(() => { const filtered = filterOptions(subwayStations, stationSearch[index] ?? ""); const list = currentStation && !filtered.includes(currentStation) ? [currentStation, ...filtered] : filtered; return list.map((s) => (<option key={s} value={s}>{s}</option>)); })()}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs" style={boardStyles.textDim}>Platform</label>
                            <select value={platforms.find((c) => c.optionIds.includes(slot.optionId))?.optionIds[0] ?? slot.optionId} onChange={(e) => { const choice = platforms.find((c) => c.optionIds[0] === e.target.value); if (choice) updateSlot(index, { optionId: choice.optionIds[0], optionIds: choice.optionIds }); }} className="w-full rounded border px-3 py-2 text-sm focus:outline-none" style={boardStyles.input}>
                              {platforms.map((p) => (<option key={p.optionIds[0]} value={p.optionIds[0]}>{p.label}</option>))}
                            </select>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <label className="mb-1 block text-xs" style={boardStyles.textDim}>Stop</label>
                            <input type="text" placeholder="Search stops…" value={stopSearch[index] ?? ""} onChange={(e) => setStopSearch((prev) => ({ ...prev, [index]: e.target.value }))} className="mb-1.5 w-full rounded border px-3 py-2 text-sm focus:outline-none" style={boardStyles.input} />
                            <select value={currentStop} onChange={(e) => { const stop = e.target.value; const dirs = getDirectionsForStopNormalized(slot.type, stop); updateSlot(index, { optionId: dirs[0]?.id ?? "" }); }} className="w-full rounded border px-3 py-2 text-sm focus:outline-none" style={boardStyles.input}>
                              {(() => { const filtered = filterOptions(stops, stopSearch[index] ?? ""); const list = currentStop && !filtered.includes(currentStop) ? [currentStop, ...filtered] : filtered; return list.map((s) => (<option key={s} value={s}>{s}</option>)); })()}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs" style={boardStyles.textDim}>Direction</label>
                            <select value={slot.optionId} onChange={(e) => updateSlot(index, { optionId: e.target.value })} className="w-full rounded border px-3 py-2 text-sm focus:outline-none" style={boardStyles.input}>
                              {directions.map((d) => (<option key={d.id} value={d.id}>{d.label}{d.type === "bus" && d.destinationLabel ? ` → ${d.destinationLabel}` : ""}</option>))}
                            </select>
                          </div>
                        </>
                      )}
                      <div className="flex items-center gap-3">
                        <div>
                          <label className="mb-1 block text-xs" style={boardStyles.textDim}># Arrivals</label>
                          <select value={slot.maxArrivals} onChange={(e) => updateSlot(index, { maxArrivals: parseInt(e.target.value, 10) })} className="w-full rounded border px-3 py-2 text-sm focus:outline-none" style={boardStyles.input}>
                            {[1, 2, 3, 4].map((n) => (<option key={n} value={n}>{n}</option>))}
                          </select>
                        </div>
                        <button type="button" onClick={() => removeSlot(index)} disabled={config.slots.length <= MIN_SLOTS} className="text-sm underline focus:outline-none disabled:opacity-50 self-end" style={config.theme === "dark" ? { color: "#60a5fa" } : boardStyles.accent}>Remove</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
