/**
 * @file High-density dashboard chart card visualizing sensitive Chrome activity metrics.
 *
 * Hand-rolled using SVG stacked area/line paths, avoiding heavy charting dependencies.
 * Visualizes DLP triggers and threat insights trends stacked over time, collapsing completely when empty.
 */

"use client";

import { useCallback, useState, useId } from "react";
import useSWR from "swr";
import { Sparkles } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { authAwareFetch } from "@/lib/auth-aware-fetch";
import { DASHBOARD_QUERY_PREFIX } from "@/lib/constants";
import type { ChartPoint } from "@/app/api/insights/sensitive-activity/route";

type ApiResponse = {
  chartData?: ChartPoint[];
};

/**
 * Properties for the SensitiveActivityChartCard component.
 */
export type SensitiveActivityChartCardProps = {
  /** Selected user email or empty string for customer-wide view. */
  selectedUser: string;
  /** Callback to dispatch a trend analysis query to the chat input. */
  onAskFollowUp?: (promptText: string) => void;
};

/**
 * Renders a stacked area trend chart displaying sensitive Chrome security activity (DLP triggers and threats).
 * The chart collapses completely when no activity is present, and includes exact linear-interpolated
 * segment hover isolation highlights and snapping guide lines.
 */
export function SensitiveActivityChartCard({
  selectedUser,
  onAskFollowUp,
}: SensitiveActivityChartCardProps) {
  const [hoveredSegment, setHoveredSegment] = useState<"dlp" | "threat" | null>(null);
  const [activeDayIndex, setActiveDayIndex] = useState<number | null>(null);
  const dlpClipId = useId();
  const threatClipId = useId();
  const aboveClipId = useId();

  const fetcher = useCallback(async ([url, user]: [string, string]): Promise<ApiResponse> => {
    const params = new URLSearchParams();
    params.set("days", "7");
    if (user) params.set("selectedUser", user);

    const response = await authAwareFetch(`${url}?${params.toString()}`);
    if (!response.ok) {
      throw new Error("Failed to fetch sensitive activity metrics");
    }
    return response.json();
  }, []);

  const { data, isLoading, error } = useSWR(
    ["/api/insights/sensitive-activity", selectedUser],
    fetcher,
    { revalidateOnFocus: false, errorRetryCount: 1 },
  );

  if (isLoading) {
    return (
      <div className="surface-raised border-on-surface/10 flex flex-col gap-4 rounded-[var(--radius-md)] border p-4">
        <Skeleton className="h-4 w-44" />
        <div className="flex h-28 items-end gap-3 px-2 pt-4">
          <Skeleton className="h-8 flex-1" />
          <Skeleton className="h-12 flex-1" />
          <Skeleton className="h-6 flex-1" />
          <Skeleton className="h-16 flex-1" />
          <Skeleton className="h-20 flex-1" />
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-14 flex-1" />
        </div>
      </div>
    );
  }

  if (error || !data?.chartData) {
    return null; // hide on connection failures or empty responses
  }

  const chartData = data.chartData;
  const totalEvents = chartData.reduce((acc, curr) => acc + curr.dlpCount + curr.threatCount, 0);

  // Requirement: "Dont show if empty"
  if (totalEvents === 0) {
    return null;
  }

  const promptText = `${DASHBOARD_QUERY_PREFIX} "Data Protection and Threat Protection events across the organization over the last 7 days."\n\nCan you tell me about this?`;

  // Find max combined total count to normalize stacked heights
  const maxEvents = Math.max(
    ...chartData.map((d) => d.dlpCount + d.threatCount),
    4, // fallback base limit to avoid huge spikes for a single event
  );

  const chartHeightPx = 112; // h-28 matches 112px

  const totalDlpCount = chartData.reduce((acc, curr) => acc + curr.dlpCount, 0);
  const totalThreatCount = chartData.reduce((acc, curr) => acc + curr.threatCount, 0);

  // SVG coordinate configuration
  const N = chartData.length;
  const paddingX = 28;
  const paddingY = 16;
  const svgWidth = 500;
  const svgHeight = 120;
  const stepX = (svgWidth - 2 * paddingX) / (N - 1);

  // Stacked coordinate math with minimum height visual floors:
  const usableHeight = svgHeight - 2 * paddingY;
  const minHeight = 6; // minimum height in SVG units for non-zero data points

  // Pre-calculate heights for each day using remainder-based distribution to respect floors and keep total bound
  const segmentHeights = chartData.map((d) => {
    let hDlp = 0;
    let hThreat = 0;

    if (d.dlpCount > 0 || d.threatCount > 0) {
      const total = d.dlpCount + d.threatCount;
      const hTotal = Math.max((total / maxEvents) * usableHeight, minHeight);

      if (d.dlpCount > 0 && d.threatCount > 0) {
        if (hTotal < 2 * minHeight) {
          hDlp = minHeight;
          hThreat = minHeight;
        } else {
          const pDlp = (d.dlpCount / maxEvents) * usableHeight;
          const pThreat = (d.threatCount / maxEvents) * usableHeight;

          if (pDlp < minHeight) {
            hDlp = minHeight;
            hThreat = hTotal - minHeight;
          } else if (pThreat < minHeight) {
            hThreat = minHeight;
            hDlp = hTotal - minHeight;
          } else {
            hDlp = pDlp;
            hThreat = pThreat;
          }
        }
      } else if (d.dlpCount > 0) {
        hDlp = hTotal;
      } else if (d.threatCount > 0) {
        hThreat = hTotal;
      }
    }

    return { hDlp, hThreat };
  });

  // Base segment = DLP triggers
  const dlpPoints = chartData.map((d, i) => {
    const x = paddingX + i * stepX;
    const { hDlp } = segmentHeights[i];
    const y = svgHeight - paddingY - hDlp;
    return { x, y };
  });

  // Top segment = DLP + Threat total
  const totalPoints = chartData.map((d, i) => {
    const x = paddingX + i * stepX;
    const { hDlp, hThreat } = segmentHeights[i];
    const y = svgHeight - paddingY - (hDlp + hThreat);
    return { x, y };
  });

  // Flat baseline coordinates to bound DLP polygon bottom
  const baselinePoints = dlpPoints.map((p) => ({ x: p.x, y: svgHeight - paddingY }));

  // Calculated bottom boundary for Threat segment (no offset to ensure regions touch directly)
  const threatBottomPoints = dlpPoints;

  // Standalone polygon path for the stacked Threat segment (bounds exactly between threatBottomPoints and totalPoints)
  const topPath = totalPoints.map((p) => `L ${p.x} ${p.y}`).join(" ");
  const bottomPath = [...threatBottomPoints]
    .reverse()
    .map((p) => `L ${p.x} ${p.y}`)
    .join(" ");
  const threatPathD = `M ${threatBottomPoints[0].x} ${threatBottomPoints[0].y} ${topPath} L ${threatBottomPoints[threatBottomPoints.length - 1].x} ${threatBottomPoints[threatBottomPoints.length - 1].y} ${bottomPath} Z`;

  // Base polygon path for DLP segment (bounds from baseline to dlpPoints)
  const dlpPathD = `M ${dlpPoints[0].x} ${svgHeight - paddingY} ${dlpPoints.map((p) => `L ${p.x} ${p.y}`).join(" ")} L ${dlpPoints[dlpPoints.length - 1].x} ${svgHeight - paddingY} Z`;

  // Outline paths: build outlines only where segments rise above their bottom boundaries (no strokes flat on the floor)
  const dlpOutlineD = buildOutlinePath(
    dlpPoints,
    baselinePoints,
    chartData.map((d) => d.dlpCount),
    0,
  );
  const threatOutlineD = buildOutlinePath(
    totalPoints,
    threatBottomPoints,
    chartData.map((d) => d.threatCount),
    0,
  );

  const totalLinePathD = totalPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  const abovePathD = [
    `M ${paddingX} 0`,
    `L ${svgWidth - paddingX} 0`,
    ...[...totalPoints].reverse().map((p) => `L ${p.x} ${p.y}`),
    "Z",
  ].join(" ");

  return (
    <section
      aria-label="Sensitive Chrome Activity chart visualization"
      className="surface-raised border-on-surface/10 flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
    >
      <header className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h3 className="text-on-surface text-sm font-semibold">Sensitive Chrome Activity</h3>
          </div>
          <div className="flex items-center gap-3">
            {/* Legend indicating stacked cumulative layout */}
            <div className="flex items-center gap-3 text-[0.625rem] font-medium">
              <span
                className="flex cursor-pointer items-center gap-1 transition-opacity select-none"
                onMouseEnter={() => setHoveredSegment("threat")}
                onMouseLeave={() => setHoveredSegment(null)}
                style={{ opacity: hoveredSegment === "dlp" ? 0.4 : 1 }}
              >
                <span className="bg-error size-1.5 rounded-full" />
                <span className="text-on-surface-variant">Threat Protection Events</span>
              </span>
              <span
                className="flex cursor-pointer items-center gap-1 transition-opacity select-none"
                onMouseEnter={() => setHoveredSegment("dlp")}
                onMouseLeave={() => setHoveredSegment(null)}
                style={{ opacity: hoveredSegment === "threat" ? 0.4 : 1 }}
              >
                <span className="bg-primary size-1.5 rounded-full" />
                <span className="text-on-surface-variant">Data Protection Events</span>
              </span>
            </div>

            {onAskFollowUp && (
              <button
                type="button"
                onClick={() => onAskFollowUp(promptText)}
                title="Analyze trend with AI"
                className="state-layer text-on-surface-variant/50 hover:text-on-surface-variant/80 hover:bg-on-surface/5 grid size-7 place-items-center rounded-full transition-colors"
              >
                <Sparkles className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        <p className="text-on-surface-variant text-[0.6875rem] leading-4">
          Data Protection and Threat Protection events logged over the last 7 days
        </p>
      </header>

      <div className="relative">
        {/* Y-axis Labels (HTML overlays for consistent font rendering) */}
        <div className="text-on-surface-muted pointer-events-none text-[0.625rem] font-medium select-none">
          <span
            className="absolute -translate-x-full -translate-y-1/2"
            style={{
              top: `${(paddingY / svgHeight) * 100}%`,
              left: `${((paddingX - 6) / svgWidth) * 100}%`,
            }}
          >
            {maxEvents}
          </span>
          <span
            className="absolute -translate-x-full -translate-y-1/2"
            style={{
              top: `${((svgHeight - paddingY) / svgHeight) * 100}%`,
              left: `${((paddingX - 6) / svgWidth) * 100}%`,
            }}
          >
            0
          </span>
        </div>

        {/* SVG Background Area & Lines */}
        <div style={{ height: `${chartHeightPx}px` }} className="relative w-full">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="block h-full w-full"
            preserveAspectRatio="none"
          >
            <defs>
              <clipPath id={dlpClipId}>
                <path d={dlpPathD} />
              </clipPath>
              <clipPath id={threatClipId}>
                <path d={threatPathD} />
              </clipPath>
              <clipPath id={aboveClipId}>
                <path d={abovePathD} />
              </clipPath>
            </defs>
            {/* Horizontal Grid lines */}
            <line
              x1={paddingX}
              y1={paddingY}
              x2={svgWidth - paddingX}
              y2={paddingY}
              className="stroke-on-surface/15"
              strokeDasharray="3 3"
            />
            <line
              x1={paddingX}
              y1={svgHeight / 2}
              x2={svgWidth - paddingX}
              y2={svgHeight / 2}
              className="stroke-on-surface/15"
              strokeDasharray="3 3"
            />
            <line
              x1={paddingX}
              y1={svgHeight - paddingY}
              x2={svgWidth - paddingX}
              y2={svgHeight - paddingY}
              className="stroke-on-surface/10"
            />

            {/* 1. Threat Segment (Fill + Outline, rendered bottom-most) */}
            <g
              className="transition-opacity duration-200"
              style={{ opacity: hoveredSegment === "dlp" ? 0.2 : 1 }}
            >
              {totalThreatCount > 0 && totalPoints.length > 1 && (
                <path d={threatPathD} fill="#d93025" fillOpacity="0.8" stroke="none" />
              )}
              {totalThreatCount > 0 && threatOutlineD && hoveredSegment === "threat" && (
                <path
                  d={threatOutlineD}
                  fill="none"
                  stroke="#d93025"
                  strokeWidth="3"
                  clipPath={`url(#${threatClipId})`}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
            </g>

            {/* 2. DLP Segment (Fill + Outline, rendered on top) */}
            <g
              className="transition-opacity duration-200"
              style={{ opacity: hoveredSegment === "threat" ? 0.2 : 1 }}
            >
              {totalDlpCount > 0 && dlpPoints.length > 1 && (
                <path d={dlpPathD} fill="#1a73e8" fillOpacity="0.8" stroke="none" />
              )}
              {totalDlpCount > 0 && dlpOutlineD && hoveredSegment === "dlp" && (
                <path
                  d={dlpOutlineD}
                  fill="none"
                  stroke="#1a73e8"
                  strokeWidth="3"
                  clipPath={`url(#${dlpClipId})`}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
            </g>

            {/* 3. Total Line */}
            {totalPoints.length > 1 && (
              <path
                d={totalLinePathD}
                fill="none"
                className="stroke-on-surface transition-opacity duration-200"
                strokeWidth="3.5"
                style={{ opacity: hoveredSegment !== null ? 0.35 : 1 }}
                clipPath={`url(#${aboveClipId})`}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {/* 4. Vertical Hover Guide Line */}
            {activeDayIndex !== null && (
              <line
                x1={paddingX + activeDayIndex * stepX}
                y1={paddingY}
                x2={paddingX + activeDayIndex * stepX}
                y2={svgHeight - paddingY}
                className="stroke-on-surface/50 pointer-events-none"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
            )}
          </svg>
        </div>

        {/* Foreground Interactive Columns & Tooltips */}
        <div className="absolute inset-0">
          {chartData.map((d, index) => {
            const total = d.dlpCount + d.threatCount;
            const leftPercent = ((paddingX + index * stepX) / svgWidth) * 100;
            const widthPercent = (stepX / svgWidth) * 100;

            return (
              <div
                key={index}
                className="group absolute flex flex-col items-center justify-end"
                style={{
                  left: `${leftPercent}%`,
                  width: `${widthPercent}%`,
                  transform: "translateX(-50%)",
                  height: "100%",
                }}
                onMouseEnter={() => {
                  setActiveDayIndex(index);
                }}
                onMouseMove={(e) => {
                  setActiveDayIndex(index);
                  const parentRect = e.currentTarget.parentElement?.getBoundingClientRect();
                  if (!parentRect) return;

                  const relativeX = e.clientX - parentRect.left;
                  const svgX = (relativeX / parentRect.width) * svgWidth;

                  const relativeY = e.clientY - parentRect.top;
                  const svgY = (relativeY / parentRect.height) * svgHeight;

                  // Find which segment interval svgX falls in
                  const floatIdx = (svgX - paddingX) / stepX;
                  const idx1 = Math.max(0, Math.min(N - 2, Math.floor(floatIdx)));
                  const idx2 = idx1 + 1;

                  const x1 = paddingX + idx1 * stepX;
                  const x2 = paddingX + idx2 * stepX;
                  const t = Math.max(0, Math.min(1, (svgX - x1) / (x2 - x1))); // clamp interpolation factor to [0, 1]

                  // Interpolate the DLP y-coordinate
                  const dlpY1 = dlpPoints[idx1].y;
                  const dlpY2 = dlpPoints[idx2].y;
                  const dlpY = dlpY1 + t * (dlpY2 - dlpY1);

                  // Interpolate the Total y-coordinate
                  const totalY1 = totalPoints[idx1].y;
                  const totalY2 = totalPoints[idx2].y;
                  const totalY = totalY1 + t * (totalY2 - totalY1);

                  // Check if there is active volume in this segment interval
                  const hasThreatVolume =
                    chartData[idx1].threatCount > 0 || chartData[idx2].threatCount > 0;
                  const hasDlpVolume = chartData[idx1].dlpCount > 0 || chartData[idx2].dlpCount > 0;

                  if (svgY >= totalY && svgY < dlpY && hasThreatVolume) {
                    setHoveredSegment("threat");
                  } else if (svgY >= dlpY && svgY <= svgHeight - paddingY && hasDlpVolume) {
                    setHoveredSegment("dlp");
                  } else {
                    setHoveredSegment(null);
                  }
                }}
                onMouseLeave={() => {
                  setHoveredSegment(null);
                  setActiveDayIndex(null);
                }}
              >
                {/* Date Label under x-axis */}
                <span className="text-on-surface-muted group-hover:text-on-surface absolute top-[100px] text-[0.625rem] font-medium transition-colors select-none">
                  {d.date}
                </span>

                {/* CSS Tooltip resolving all ambiguity with stacked metrics */}
                <div className="bg-surface border-on-surface/10 text-on-surface pointer-events-none absolute bottom-full left-1/2 z-20 mb-2.5 w-48 -translate-x-1/2 rounded-[var(--radius-xs)] border px-2.5 py-1.5 text-[0.6875rem] font-medium opacity-0 shadow-[var(--shadow-elevation-2)] transition-opacity group-hover:opacity-100">
                  <p className="border-on-surface/5 mb-1.5 border-b pb-1 font-semibold">{d.date}</p>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="bg-error size-2 rounded-full" />
                        <span>Threat Protection Events</span>
                      </span>
                      <span className="font-mono">{d.threatCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="bg-primary size-2 rounded-full" />
                        <span>Data Protection Events</span>
                      </span>
                      <span className="font-mono">{d.dlpCount}</span>
                    </div>
                    <div className="border-on-surface/5 mt-1 flex items-center justify-between border-t pt-1 font-semibold">
                      <span>Total</span>
                      <span className="font-mono">{total}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * Custom outline path builder that generates strokes wrapping only the non-zero mountain areas.
 * Bypasses segments lying flat on the baseline/bottom boundaries to prevent outline clutter on zero values.
 */
function buildOutlinePath(
  points: { x: number; y: number }[],
  bottomPoints: { x: number; y: number }[],
  counts: number[],
  bottomOffset = 0,
): string {
  if (points.length === 0) return "";

  let path = "";
  let activeSegmentTop: { x: number; y: number }[] = [];
  let activeSegmentBottom: { x: number; y: number }[] = [];

  const flushSegment = () => {
    if (activeSegmentTop.length > 0) {
      // 1. Top stroke (runs forward along the trend line)
      const topStart = activeSegmentTop[0];
      const topLines = activeSegmentTop
        .slice(1)
        .map((p) => `L ${p.x} ${p.y}`)
        .join(" ");
      const topStroke = `M ${topStart.x} ${topStart.y} ${topLines}`;

      // 2. Bottom stroke (runs forward along the bottom boundary)
      const bottomStart = activeSegmentBottom[0];
      const bottomLines = activeSegmentBottom
        .slice(1)
        .map((p) => `L ${p.x} ${p.y - bottomOffset}`)
        .join(" ");
      const bottomStroke = `M ${bottomStart.x} ${bottomStart.y - bottomOffset} ${bottomLines}`;

      // Append both open strokes to the path string
      path += `${path ? " " : ""}${topStroke} ${bottomStroke}`;

      activeSegmentTop = [];
      activeSegmentBottom = [];
    }
  };

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const b = bottomPoints[i];

    // Check if there is volume at this point using raw count instead of offset coordinates
    const hasVolume = counts[i] > 0;

    if (hasVolume) {
      // If we are starting a new segment and we have a preceding zero point, include it for the rising slope
      if (activeSegmentTop.length === 0 && i > 0) {
        activeSegmentTop.push(points[i - 1]);
        activeSegmentBottom.push(bottomPoints[i - 1]);
      }
      activeSegmentTop.push(p);
      activeSegmentBottom.push(b);
    } else {
      // If we were drawing, include this baseline point to draw the falling slope, then flush
      if (activeSegmentTop.length > 0) {
        activeSegmentTop.push(p);
        activeSegmentBottom.push(b);
        flushSegment();
      }
    }
  }

  // Flush any remaining active segment
  flushSegment();

  return path;
}
