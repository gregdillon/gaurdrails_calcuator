import { useState, useMemo } from "react";
import type { ReactNode, CSSProperties } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const fmtMoney  = (n: number) => n <= 0 ? "$0" : "$" + Math.round(n).toLocaleString();
const fmtShort  = (n: number) => n >= 1e6 ? "$" + (n/1e6).toFixed(1)+"M" : n >= 1e3 ? "$" + (n/1e3).toFixed(0)+"K" : "$"+Math.round(n);
const fmtPct    = (n: number) => n.toFixed(2) + "%";

const DEFAULTS = {
  portfolio: 1800000, withdrawal: 85000,
  upper: 6, lower: 4, adjust: 10,
  extWidth: 1, extAdjust: 5,
  ret: 6, inf: 3,
  symmetric: true, prosperity: true,
  currentAge: 65, planToAge: 90,
  fixedIncome: 0, fixedIncomeInflation: false,
};

const STORAGE_KEY = "guardrails_calc_settings";
type Settings = typeof DEFAULTS;

function loadSaved(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

const TIPS = {
  portfolio:            "The total value of your investment portfolio at the start of retirement.",
  withdrawal:           "Your total planned annual spending in retirement — before subtracting any fixed income.",
  upper:                "If your portfolio withdrawal rate rises above this level, you reduce spending. Commonly set around 5–6%.",
  lower:                "If your portfolio withdrawal rate falls below this level, you can increase spending. Commonly set around 4–5%.",
  adjust:               "The percentage by which you raise or cut spending each time a standard guardrail is triggered.",
  extWidth:             "How far beyond a guardrail the rate must travel before the extended adjustment applies.",
  extAdjust:            "The larger spending adjustment applied when your withdrawal rate enters the extended zone.",
  ret:                  "The average annual growth rate you expect from your portfolio before inflation.",
  inf:                  "The expected annual rise in prices. Used to adjust withdrawals upward in years when no guardrail is triggered.",
  symmetric:            "When enabled, the upper and lower guardrails are kept equidistant from your initial withdrawal rate.",
  prosperity:           "From Guyton-Klinger (2006): skip the annual inflation adjustment in any year where the portfolio had a negative pre-withdrawal return.",
  midpoint:             "Calculates the exact withdrawal needed to land at the midpoint of the safe zone when standard adjustments are insufficient.",
  currentAge:           "Your age at the start of retirement. Used to label the projection chart with real ages.",
  planToAge:            "The age through which your portfolio needs to last. Determines the length of the projection.",
  fixedIncome:          "Monthly income from Social Security, a pension, or other fixed sources. Reduces how much your portfolio needs to provide each year.",
  fixedIncomeInflation: "When enabled, your fixed income grows with inflation each year — similar to a cost-of-living adjustment (COLA) on Social Security.",
};

function TooltipIcon({ tip }: { tip: string }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block", marginLeft: 5, verticalAlign: "middle" }}>
      <span onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: "50%", background: "#e0e7ef", color: "#4b6a96", fontSize: 10, fontWeight: 700, cursor: "default", lineHeight: 1, userSelect: "none" }}>?</span>
      {show && (
        <span style={{ position: "absolute", bottom: "calc(100% + 7px)", left: "50%", transform: "translateX(-50%)", background: "#1e293b", color: "#f1f5f9", fontSize: 12, lineHeight: 1.5, padding: "8px 11px", borderRadius: 7, width: 215, zIndex: 100, boxShadow: "0 4px 16px rgba(0,0,0,0.18)", pointerEvents: "none", whiteSpace: "normal" }}>
          {tip}
          <span style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", borderWidth: 5, borderStyle: "solid", borderColor: "#1e293b transparent transparent transparent" }} />
        </span>
      )}
    </span>
  );
}

