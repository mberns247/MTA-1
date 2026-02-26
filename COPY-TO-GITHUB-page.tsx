"use client";

import { useEffect, useState, useCallback } from "react";

const CONFIG_KEY = "mta-dashboard-config";
const DEFAULT_REFRESH_MS = 20000;

type Config = {
  refreshIntervalMs: number;
  subwayStopOverride: "auto" | "J30N" | "J30S";
};

const defaultConfig: Config = {
  refreshIntervalMs: DEFAULT_REFRESH_MS,
  subwayStopOverride: "auto",
};

function loadConfig(): Config {
  if (typeof window === "undefined") return defaultConfig;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaultConfig;
    const parsed = JSON.parse(raw) as Partial<Config>;
    return {
      refreshIntervalMs: parsed.refreshIntervalMs ?? defaultConfig.refreshIntervalMs,
      subwayStopOverride: parsed.subwayStopOverride ?? defaultConfig.subwayStopOverride,
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

interface BusArrival {
  route: string;
  destination?: string;
  expectedInMin: number;
}

interface SubwayArrival {
  route: string;
  destination?: string;
  arrivalInMin: number;
  stopId: string;
}

export default function DashboardPage() {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [configOpen, setConfigOpen] = useState(false);
  const [bus, setBus] = useState<{ arrivals: BusArrival[]; error?: string } | null>(null);
  const [subway, setSubway] = useState<{
    arrivals: SubwayArrival[];
    stopId?: string;
    error?: string;
  } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchBus = useCallback(async () => {
    try {
      const res = await fetch("/api/bus");
      const data = await res.json();
      if (!res.ok) {
        setBus({ arrivals: [], error: data.error || res.statusText });
        return;
      }
      setBus({ arrivals: data.arrivals ?? [], error: undefined });
    } catch (e) {
      setBus({ arrivals: [], error: e instanceof Error ? e.message : "Failed" });
    }
  }, []);

  const fetchSubway = useCallback(async () => {
    const stopParam =
      config.subwayStopOverride !== "auto" ? `?stopId=${config.subwayStopOverride}` : "";
    try {
      const res = await fetch(`/api/subway${stopParam}`);
      const data = await res.json();
      if (!res.ok) {
        setSubway({ arrivals: [], error: data.error || res.statusText });
        return;
      }
      setSubway({
        arrivals: data.arrivals ?? [],
        stopId: data.stopId,
        error: undefined,
      });
    } catch (e) {
      setSubway({
        arrivals: [],
        error: e instanceof Error ? e.message : "Failed",
      });
    }
  }, [config.subwayStopOverride]);

  const refresh = useCallback(() => {
    setLastUpdated(new Date());
    fetchBus();
    fetchSubway();
  }, [fetchBus, fetchSubway]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const ms = Math.max(5000, config.refreshIntervalMs);
    const id = setInterval(refresh, ms);
    return () => clearInterval(id);
  }, [config.refreshIntervalMs, refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setConfig(loadConfig());
  }, []);

  const updateConfig = (updates: Partial<Config>) => {
    const next = { ...config, ...updates };
    setConfig(next);
    saveConfig(next);
  };

  return (
    <main className="min-h-screen w-full px-6 pb-10 pt-4 md:px-12 md:pt-6">
      <div
        className="w-full"
        style={{ maxWidth: "42rem", marginLeft: "auto", marginRight: "auto" }}
      >
        {/* Board-style header: title + live clock + config */}
        <header
          className="mb-6 flex items-center justify-between border-b pb-3"
          style={{ borderColor: "var(--board-border)" }}
        >
          <h1 className="text-lg font-bold tracking-tight" style={{ color: "var(--board-text)" }}>
            MTA Arrival Board
          </h1>
          <div className="flex items-center gap-4">
            {lastUpdated && (
              <span className="text-sm tabular-nums" style={{ color: "var(--board-text-dim)" }}>
                {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              onClick={() => setConfigOpen((o) => !o)}
              className="text-sm underline focus:outline-none"
              style={{ color: "var(--board-accent)" }}
            >
              Config
            </button>
          </div>
        </header>

        {configOpen && (
          <section
            className="mb-6 rounded-lg border p-4"
            style={{
              backgroundColor: "var(--board-panel)",
              borderColor: "var(--board-border)",
            }}
          >
            <h2 className="mb-3 text-sm font-semibold" style={{ color: "var(--board-text-dim)" }}>
              Settings
            </h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs" style={{ color: "var(--board-text-dim)" }}>
                  Subway platform (Gates Av)
                </label>
                <select
                  value={config.subwayStopOverride}
                  onChange={(e) =>
                    updateConfig({
                      subwayStopOverride: e.target.value as Config["subwayStopOverride"],
                    })
                  }
                  className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                  style={{
                    backgroundColor: "var(--board-bg)",
                    borderColor: "var(--board-border)",
                    color: "var(--board-text)",
                  }}
                >
                  <option value="auto">Auto (most arrivals)</option>
                  <option value="J30N">J30N</option>
                  <option value="J30S">J30S</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: "var(--board-text-dim)" }}>
                  Refresh interval (ms)
                </label>
                <input
                  type="number"
                  min={5000}
                  max={120000}
                  step={5000}
                  value={config.refreshIntervalMs}
                  onChange={(e) =>
                    updateConfig({
                      refreshIntervalMs: Math.max(5000, parseInt(e.target.value, 10) || 20000),
                    })
                  }
                  className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                  style={{
                    backgroundColor: "var(--board-bg)",
                    borderColor: "var(--board-border)",
                    color: "var(--board-text)",
                  }}
                />
              </div>
            </div>
          </section>
        )}

        <div className="grid gap-10 sm:grid-cols-1">
          {/* Subway tile – countdown board style */}
          <section
            className="rounded-xl border overflow-hidden"
            style={{
              backgroundColor: "var(--board-panel)",
              borderColor: "var(--board-border)",
            }}
          >
            <div
              className="border-b px-6 py-4"
              style={{ borderColor: "var(--board-border)" }}
            >
              <h2 className="font-bold" style={{ color: "var(--board-text)", fontSize: "1.5rem", fontWeight: 700 }}>
                Subway · Gates Av
              </h2>
              <p className="font-bold mt-1" style={{ color: "var(--board-text-dim)", fontSize: "1.5rem", fontWeight: 700 }}>
                J/Z · Manhattan
                {subway?.stopId && ` · Platform ${subway.stopId}`}
              </p>
            </div>
            <div className="px-6 py-5">
              {subway?.error && (
                <p className="mb-4 text-sm" style={{ color: "var(--error)" }}>
                  {subway.error}
                </p>
              )}
              {(subway?.arrivals ?? []).length === 0 && !subway?.error && (
                <p className="py-8 text-sm" style={{ color: "var(--board-text-dim)" }}>
                  Loading…
                </p>
              )}
              {(subway?.arrivals ?? []).length === 0 && subway?.error && (
                <p className="py-8 text-sm" style={{ color: "var(--board-text-dim)" }}>
                  No arrivals
                </p>
              )}
              {(subway?.arrivals ?? []).length > 0 && (
                <table className="arrival-table">
                  <tbody>
                    {(subway?.arrivals ?? []).map((a, i) => (
                      <tr key={`${a.route}-${a.arrivalInMin}-${i}`}>
                        <td className="col-line">
                          <span className="line-badge line-badge--subway">{a.route}</span>
                        </td>
                        <td className="col-direction" style={{ color: "var(--board-text)", fontSize: "1.5rem", fontWeight: 700 }}>
                          Manhattan
                        </td>
                        <td className="col-time">
                          <span className="inline-flex items-baseline">
                            <span className="tabular-nums" style={{ color: "var(--board-text)", fontSize: "1.5rem", fontWeight: 700 }}>
                              {a.arrivalInMin}
                            </span>
                            {' '}
                            <span className="uppercase tracking-wider" style={{ color: "var(--board-accent)", fontSize: "0.75rem", fontWeight: 700 }}>
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

          {/* Bus tile */}
          <section
            className="rounded-xl border overflow-hidden"
            style={{
              backgroundColor: "var(--board-panel)",
              borderColor: "var(--board-border)",
            }}
          >
            <div
              className="border-b px-6 py-4"
              style={{ borderColor: "var(--board-border)" }}
            >
              <h2 className="font-bold" style={{ color: "var(--board-text)", fontSize: "1.5rem", fontWeight: 700 }}>
                Bus · B52
              </h2>
              <p className="font-bold mt-1" style={{ color: "var(--board-text-dim)", fontSize: "1.5rem", fontWeight: 700 }}>
                Gates Ave & Evergreen Ave · East / Ridgewood
              </p>
            </div>
            <div className="px-6 py-5">
              {bus?.error && (
                <p className="mb-4 text-sm" style={{ color: "var(--error)" }}>
                  {bus.error}
                </p>
              )}
              {(bus?.arrivals ?? []).length === 0 && !bus?.error && (
                <p className="py-8 text-sm" style={{ color: "var(--board-text-dim)" }}>
                  Loading…
                </p>
              )}
              {(bus?.arrivals ?? []).length === 0 && bus?.error && (
                <p className="py-8 text-sm" style={{ color: "var(--board-text-dim)" }}>
                  No arrivals
                </p>
              )}
              {(bus?.arrivals ?? []).length > 0 && (
                <table className="arrival-table">
                  <tbody>
                    {(bus?.arrivals ?? []).map((a, i) => (
                      <tr key={`${a.route}-${a.expectedInMin}-${i}`}>
                        <td className="col-line">
                          <span className="line-badge line-badge--bus">B-52</span>
                        </td>
                        <td className="col-direction" style={{ color: "var(--board-text)", fontSize: "1.5rem", fontWeight: 700 }}>
                          East / Ridgewood
                        </td>
                        <td className="col-time">
                          <span className="inline-flex items-baseline">
                            <span className="tabular-nums" style={{ color: "var(--board-text)", fontSize: "1.5rem", fontWeight: 700 }}>
                              {a.expectedInMin}
                            </span>
                            {' '}
                            <span className="uppercase tracking-wider" style={{ color: "var(--board-accent)", fontSize: "0.75rem", fontWeight: 700 }}>
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
      </div>
    </main>
  );
}
