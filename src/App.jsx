import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/* ─── Constants ─── */
const AGES = Array.from({ length: 43 }, (_, i) => i + 18);
const PROJECTION_END = 65;
const STORAGE_KEY = "nw-proj-v2";

const DECADES = [
  { key: "d18", label: "18–29", from: 18, to: 29, color: "#E8927C" },
  { key: "d30", label: "30–39", from: 30, to: 39, color: "#F2C14E" },
  { key: "d40", label: "40–49", from: 40, to: 49, color: "#4ECDC4" },
  { key: "d50", label: "50–60", from: 50, to: 60, color: "#7B8CDE" },
];
const TOTAL_COLOR = "#F0F0F0";

/* ─── Segment helpers ─── */
function segmentsToPerYear(segments, fromAge, toAge) {
  const result = {};
  for (let age = fromAge; age <= toAge; age++) {
    const seg = segments.find((s) => age >= s.from && age <= s.to);
    result[age] = seg ? seg.value : 0;
  }
  return result;
}

function perYearToSegments(perYear, fromAge, toAge) {
  const segs = [];
  let current = null;
  for (let age = fromAge; age <= toAge; age++) {
    const val = perYear[age] ?? 0;
    if (!current || current.value !== val) {
      if (current) segs.push(current);
      current = { from: age, to: age, value: val };
    } else {
      current.to = age;
    }
  }
  if (current) segs.push(current);
  return segs;
}

function splitSegment(segments, idx) {
  const seg = segments[idx];
  const span = seg.to - seg.from + 1;
  if (span < 2) return segments;
  const mid = seg.from + Math.floor(span / 2);
  const left = { from: seg.from, to: mid - 1, value: seg.value };
  const right = { from: mid, to: seg.to, value: seg.value };
  return [...segments.slice(0, idx), left, right, ...segments.slice(idx + 1)];
}

function moveDivider(segments, dividerIdx, newBoundary) {
  const left = segments[dividerIdx];
  const right = segments[dividerIdx + 1];
  const minBound = left.from + 1;
  const maxBound = right.to;
  const clamped = Math.max(minBound, Math.min(maxBound, newBoundary));
  const newLeft = { ...left, to: clamped - 1 };
  const newRight = { ...right, from: clamped };
  return [
    ...segments.slice(0, dividerIdx),
    newLeft,
    newRight,
    ...segments.slice(dividerIdx + 2),
  ];
}

function removeDivider(segments, dividerIdx) {
  const left = segments[dividerIdx];
  const right = segments[dividerIdx + 1];
  const merged = { from: left.from, to: right.to, value: left.value };
  return [
    ...segments.slice(0, dividerIdx),
    merged,
    ...segments.slice(dividerIdx + 2),
  ];
}

/* ─── Persistence ─── */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {}
}

/* ─── Computation ─── */
function resolveFromSegments(savingsSegs, interestSegs) {
  const savingsPerYear = segmentsToPerYear(savingsSegs, 18, 60);
  const interestPerYear = segmentsToPerYear(interestSegs, 18, 65);
  const resolved = [];
  for (let age = 18; age <= 60; age++) {
    resolved.push({
      age,
      savings: savingsPerYear[age] || 0,
      rate: interestPerYear[age] || 0,
    });
  }
  return { resolved, interestPerYear };
}