function NumInput({ label, tip, value, onChange, prefix, suffix, step = 1, min, max, disabled, children }: {
  label: string; tip?: string; value: number; onChange: (n: number) => void;
  prefix?: string; suffix?: string; step?: number; min?: number; max?: number;
  disabled?: boolean; children?: ReactNode;
}) {
  const [display, setDisplay] = useState(String(value));
  useMemo(() => { setDisplay(String(value)); }, [value]);
  return (
    <div style={{ opacity: disabled ? 0.5 : 1 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#555", marginBottom: 5 }}>
        {label}{tip && <TooltipIcon tip={tip} />}
      </label>
      <div style={{ display: "flex", alignItems: "center", border: "1px solid #e2e2e2", borderRadius: 7, background: disabled ? "#f9f9f9" : "#fff", overflow: "hidden" }}>
        {prefix && <span style={{ padding: "9px 10px", background: "#f5f5f5", color: "#888", fontSize: 14, borderRight: "1px solid #e2e2e2" }}>{prefix}</span>}
        <input type="number" value={display} disabled={disabled}
          onChange={e => { setDisplay(e.target.value); const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(n); }}
          onBlur={() => { const n = parseFloat(display); if (isNaN(n)) { setDisplay(String(value)); } else { const c = min !== undefined && n < min ? min : max !== undefined && n > max ? max : n; setDisplay(String(c)); onChange(c); } }}
          step={step} min={min} max={max}
          style={{ flex: 1, border: "none", padding: "9px 10px", fontSize: 14, outline: "none", background: "transparent", width: 0 }} />
        {suffix && <span style={{ padding: "9px 10px", background: "#f5f5f5", color: "#888", fontSize: 14, borderLeft: "1px solid #e2e2e2" }}>{suffix}</span>}
      </div>
      {children}
    </div>
  );
}

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ background: "#fff", borderRadius: 12, padding: 22, border: "1px solid #e8e8e8", ...style }}>{children}</div>;
}
function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div style={{ marginBottom: sub ? 4 : 18 }}>
      <h2 style={{ fontSize: 15, fontWeight: 650, margin: 0, color: "#222" }}>{children}</h2>
      {sub && <p style={{ fontSize: 13, color: "#999", margin: "4px 0 16px" }}>{sub}</p>}
    </div>
  );
}
function SubHeading({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>{children}</div>;
}
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} style={{ position: "relative", width: 38, height: 22, borderRadius: 11, border: "none", background: value ? "#2563eb" : "#d1d5db", cursor: "pointer", transition: "background 0.2s", flexShrink: 0, padding: 0 }}>
      <span style={{ position: "absolute", top: 3, left: value ? 19 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s", display: "block", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
    </button>
  );
}
function Divider() {
  return <div style={{ borderTop: "1px solid #f0f0f0", margin: "16px 0" }} />;
}

const STATUS = {
  ok:       { label: "Within Guardrails",           emoji: "✅", color: "#1d6fbf", bg: "#eff6ff", border: "#bfdbfe" },
  cut:      { label: "Cut Spending",                emoji: "⬇️",  color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
  raise:    { label: "Raise Spending",              emoji: "⬆️",  color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
  extCut:   { label: "Significant Cut Required",    emoji: "🚨", color: "#7f1d1d", bg: "#fff0f0", border: "#fca5a5" },
  extRaise: { label: "Significant Raise Available", emoji: "🎉", color: "#14532d", bg: "#f0fdf4", border: "#86efac" },
};

function getStatus(rate: number, lower: number, upper: number, extWidth: number) {
  if (rate > upper + extWidth) return "extCut";
  if (rate > upper)            return "cut";
  if (rate < lower - extWidth) return "extRaise";
  if (rate < lower)            return "raise";
  return "ok";
}

export default function GuardrailsCalc() {
  const [portfolio,             setPortfolioRaw]          = useState(() => loadSaved().portfolio);
  const [withdrawal,            setWithdrawalRaw]         = useState(() => loadSaved().withdrawal);
  const [upper,                 setUpperRaw]              = useState(() => loadSaved().upper);
  const [lower,                 setLowerRaw]              = useState(() => loadSaved().lower);
  const [adjust,                setAdjust]                = useState(() => loadSaved().adjust);
  const [extWidth,              setExtWidth]              = useState(() => loadSaved().extWidth);
  const [extAdjust,             setExtAdjust]             = useState(() => loadSaved().extAdjust);
  const [ret,                   setRet]                   = useState(() => loadSaved().ret);
  const [inf,                   setInf]                   = useState(() => loadSaved().inf);
  const [sim,                   setSim]                   = useState(() => loadSaved().portfolio);
  const [symmetric,             setSymmetric]             = useState(() => loadSaved().symmetric);
  const [prosperity,            setProsperity]            = useState(() => loadSaved().prosperity);
  const [currentAge,            setCurrentAge]            = useState(() => loadSaved().currentAge);
  const [planToAge,             setPlanToAge]             = useState(() => loadSaved().planToAge);
  const [fixedIncome,           setFixedIncome]           = useState(() => loadSaved().fixedIncome);
  const [fixedIncomeInflation,  setFixedIncomeInflation]  = useState(() => loadSaved().fixedIncomeInflation);
  const [prevWithdrawal,        setPrevWithdrawal]        = useState<number | null>(null);
  const [savedFlash,            setSavedFlash]            = useState(false);

  const setPortfolio = (v: number) => { setPortfolioRaw(v); setSim(v); };
  const setWithdrawal = (v: number) => { setWithdrawalRaw(v); setPrevWithdrawal(null); };

  const handleInflationAdj = (dir: number) => {
    setPrevWithdrawal(withdrawal);
    setWithdrawalRaw(Math.round(withdrawal * (dir > 0 ? (1 + inf / 100) : (1 - inf / 100))));
  };
  const handleUndo = () => {
    if (prevWithdrawal !== null) setWithdrawalRaw(prevWithdrawal);
    setPrevWithdrawal(null);
  };

  const initialRate = portfolio > 0 ? (withdrawal / portfolio) * 100 : 0;
  const annualFixed = fixedIncome * 12;

  const setUpper = (v: number) => { setUpperRaw(v); if (symmetric) setLowerRaw(parseFloat((initialRate - (v - initialRate)).toFixed(2))); };
  const setLower = (v: number) => { setLowerRaw(v); if (symmetric) setUpperRaw(parseFloat((initialRate + (initialRate - v)).toFixed(2))); };
  const handleSymmetricToggle = (val: boolean) => { setSymmetric(val); if (val) setLowerRaw(parseFloat((initialRate - (upper - initialRate)).toFixed(2))); };

  const handleSave = () => {
    const settings: Settings = {
      portfolio, withdrawal, upper, lower, adjust,
      extWidth, extAdjust, ret, inf,
      symmetric, prosperity, currentAge, planToAge,
      fixedIncome, fixedIncomeInflation,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  const handleReset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setPortfolioRaw(DEFAULTS.portfolio);
    setSim(DEFAULTS.portfolio);
    setWithdrawalRaw(DEFAULTS.withdrawal);
    setUpperRaw(DEFAULTS.upper);
    setLowerRaw(DEFAULTS.lower);
    setAdjust(DEFAULTS.adjust);
    setExtWidth(DEFAULTS.extWidth);
    setExtAdjust(DEFAULTS.extAdjust);
    setRet(DEFAULTS.ret);
    setInf(DEFAULTS.inf);
    setSymmetric(DEFAULTS.symmetric);
    setProsperity(DEFAULTS.prosperity);
    setCurrentAge(DEFAULTS.currentAge);
    setPlanToAge(DEFAULTS.planToAge);
    setFixedIncome(DEFAULTS.fixedIncome);
    setFixedIncomeInflation(DEFAULTS.fixedIncomeInflation);
    setPrevWithdrawal(null);
  };

  const netPortfolioWithdrawal = Math.max(0, withdrawal - annualFixed);
  const simRate     = sim > 0 ? (netPortfolioWithdrawal / sim) * 100 : 0;
  const guardStatus = getStatus(simRate, lower, upper, extWidth);
  const adjPct      = (guardStatus === "extCut" || guardStatus === "extRaise") ? extAdjust : adjust;

  // Guardrail adjusts total spending; net draw recalculated
  const newTotalSpending =
    guardStatus === "cut"   || guardStatus === "extCut"   ? withdrawal * (1 - adjPct / 100) :
    guardStatus === "raise" || guardStatus === "extRaise" ? withdrawal * (1 + adjPct / 100) : withdrawal;
  const newNetWithdrawal = Math.max(0, newTotalSpending - annualFixed);

  const postAdjRate  = sim > 0 ? (newNetWithdrawal / sim) * 100 : 0;
  const stillOutside = guardStatus !== "ok" && (postAdjRate > upper || postAdjRate < lower);
  const midpointRate = (upper + lower) / 2;
  const midpointNetWithdrawal = (midpointRate / 100) * sim;
  const midpointTotalSpending = midpointNetWithdrawal + annualFixed;
  const isMidpointCut = midpointTotalSpending < withdrawal;
  const applyMidpointReset = () => setWithdrawal(Math.round(midpointTotalSpending));

  const invalidGuardrails  = lower >= upper;
  const invalidAges        = planToAge <= currentAge;
  const projectionYears    = invalidAges ? 30 : Math.min(50, planToAge - currentAge);
  const extLower = lower - extWidth;
  const extUpper = upper + extWidth;

  const projection = useMemo(() => {
    const pts = [];
    let pv = portfolio, wd = withdrawal, fi = annualFixed;
    for (let y = 0; y <= projectionYears; y++) {
      const netDraw = Math.max(0, wd - fi);
      pts.push({ age: currentAge + y, year: y, portfolio: pv > 0 ? Math.round(pv) : 0, withdrawal: pv > 0 ? Math.round(wd) : 0, netDraw: pv > 0 ? Math.round(netDraw) : 0 });
      if (pv <= 0) break;
      const rate = (netDraw / pv) * 100;
      const st   = getStatus(rate, lower, upper, extWidth);
      const a    = (st === "extCut" || st === "extRaise") ? extAdjust : adjust;
      const applyInflation = !prosperity || ret > 0;
      let nextWd = st === "cut" || st === "extCut"     ? wd * (1 - a / 100)
                 : st === "raise" || st === "extRaise" ? wd * (1 + a / 100)
                 : applyInflation ? wd * (1 + inf / 100) : wd;
      fi = fixedIncomeInflation ? fi * (1 + inf / 100) : fi;
      pv = pv * (1 + ret / 100) - Math.max(0, nextWd - fi);
      wd = nextWd;
    }
    return pts;
  }, [portfolio, withdrawal, upper, lower, adjust, extWidth, extAdjust, ret, inf, prosperity, projectionYears, currentAge, annualFixed, fixedIncomeInflation]);

  const depleted = projection[projection.length - 1].portfolio <= 0;
  const barMax   = Math.min(Math.max(extUpper * 1.4, simRate + 0.5, 12), 22);
  const simPos   = Math.min(Math.max((simRate / barMax) * 100, 1), 98);
  const s        = STATUS[guardStatus];

  return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", maxWidth: 840, margin: "0 auto", padding: "28px 18px", background: "#f7f7f7", minHeight: "100vh", color: "#1a1a1a" }}>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 23, fontWeight: 750, margin: "0 0 6px" }}>Guardrails Retirement Calculator</h1>
        <p style={{ color: "#888", fontSize: 13.5, margin: 0, lineHeight: 1.55 }}>
          Model dynamic retirement spending using the Guyton-Klinger guardrails method, extended with tiered adjustment zones based on Kitces &amp; Blanchett dynamic spending research.
        </p>
      </div>

      {/* ── SETTINGS ── */}
      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontSize: 15, fontWeight: 650, margin: 0, color: "#222" }}>Settings</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {savedFlash && <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>✓ Saved</span>}
            <button onClick={handleReset}
              style={{ padding: "5px 13px", fontSize: 12.5, fontWeight: 500, borderRadius: 6, border: "1px solid #e2e2e2", background: "#fff", color: "#666", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#fef2f2"; e.currentTarget.style.borderColor = "#fecaca"; e.currentTarget.style.color = "#b91c1c"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#e2e2e2"; e.currentTarget.style.color = "#666"; }}>
              Reset
            </button>
            <button onClick={handleSave}
              style={{ padding: "5px 13px", fontSize: 12.5, fontWeight: 500, borderRadius: 6, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#2563eb", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#dbeafe"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#eff6ff"; }}>
              Save
            </button>
          </div>
        </div>

        {invalidGuardrails && (
          <div style={{ padding: "10px 14px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 7, marginBottom: 16, fontSize: 13, color: "#c2410c" }}>
            ⚠️ Lower guardrail must be less than upper guardrail.
          </div>
        )}
        {invalidAges && (
          <div style={{ padding: "10px 14px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 7, marginBottom: 16, fontSize: 13, color: "#c2410c" }}>
            ⚠️ Plan-to age must be greater than current age.
          </div>
        )}

        {/* Portfolio & Withdrawals */}
        <SubHeading>Portfolio &amp; Withdrawals</SubHeading>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "13px 22px" }}>
          <NumInput label="Current Portfolio Value" tip={TIPS.portfolio}  value={portfolio}  onChange={setPortfolio}  prefix="$" step={10000} min={0} />

          {/* Withdrawal with inflation adj + undo */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#555", marginBottom: 5 }}>
              Annual Spending <TooltipIcon tip={TIPS.withdrawal} />
            </label>
            <div style={{ display: "flex", alignItems: "center", border: "1px solid #e2e2e2", borderRadius: 7, background: "#fff", overflow: "hidden" }}>
              <span style={{ padding: "9px 10px", background: "#f5f5f5", color: "#888", fontSize: 14, borderRight: "1px solid #e2e2e2" }}>$</span>
              <input type="number" value={withdrawal} min={0} step={500}
                onChange={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) setWithdrawal(n); }}
                onBlur={e => { const n = parseFloat(e.target.value); if (isNaN(n)) {} else setWithdrawal(n); }}
                style={{ flex: 1, border: "none", padding: "9px 10px", fontSize: 14, outline: "none", background: "transparent", width: 0 }} />
            </div>
            <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
              {[{ dir: 1, label: `＋${inf}%`, title: `Increase by ${inf}% inflation`, hoverBg: "#f0fdf4", hoverColor: "#16a34a", hoverBorder: "#86efac" }
              ].map(({ dir, label, title, hoverBg, hoverColor, hoverBorder }) => (
                <button key={dir} onClick={() => handleInflationAdj(dir)} title={title}
                  style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "transparent", border: "1px solid #e2e2e2", borderRadius: 6, padding: "3px 9px", fontSize: 11.5, color: "#888", cursor: "pointer", fontWeight: 500, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = hoverBg; e.currentTarget.style.color = hoverColor; e.currentTarget.style.borderColor = hoverBorder; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#888"; e.currentTarget.style.borderColor = "#e2e2e2"; }}>
                  {label}
                </button>
              ))}
              {prevWithdrawal !== null && (
                <button onClick={handleUndo} title="Undo last inflation adjustment"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#fef9ec", border: "1px solid #fde68a", borderRadius: 6, padding: "3px 9px", fontSize: 11.5, color: "#92400e", cursor: "pointer", fontWeight: 500, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#fef3c7"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#fef9ec"; }}>
                  ↩ {fmtMoney(prevWithdrawal)}
                </button>
              )}
            </div>
          </div>

          <NumInput label="Expected Annual Return" tip={TIPS.ret} value={ret} onChange={setRet} suffix="%" step={0.25} min={0} max={25} />
          <NumInput label="Inflation Rate"         tip={TIPS.inf} value={inf} onChange={setInf} suffix="%" step={0.1}  min={0} max={15} />
        </div>

        <Divider />

        {/* Ages */}
        <SubHeading>Retirement Horizon</SubHeading>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "13px 22px" }}>
          <NumInput label="Current Age"  tip={TIPS.currentAge} value={currentAge} onChange={setCurrentAge} suffix="yrs" step={1} min={40} max={90} />
          <NumInput label="Plan to Age"  tip={TIPS.planToAge}  value={planToAge}  onChange={setPlanToAge}  suffix="yrs" step={1} min={50} max={110} />
        </div>
        {!invalidAges && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "#888" }}>
            Projection spans <strong style={{ color: "#444" }}>{projectionYears} years</strong> — age {currentAge} to {planToAge}
          </div>
        )}

        <Divider />

        {/* Fixed Income */}
        <SubHeading>Fixed Income</SubHeading>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "13px 22px", marginBottom: 12 }}>
          <NumInput label="Monthly Fixed Income" tip={TIPS.fixedIncome} value={fixedIncome} onChange={setFixedIncome} prefix="$" step={100} min={0} />
        </div>
        {fixedIncome > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Toggle value={fixedIncomeInflation} onChange={setFixedIncomeInflation} />
            <span style={{ fontSize: 13, fontWeight: 500, color: "#444" }}>Inflation-adjusted (COLA) <TooltipIcon tip={TIPS.fixedIncomeInflation} /></span>
          </div>
        )}

        <Divider />

        {/* Guardrail Zones */}
        <SubHeading>Guardrail Zones</SubHeading>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "13px 22px" }}>
          <NumInput label="Upper Guardrail"     tip={TIPS.upper}  value={upper}  onChange={setUpper}  suffix="%" step={0.1} min={0} max={25} />
          <NumInput label="Lower Guardrail"     tip={TIPS.lower}  value={lower}  onChange={setLower}  suffix="%" step={0.1} min={0} max={25} />
          <NumInput label="Standard Adjustment" tip={TIPS.adjust} value={adjust} onChange={setAdjust} suffix="%" step={1}   min={1} max={50} />
        </div>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Toggle value={symmetric} onChange={handleSymmetricToggle} />
            <span style={{ fontSize: 13, fontWeight: 500, color: "#444" }}>Symmetrical Guardrails <TooltipIcon tip={TIPS.symmetric} /></span>
            {symmetric && <span style={{ fontSize: 12, color: "#2563eb", background: "#eff6ff", padding: "2px 9px", borderRadius: 20, border: "1px solid #bfdbfe" }}>±{(upper - initialRate).toFixed(2)}% from {fmtPct(initialRate)}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Toggle value={prosperity} onChange={setProsperity} />
            <span style={{ fontSize: 13, fontWeight: 500, color: "#444" }}>Prosperity Rule (Guyton-Klinger) <TooltipIcon tip={TIPS.prosperity} /></span>
            {prosperity && <span style={{ fontSize: 12, color: "#6b7280", background: "#f3f4f6", padding: "2px 9px", borderRadius: 20, border: "1px solid #e5e7eb" }}>Skip inflation adj. in down-return years</span>}
          </div>
        </div>

        <Divider />

        {/* Extended Zones */}
        <SubHeading>Extended Zones <span style={{ fontWeight: 400, color: "#bbb", textTransform: "none", letterSpacing: 0 }}>— larger adjustments for severe portfolio moves</span></SubHeading>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "13px 22px" }}>
          <NumInput label="Extended Zone Width"      tip={TIPS.extWidth}  value={extWidth}  onChange={setExtWidth}  suffix="%" step={0.1} min={0.1} max={10} />
          <NumInput label="Extended Zone Adjustment" tip={TIPS.extAdjust} value={extAdjust} onChange={setExtAdjust} suffix="%" step={1}   min={1}   max={75} />
        </div>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, alignItems: "center" }}>
          {[
            { color: "#15803d", bg: "#dcfce7", label: `< ${fmtPct(extLower)} Extended raise` },
            { color: "#16a34a", bg: "#bbf7d0", label: `${fmtPct(extLower)}–${fmtPct(lower)} Raise` },
            { color: "#1d6fbf", bg: "#dbeafe", label: `${fmtPct(lower)}–${fmtPct(upper)} Safe zone` },
            { color: "#b91c1c", bg: "#fecaca", label: `${fmtPct(upper)}–${fmtPct(extUpper)} Cut` },
            { color: "#7f1d1d", bg: "#fca5a5", label: `> ${fmtPct(extUpper)} Extended cut` },
          ].map(z => (
            <span key={z.label} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 20, background: z.bg, color: z.color, fontWeight: 500 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: z.color, flexShrink: 0 }} />{z.label}
            </span>
          ))}
        </div>

        {/* Summary strip */}
        <div style={{ marginTop: 16, padding: "13px 16px", background: "#f7f8fa", borderRadius: 8, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 11.5, color: "#999", marginBottom: 2 }}>Initial Withdrawal Rate</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtPct(annualFixed > 0 ? (netPortfolioWithdrawal / portfolio) * 100 : initialRate)}</div>
            <div style={{ fontSize: 11, color: "#bbb", marginTop: 1 }}>net portfolio draw rate</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: "#999", marginBottom: 2 }}>Annual Spending</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtMoney(withdrawal)}</div>
            <div style={{ fontSize: 11, color: "#bbb", marginTop: 1 }}>{fmtMoney(withdrawal / 12)}/mo</div>
          </div>
          {annualFixed > 0 && <>
            <div>
              <div style={{ fontSize: 11.5, color: "#999", marginBottom: 2 }}>Fixed Income</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a" }}>−{fmtMoney(annualFixed)}</div>
              <div style={{ fontSize: 11, color: "#bbb", marginTop: 1 }}>{fmtMoney(fixedIncome)}/mo</div>
            </div>
            <div>
              <div style={{ fontSize: 11.5, color: "#999", marginBottom: 2 }}>Net Portfolio Draw</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtMoney(netPortfolioWithdrawal)}</div>
              <div style={{ fontSize: 11, color: "#bbb", marginTop: 1 }}>{fmtMoney(netPortfolioWithdrawal / 12)}/mo</div>
            </div>
          </>}
        </div>
      </Card>

      {/* ── SIMULATOR ── */}
      <Card style={{ marginBottom: 18 }}>
        <SectionTitle sub="Drag the slider to simulate portfolio value changes. The calculator shows which zone your withdrawal rate falls in and the appropriate spending response.">
          Guardrail Simulator
        </SectionTitle>

        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, marginBottom: 7 }}>
            <span style={{ color: "#aaa" }}>{fmtShort(portfolio * 0.5)}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{fmtMoney(sim)}</span>
              {sim !== portfolio && (
                <button onClick={() => setSim(portfolio)} title="Reset to starting portfolio value"
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", border: "1px solid #e2e2e2", background: "#fff", color: "#888", fontSize: 13, cursor: "pointer", lineHeight: 1, transition: "all 0.15s", padding: 0 }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#eff6ff"; e.currentTarget.style.color = "#2563eb"; e.currentTarget.style.borderColor = "#bfdbfe"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#888"; e.currentTarget.style.borderColor = "#e2e2e2"; }}>
                  ↺
                </button>
              )}
            </div>
            <span style={{ color: "#aaa" }}>{fmtShort(portfolio * 1.5)}</span>
          </div>
          <input type="range" min={portfolio * 0.5} max={portfolio * 1.5} step={portfolio * 0.005}
            value={sim} onChange={e => setSim(+e.target.value)}
            style={{ width: "100%", accentColor: "#2563eb", cursor: "pointer", height: 6 }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#ccc", marginTop: 3 }}>
            <span>← Market Decline</span><span>Market Growth →</span>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12.5, color: "#666", marginBottom: 7 }}>
            Withdrawal Rate: <strong style={{ color: "#1a1a1a" }}>{fmtPct(simRate)}</strong>
            <span style={{ color: "#bbb", marginLeft: 8 }}>({fmtMoney(netPortfolioWithdrawal)}/yr net ÷ {fmtMoney(sim)})</span>
          </div>
          <div style={{ position: "relative", height: 26, borderRadius: 6, overflow: "hidden", display: "flex" }}>
            <div style={{ flex: Math.max(extLower, 0),          background: "#86efac" }} />
            <div style={{ flex: Math.max(lower - extLower, 0),  background: "#bbf7d0" }} />
            <div style={{ flex: Math.max(upper - lower, 0),     background: "#dbeafe" }} />
            <div style={{ flex: Math.max(extWidth, 0),          background: "#fecaca" }} />
            <div style={{ flex: Math.max(barMax - extUpper, 0), background: "#fca5a5" }} />
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${simPos}%`, width: 3, background: "#1a1a1a", borderRadius: 2, transition: "left 0.08s", boxShadow: "0 0 4px rgba(0,0,0,0.25)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#bbb", marginTop: 5, flexWrap: "wrap", gap: 2 }}>
            <span style={{ color: "#15803d", fontWeight: 500 }}>↑ {fmtPct(extLower)} ext. raise</span>
            <span style={{ color: "#16a34a", fontWeight: 500 }}>↑ {fmtPct(lower)} raise</span>
            <span style={{ color: "#dc2626", fontWeight: 500 }}>{fmtPct(upper)} cut ↑</span>
            <span style={{ color: "#7f1d1d", fontWeight: 500 }}>{fmtPct(extUpper)} ext. cut ↑</span>
          </div>
        </div>

        {/* Status card */}
        <div style={{ padding: "16px 20px", borderRadius: 10, background: s.bg, border: `1px solid ${s.border}`, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 26 }}>{s.emoji}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15.5, color: s.color, marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 13, color: "#555", lineHeight: 1.5 }}>
              {guardStatus === "ok"       && `Your rate of ${fmtPct(simRate)} is within the ${fmtPct(lower)}–${fmtPct(upper)} safe zone. No adjustment needed.`}
              {guardStatus === "cut"      && `Your rate of ${fmtPct(simRate)} crossed the upper guardrail (${fmtPct(upper)}). Apply a standard ${adjust}% spending cut.`}
              {guardStatus === "raise"    && `Your rate of ${fmtPct(simRate)} dropped below the lower guardrail (${fmtPct(lower)}). Apply a standard ${adjust}% spending increase.`}
              {guardStatus === "extCut"   && `Your rate of ${fmtPct(simRate)} is in the extended zone (beyond ${fmtPct(extUpper)}). Apply a larger ${extAdjust}% cut — portfolio stress is significant.`}
              {guardStatus === "extRaise" && `Your rate of ${fmtPct(simRate)} is in the extended zone (below ${fmtPct(extLower)}). Portfolio growth supports a larger ${extAdjust}% spending increase.`}
            </div>
          </div>
          {guardStatus !== "ok" && (
            <div style={{ textAlign: "right", minWidth: 145 }}>
              <div style={{ fontSize: 11.5, color: "#888", marginBottom: 2 }}>New annual spending</div>
              <div style={{ fontSize: 22, fontWeight: 750 }}>{fmtMoney(newTotalSpending)}</div>
              <div style={{ fontSize: 13, color: "#777" }}>{fmtMoney(newTotalSpending / 12)}/mo</div>
              {annualFixed > 0 && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{fmtMoney(newNetWithdrawal)}/yr from portfolio</div>}
              <div style={{ fontSize: 11, color: s.color, marginTop: 3, fontWeight: 600 }}>
                {isMidpointCut ? "−" : "+"}{fmtMoney(Math.abs(newTotalSpending - withdrawal))}/yr
              </div>
              {(guardStatus === "extCut" || guardStatus === "extRaise") && (
                <div style={{ fontSize: 10.5, marginTop: 4, color: "#999", background: "#f3f4f6", borderRadius: 5, padding: "2px 7px" }}>Extended zone — {extAdjust}% adj.</div>
              )}
            </div>
          )}
        </div>

        {/* Midpoint reset */}
        {stillOutside && (
          <div style={{ marginTop: 12, padding: "16px 20px", borderRadius: 10, background: "#fefce8", border: "1px solid #fde047", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 22 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#854d0e", marginBottom: 3, display: "flex", alignItems: "center" }}>
                Adjustment Insufficient — Midpoint Reset Available <TooltipIcon tip={TIPS.midpoint} />
              </div>
              <div style={{ fontSize: 13, color: "#713f12", lineHeight: 1.55 }}>
                After a {adjPct}% adjustment, your rate would still be <strong>{fmtPct(postAdjRate)}</strong> — outside the safe zone. A midpoint reset targets <strong>{fmtPct(midpointRate)}</strong>, the center of your guardrail band.
              </div>
            </div>
            <div style={{ textAlign: "right", minWidth: 155 }}>
              <div style={{ fontSize: 11.5, color: "#92400e", marginBottom: 2 }}>Midpoint spending</div>
              <div style={{ fontSize: 20, fontWeight: 750, color: "#78350f" }}>{fmtMoney(midpointTotalSpending)}</div>
              <div style={{ fontSize: 13, color: "#92400e" }}>{fmtMoney(midpointTotalSpending / 12)}/mo</div>
              <div style={{ fontSize: 11, color: "#b45309", marginBottom: 8, fontWeight: 500 }}>
                {isMidpointCut ? "−" : "+"}{fmtMoney(Math.abs(midpointTotalSpending - withdrawal))}/yr from current
              </div>
              <button onClick={applyMidpointReset}
                style={{ background: "#d97706", color: "#fff", border: "none", borderRadius: 7, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "#b45309"}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "#d97706"}>
                Apply Midpoint Reset
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* ── PROJECTION ── */}
      <Card>
        <SectionTitle sub={`Age ${currentAge}–${planToAge} · ${ret}% return · ${inf}% inflation · tiered guardrails applied annually${prosperity ? " · Prosperity Rule on" : ""}${annualFixed > 0 ? ` · ${fmtMoney(fixedIncome)}/mo fixed income` : ""}`}>
          {projectionYears}-Year Projection
        </SectionTitle>
        {depleted && (
          <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, marginBottom: 18, fontSize: 13, color: "#b91c1c" }}>
            ⚠️ Portfolio depletes before age {planToAge}. Consider reducing your withdrawal rate, increasing expected returns, or tightening your guardrails.
          </div>
        )}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 10 }}>Portfolio Balance</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={projection} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="age" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} label={{ value: "Age", position: "insideBottomRight", offset: -4, fontSize: 11, fill: "#ccc" }} />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} width={58} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v) => fmtMoney(Number(v))} labelFormatter={(a) => `Age ${a}`} contentStyle={{ fontSize: 12.5, borderRadius: 7 }} />
              <Line type="monotone" dataKey="portfolio" stroke="#2563eb" strokeWidth={2.5} dot={false} name="Portfolio Balance" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 10 }}>
            Annual Spending
            {annualFixed > 0 && <span style={{ fontSize: 11.5, fontWeight: 400, color: "#aaa", marginLeft: 8 }}>— dashed line shows net portfolio draw</span>}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={projection} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="age" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} label={{ value: "Age", position: "insideBottomRight", offset: -4, fontSize: 11, fill: "#ccc" }} />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} width={58} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v) => fmtMoney(Number(v))} labelFormatter={(a) => `Age ${a}`} contentStyle={{ fontSize: 12.5, borderRadius: 7 }} />
              <Line type="monotone" dataKey="withdrawal" stroke="#16a34a" strokeWidth={2.5} dot={false} name="Annual Spending" />
              {annualFixed > 0 && <Line type="monotone" dataKey="netDraw" stroke="#16a34a" strokeWidth={1.5} strokeDasharray="5 4" dot={false} name="Net Portfolio Draw" />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <p style={{ fontSize: 12, color: "#ccc", textAlign: "center", marginTop: 20 }}>For educational purposes only · Not financial advice</p>
    </div>
  );
}