function computeProjection(resolved, interestPerYear) {
  const data = [];
  const monthlyParams = [];
  for (const r of resolved) {
    const monthlyRate = r.rate / 100 / 12;
    for (let m = 0; m < 12; m++) {
      monthlyParams.push({ savings: r.savings, monthlyRate, age: r.age });
    }
  }

  let buckets = [0, 0, 0, 0];
  function getDecadeIndex(age) {
    if (age <= 29) return 0;
    if (age <= 39) return 1;
    if (age <= 49) return 2;
    return 3;
  }

  for (let year = 0; year < PROJECTION_END - 18; year++) {
    const age = 18 + year;
    for (let m = 0; m < 12; m++) {
      const globalMonth = year * 12 + m;
      let monthlyRate;
      if (globalMonth < monthlyParams.length) {
        monthlyRate = monthlyParams[globalMonth].monthlyRate;
      } else {
        const rateForAge = interestPerYear[age] || interestPerYear[60] || 0;
        monthlyRate = rateForAge / 100 / 12;
      }
      for (let b = 0; b < 4; b++) {
        buckets[b] *= 1 + monthlyRate;
      }
      if (globalMonth < monthlyParams.length) {
        const di = getDecadeIndex(monthlyParams[globalMonth].age);
        buckets[di] += monthlyParams[globalMonth].savings;
      }
    }
    const total = buckets.reduce((a, b) => a + b, 0);
    data.push({
      age: age + 1,
      d18: Math.round(buckets[0]),
      d30: Math.round(buckets[1]),
      d40: Math.round(buckets[2]),
      d50: Math.round(buckets[3]),
      total: Math.round(total),
    });
  }
  return data;
}

/* ─── Formatting ─── */
function formatEUR(val) {
  if (val == null) return "";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}
function formatCompact(val) {
  if (val >= 1_000_000) return `€${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `€${(val / 1_000).toFixed(0)}k`;
  return `€${val}`;
}

/* ─── Tooltip for area chart ─── */
const AreaTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      style={{
        background: "rgba(20,22,28,0.95)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        padding: "12px 16px",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: 14,
      }}
    >
      <div style={{ color: "#999", marginBottom: 8, fontSize: 13 }}>Age {label}</div>
      {payload.filter((p) => p.value > 0).reverse().map((p) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 20, padding: "2px 0" }}>
          <span style={{ color: p.color, fontWeight: 500 }}>{p.name}</span>
          <span style={{ color: "#eee", fontFamily: "'DM Mono', monospace" }}>{formatEUR(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

/* ─── SegmentBarChart ─── */
function SegmentBarChart({ segments, onChange, label, color, unit, suffix, rangeFrom, rangeTo }) {
  const containerRef = useRef(null);
  const [editIdx, setEditIdx] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [editPos, setEditPos] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState(null);
  const dragRef = useRef(null);
  const lastTapRef = useRef({ time: 0, idx: -1 });
  const totalYears = rangeTo - rangeFrom + 1;

  const maxVal = Math.max(...segments.map((s) => s.value), 1);

  const getAgeFromX = useCallback((clientX) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return rangeFrom;
    const frac = (clientX - rect.left) / rect.width;
    return Math.round(rangeFrom + frac * totalYears);
  }, [rangeFrom, totalYears]);

  // Double-click/double-tap to split
  const handleBarInteraction = useCallback((idx, e) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last.idx === idx && now - last.time < 400) {
      // Double tap
      const span = segments[idx].to - segments[idx].from + 1;
      if (span >= 2) onChange(splitSegment(segments, idx));
      lastTapRef.current = { time: 0, idx: -1 };
      return;
    }
    lastTapRef.current = { time: now, idx };

    // Single tap → edit after delay (if no double-tap follows)
    setTimeout(() => {
      if (lastTapRef.current.time === now && lastTapRef.current.idx === idx) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const seg = segments[idx];
        const segStart = (seg.from - rangeFrom) / totalYears;
        const segWidth = (seg.to - seg.from + 1) / totalYears;
        const x = rect.left + (segStart + segWidth / 2) * rect.width;
        const y = rect.top - 10;
        setEditIdx(idx);
        setEditVal(String(seg.value));
        setEditPos({ x: x - rect.left, y: 0 });
      }
    }, 420);
  }, [segments, onChange, rangeFrom, totalYears]);

  const commitEdit = useCallback(() => {
    if (editIdx !== null) {
      const val = parseFloat(editVal);
      if (!isNaN(val) && val >= 0) {
        const updated = segments.map((s, i) => i === editIdx ? { ...s, value: val } : s);
        onChange(updated);
      }
      setEditIdx(null);
    }
  }, [editIdx, editVal, segments, onChange]);

  // Divider drag
  const handleDividerDown = useCallback((divIdx, e) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    dragRef.current = {
      divIdx,
      startX: clientX,
      startY: clientY,
      currentAge: segments[divIdx + 1].from,
      removing: false,
    };
    setDragState({ divIdx, age: segments[divIdx + 1].from, removing: false });
  }, [segments]);

  useEffect(() => {
    if (!dragState) return;

    const handleMove = (e) => {
      const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      const dr = dragRef.current;
      if (!dr) return;

      const vertDist = Math.abs(clientY - dr.startY);
      const removing = vertDist > 50;
      const newAge = getAgeFromX(clientX);
      const left = segments[dr.divIdx];
      const right = segments[dr.divIdx + 1];
      const minB = left.from + 1;
      const maxB = right.to;
      const clamped = Math.max(minB, Math.min(maxB, newAge));

      dr.currentAge = clamped;
      dr.removing = removing;
      setDragState({ divIdx: dr.divIdx, age: clamped, removing });
    };

    const handleUp = () => {
      const dr = dragRef.current;
      if (!dr) return;
      if (dr.removing) {
        onChange(removeDivider(segments, dr.divIdx));
      } else {
        onChange(moveDivider(segments, dr.divIdx, dr.currentAge));
      }
      dragRef.current = null;
      setDragState(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [dragState, segments, onChange, getAgeFromX]);

  // Render segments with optional drag preview
  const displaySegments = useMemo(() => {
    if (!dragState) return segments;
    try {
      if (dragState.removing) return segments; // show as-is with visual indicator
      return moveDivider(segments, dragState.divIdx, dragState.age);
    } catch {
      return segments;
    }
  }, [segments, dragState]);

  return (
    <div style={{ position: "relative", marginBottom: 28 }}>
      <div
        style={{
          fontSize: 14,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          color: "#555",
          fontWeight: 500,
          marginBottom: 10,
          paddingLeft: 2,
        }}
      >
        {label}
      </div>

      {/* Floating editor */}
      {editIdx !== null && (
        <div
          style={{
            position: "absolute",
            top: -52,
            left: editPos.x,
            transform: "translateX(-50%)",
            zIndex: 20,
            display: "flex",
            gap: 6,
            animation: "fadeIn 0.15s ease",
          }}
        >
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            value={editVal}
            onChange={(e) => setEditVal(e.target.value.replace(/[^0-9.,]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditIdx(null);
            }}
            onBlur={commitEdit}
            style={{
              width: 90,
              padding: "8px 10px",
              background: "rgba(20,22,28,0.95)",
              border: `1px solid ${color}55`,
              borderRadius: 6,
              color: "#f0f0f0",
              fontFamily: "'DM Mono', monospace",
              fontSize: 16,
              textAlign: "center",
              outline: "none",
            }}
          />
          <span
            style={{
              color: "#555",
              fontSize: 14,
              alignSelf: "center",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {suffix}
          </span>
        </div>
      )}

      {/* Bar container */}
      <div
        ref={containerRef}
        style={{
          display: "flex",
          height: 90,
          borderRadius: 8,
          overflow: "visible",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          position: "relative",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        {displaySegments.map((seg, i) => {
          const widthPct = ((seg.to - seg.from + 1) / totalYears) * 100;
          const barH = maxVal > 0 ? Math.max(10, (seg.value / maxVal) * 52) : 10;
          const isEditing = editIdx === i;
          const segIdx = i; // for original segment index mapping

          return (
            <div
              key={`${seg.from}-${seg.to}`}
              style={{
                width: `${widthPct}%`,
                height: "100%",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                alignItems: "center",
                cursor: "pointer",
                padding: "0 2px",
              }}
              onClick={(e) => handleBarInteraction(i, e)}
              onTouchEnd={(e) => {
                e.preventDefault();
                handleBarInteraction(i, e);
              }}
            >
              {/* Value label */}
              <div
                style={{
                  fontSize: 14,
                  fontFamily: "'DM Mono', monospace",
                  color: isEditing ? color : "#888",
                  marginBottom: 6,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "100%",
                  textAlign: "center",
                }}
              >
                {seg.value}
                {suffix}
              </div>
              {/* Bar */}
              <div
                style={{
                  width: "calc(100% - 6px)",
                  height: barH,
                  borderRadius: 4,
                  background: isEditing ? color : `${color}88`,
                  transition: dragState ? "none" : "height 0.2s ease, background 0.2s ease",
                }}
              />
              {/* Age range label */}
              <div
                style={{
                  fontSize: 13,
                  color: "#555",
                  marginTop: 6,
                  fontFamily: "'DM Mono', monospace",
                  whiteSpace: "nowrap",
                }}
              >
                {seg.from === seg.to ? seg.from : `${seg.from}–${seg.to}`}
              </div>
            </div>
          );
        })}

        {/* Dividers */}
        {displaySegments.slice(0, -1).map((seg, i) => {
          const leftEdge = displaySegments.slice(0, i + 1).reduce(
            (acc, s) => acc + (s.to - s.from + 1),
            0,
          );
          const leftPct = (leftEdge / totalYears) * 100;
          const isRemoving = dragState?.divIdx === i && dragState?.removing;
          const isDragging = dragState?.divIdx === i;

          return (
            <div
              key={`div-${i}`}
              style={{
                position: "absolute",
                left: `${leftPct}%`,
                top: 0,
                width: 20,
                height: "100%",
                transform: "translateX(-50%)",
                cursor: "ew-resize",
                zIndex: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                touchAction: "none",
              }}
              onMouseDown={(e) => handleDividerDown(i, e)}
              onTouchStart={(e) => handleDividerDown(i, e)}
            >
              <div
                style={{
                  width: 3,
                  height: "70%",
                  borderRadius: 2,
                  background: isRemoving ? "#ff4444" : isDragging ? color : `${color}66`,
                  opacity: isRemoving ? 0.4 : 1,
                  transition: isDragging ? "none" : "all 0.15s ease",
                  boxShadow: isDragging ? `0 0 8px ${color}44` : "none",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Hint */}
      <div
        style={{
          fontSize: 13,
          color: "#444",
          marginTop: 8,
          fontFamily: "'DM Sans', sans-serif",
          textAlign: "center",
        }}
      >
        Tap to edit · Double-tap to split · Drag dividers to adjust · Drag out to merge
      </div>
    </div>
  );
}

/* ─── Table InputCell ─── */
function InputCell({ value, onChange, placeholder, suffix, inputMode }) {
  const [local, setLocal] = useState(value || "");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setLocal(value || "");
  }, [value, focused]);

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <input
        type="text"
        inputMode={inputMode || "decimal"}
        value={local}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.,\-]/g, "");
          setLocal(v);
          onChange(v);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          background: focused ? "rgba(255,255,255,0.08)" : "transparent",
          border: "1px solid",
          borderColor: focused ? "rgba(232,146,124,0.5)" : local ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)",
          borderRadius: 6,
          padding: "8px 10px",
          paddingRight: suffix ? 28 : 10,
          color: local ? "#f0f0f0" : "#555",
          fontFamily: "'DM Mono', monospace",
          fontSize: 16,
          outline: "none",
          transition: "all 0.15s ease",
          textAlign: "right",
        }}
      />
      {suffix && (
        <span
          style={{
            position: "absolute",
            right: 10,
            color: "#555",
            fontSize: 14,
            fontFamily: "'DM Sans', sans-serif",
            pointerEvents: "none",
          }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}

/* ─── Main Component ─── */
export default function NetWorthProjection() {
  const [savingsSegs, setSavingsSegs] = useState([{ from: 18, to: 60, value: 200 }]);
  const [interestSegs, setInterestSegs] = useState([{ from: 18, to: 65, value: 7 }]);
  const [view, setView] = useState("chart"); // "chart" | "table"
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  // Load
  useEffect(() => {
    const saved = loadData();
    if (saved?.savingsSegs) setSavingsSegs(saved.savingsSegs);
    if (saved?.interestSegs) setInterestSegs(saved.interestSegs);
    setLoaded(true);
  }, []);

  // Debounced save
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveData({ savingsSegs, interestSegs });
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [savingsSegs, interestSegs, loaded]);

  // Derive resolved data
  const { resolved, interestPerYear } = useMemo(
    () => resolveFromSegments(savingsSegs, interestSegs),
    [savingsSegs, interestSegs],
  );
  const chartData = useMemo(
    () => computeProjection(resolved, interestPerYear),
    [resolved, interestPerYear],
  );
  const finalTotal = chartData.length > 0 ? chartData[chartData.length - 1].total : 0;

  // Table rawInputs derived from segments (with carry-forward compression)
  const rawInputs = useMemo(() => {
    const raw = {};
    const savPerYear = segmentsToPerYear(savingsSegs, 18, 60);
    const intPerYear = segmentsToPerYear(interestSegs, 18, 60);
    let lastSav = null;
    let lastRate = null;
    for (let age = 18; age <= 60; age++) {
      const sav = savPerYear[age];
      const rate = intPerYear[age];
      const entry = {};
      if (sav !== lastSav) {
        entry.savings = String(sav);
        lastSav = sav;
      }
      if (rate !== lastRate) {
        entry.rate = String(rate);
        lastRate = rate;
      }
      if (Object.keys(entry).length > 0) raw[age] = entry;
    }
    return raw;
  }, [savingsSegs, interestSegs]);

  // Table editing → update segments
  const updateTableField = useCallback((age, field, value) => {
    const numVal = value === "" ? null : parseFloat(value);

    if (field === "savings") {
      const perYear = segmentsToPerYear(savingsSegs, 18, 60);
      if (numVal !== null && !isNaN(numVal)) {
        // Set this age and carry forward until next explicit entry
        for (let a = age; a <= 60; a++) {
          const hasExplicit = rawInputs[a]?.savings !== undefined && a !== age;
          if (hasExplicit && a !== age) break;
          perYear[a] = numVal;
        }
      }
      setSavingsSegs(perYearToSegments(perYear, 18, 60));
    } else {
      const perYear = segmentsToPerYear(interestSegs, 18, 65);
      if (numVal !== null && !isNaN(numVal)) {
        for (let a = age; a <= 65; a++) {
          const hasExplicit = rawInputs[a]?.rate !== undefined && a !== age;
          if (hasExplicit && a !== age) break;
          perYear[a] = numVal;
        }
      }
      setInterestSegs(perYearToSegments(perYear, 18, 65));
    }
  }, [savingsSegs, interestSegs, rawInputs]);

  const handleReset = useCallback(() => {
    setSavingsSegs([{ from: 18, to: 60, value: 200 }]);
    setInterestSegs([{ from: 18, to: 65, value: 7 }]);
  }, []);

  if (!loaded) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0E1117",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#555",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0E1117", color: "#f0f0f0", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px 40px" }}>
        {/* Header */}
        <header style={{ textAlign: "center", padding: "32px 0 24px", animation: "fadeIn 0.6s ease" }}>
          <div
            style={{
              fontSize: 13,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "#E8927C",
              marginBottom: 12,
              fontWeight: 500,
            }}
          >
            Net Worth Projection
          </div>
          <h1
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: "clamp(28px, 6vw, 48px)",
              fontWeight: 800,
              lineHeight: 1.1,
              color: "#f0f0f0",
              marginBottom: 8,
            }}
          >
            {formatEUR(finalTotal)}
          </h1>
          <div style={{ color: "#666", fontSize: 16 }}>Projected value at age 65</div>
        </header>

        {/* Toggle + Reset */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              gap: 4,
              background: "rgba(255,255,255,0.04)",
              borderRadius: 8,
              padding: 3,
              width: 200,
            }}
          >
            {["Chart", "Table"].map((tab) => {
              const active = (tab === "Chart" && view === "chart") || (tab === "Table" && view === "table");
              return (
                <button
                  key={tab}
                  onClick={() => setView(tab.toLowerCase())}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    background: active ? "rgba(255,255,255,0.08)" : "transparent",
                    border: "none",
                    borderRadius: 6,
                    color: active ? "#f0f0f0" : "#555",
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 16,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>
          <button
            onClick={handleReset}
            style={{
              padding: "8px 14px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6,
              color: "#555",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 14,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.target.style.borderColor = "rgba(232,146,124,0.4)";
              e.target.style.color = "#E8927C";
            }}
            onMouseLeave={(e) => {
              e.target.style.borderColor = "rgba(255,255,255,0.08)";
              e.target.style.color = "#555";
            }}
          >
            Reset
          </button>
        </div>

        {/* Chart View */}
        {view === "chart" && (
          <div style={{ animation: "fadeIn 0.4s ease" }}>
            {/* Stacked area chart */}
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
                padding: "24px 8px 16px",
                marginBottom: 24,
              }}
            >
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
                  <defs>
                    {DECADES.map((d) => (
                      <linearGradient key={d.key} id={`grad_${d.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={d.color} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={d.color} stopOpacity={0.02} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis
                    dataKey="age"
                    tick={{ fill: "#555", fontSize: 13, fontFamily: "'DM Mono', monospace" }}
                    axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={formatCompact}
                    tick={{ fill: "#555", fontSize: 13, fontFamily: "'DM Mono', monospace" }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                  />
                  <Tooltip content={<AreaTooltip />} />
                  <Legend
                    verticalAlign="top"
                    height={36}
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "#888" }}
                  />
                  {DECADES.map((d) => (
                    <Area
                      key={d.key}
                      type="monotone"
                      dataKey={d.key}
                      name={d.label}
                      stackId="1"
                      stroke={d.color}
                      strokeWidth={1.5}
                      fill={`url(#grad_${d.key})`}
                      animationDuration={800}
                    />
                  ))}
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Total"
                    stroke={TOTAL_COLOR}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    fill="none"
                    animationDuration={1000}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Segment bar charts */}
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
                padding: "24px 16px 16px",
                marginBottom: 24,
              }}
            >
              <SegmentBarChart
                segments={savingsSegs}
                onChange={setSavingsSegs}
                label="Monthly Savings Rate"
                color="#E8927C"
                unit="EUR"
                suffix="€"
                rangeFrom={18}
                rangeTo={60}
              />
              <SegmentBarChart
                segments={interestSegs}
                onChange={setInterestSegs}
                label="Annual Interest Rate"
                color="#4ECDC4"
                unit="%"
                suffix="%"
                rangeFrom={18}
                rangeTo={65}
              />
            </div>
          </div>
        )}

        {/* Table View */}
        {view === "table" && (
          <div
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 12,
              overflow: "hidden",
              animation: "fadeIn 0.4s ease",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "56px 1fr 1fr",
                gap: 8,
                padding: "14px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                position: "sticky",
                top: 0,
                background: "#12151C",
                zIndex: 2,
              }}
            >
              <div
                style={{ fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "#555", fontWeight: 500 }}
              >
                Age
              </div>
              <div
                style={{
                  fontSize: 13,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: "#555",
                  fontWeight: 500,
                  textAlign: "right",
                }}
              >
                Monthly (EUR)
              </div>
              <div
                style={{
                  fontSize: 13,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: "#555",
                  fontWeight: 500,
                  textAlign: "right",
                }}
              >
                Interest (%)
              </div>
            </div>
            <div style={{ maxHeight: 480, overflowY: "auto", padding: "4px 0" }}>
              {AGES.map((age, idx) => {
                const entry = rawInputs[age] || {};
                const res = resolved[idx];
                const decadeColor = DECADES.find((d) => age >= d.from && age <= d.to)?.color;
                const isDecadeStart = [18, 30, 40, 50].includes(age);

                return (
                  <div key={age}>
                    {isDecadeStart && (
                      <div
                        style={{
                          padding: "10px 16px 4px",
                          fontSize: 13,
                          letterSpacing: 1.5,
                          textTransform: "uppercase",
                          color: decadeColor,
                          fontWeight: 600,
                          opacity: 0.7,
                        }}
                      >
                        {DECADES.find((d) => d.from === age)?.label}
                      </div>
                    )}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "56px 1fr 1fr",
                        gap: 8,
                        padding: "4px 16px",
                        alignItems: "center",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 16,
                          fontFamily: "'DM Mono', monospace",
                          color: decadeColor || "#666",
                          fontWeight: 500,
                        }}
                      >
                        {age}
                      </div>
                      <InputCell
                        value={entry.savings ?? ""}
                        onChange={(v) =>
                          updateTableField(age, "savings", v)}
                        placeholder={res.savings > 0 ? String(res.savings) : "—"}
                        suffix="€"
                      />
                      <InputCell
                        value={entry.rate ?? ""}
                        onChange={(v) => updateTableField(age, "rate", v)}
                        placeholder={res.rate > 0 ? String(res.rate) : "—"}
                        suffix="%"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pie Chart Breakdown */}
        {(() => {
          const pieData = DECADES.map((d) => ({
            name: d.label,
            value: chartData.length > 0 ? chartData[chartData.length - 1][d.key] : 0,
            color: d.color,
          })).filter((d) => d.value > 0);
          const pieTotal = pieData.reduce((a, b) => a + b.value, 0);

          return (
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
                padding: "24px 16px",
                marginTop: 24,
                animation: "fadeIn 0.6s ease 0.2s both",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: "#555",
                  fontWeight: 500,
                  marginBottom: 16,
                }}
              >
                Contribution Breakdown at 65
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 24,
                  width: "100%",
                }}
              >
                <ResponsiveContainer width={200} height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={85}
                      paddingAngle={2}
                      strokeWidth={0}
                      animationDuration={800}
                    >
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const d = payload[0];
                        const pct = pieTotal > 0 ? ((d.value / pieTotal) * 100).toFixed(1) : 0;
                        return (
                          <div
                            style={{
                              background: "rgba(20,22,28,0.95)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              borderRadius: 8,
                              padding: "8px 12px",
                              fontFamily: "'DM Sans', sans-serif",
                              fontSize: 14,
                            }}
                          >
                            <span style={{ color: d.payload.color, fontWeight: 500 }}>{d.name}</span>
                            <span style={{ color: "#eee", marginLeft: 12, fontFamily: "'DM Mono', monospace" }}>
                              {formatEUR(d.value)} ({pct}%)
                            </span>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {pieData.map((d) => {
                    const pct = pieTotal > 0 ? ((d.value / pieTotal) * 100).toFixed(1) : 0;
                    return (
                      <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          style={{ width: 12, height: 12, borderRadius: "50%", background: d.color, flexShrink: 0 }}
                        />
                        <div>
                          <div style={{ fontSize: 15, color: "#ccc", fontWeight: 500 }}>Ages {d.name}</div>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 16, color: d.color }}>
                            {formatEUR(d.value)} <span style={{ color: "#555", fontSize: 13 }}>({pct}%)</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        <div
          style={{
            textAlign: "center",
            marginTop: 24,
            fontSize: 13,
            color: "#444",
            fontFamily: "'DM Mono', monospace",
          }}
        >
          Monthly compounding · EUR · Ages 18–65
        </div>
      </div>
    </div>
  );
}
