import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

type NumOrStr = number | string;

const fmtMoney = (n: number) => n <= 0 ? "$0" : "$" + Math.round(n).toLocaleString();
const fmtShort = (n: number) => {
  if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + Math.round(n);
};
const fmtPct = (n: number, d = 1) => n.toFixed(d) + "%";

const DEFAULTS = {
  portfolio: 1900000,
  withdrawal: 85000,
  currentAge: 50,
  endAge: 90,
  ret: 6,
  vol: 12,
  inf: 3,
  targetSuccess: 90,
  lowerBand: 70,
  upperBand: 99,
  adjust: 10,
  extWidth: 10,
  extAdjust: 20,
  trials: 1500,
};

const STORAGE_KEY = "pos-guardrails-settings";

const TIPS: Record<string, string> = {
  portfolio: "The total value of your investment portfolio right now.",
  withdrawal: "What you plan to withdraw this year for living expenses, before any adjustment.",
  currentAge: "Your current age. Used to determine how many years remain in the simulation.",
  endAge: "The age through which your plan needs to last. Common choices: 90 (typical), 95–100 (conservative).",
  ret: "Expected average annual portfolio return, before inflation.",
  vol: "Annual volatility (standard deviation) of returns. ~12% is roughly historical for a 60/40 portfolio; ~15-18% for all-equity.",
  inf: "Expected annual inflation, used to grow withdrawals over time in the simulation.",
  targetSuccess: "Your comfort target for probability of plan success. 85-90% is a common industry default — high enough to be safe, not so high that you're needlessly underspending.",
  lowerBand: "If simulated success probability falls below this, your plan is taking on too much risk — spending is cut.",
  upperBand: "If simulated success probability rises above this, you have more room than needed — spending can increase.",
  adjust: "Standard spending adjustment when a guardrail is crossed.",
  extWidth: "How many additional percentage points beyond a guardrail trigger the larger, extended adjustment.",
  extAdjust: "The larger adjustment applied when success probability is far outside the target band — a bigger miss warrants a stronger correction.",
  trials: "Number of simulated market paths. More trials = smoother, more reliable estimate, but slower to compute.",
  ssClaimAge: "The age you start claiming Social Security. Delaying to 70 maximizes the monthly benefit.",
  ssMonthly: "Your expected monthly benefit in today's dollars — pull this from your ssa.gov statement for your chosen claim age.",
  haircut: "Percentage points subtracted from every historical return before it's used. The favorable US historical record likely overstates future returns (high valuations, survivorship); a 1–2% haircut is a common way to be conservative. Only applies to the historical engine.",
  stockPct: "Your stock allocation. The historical engine blends real US stock and bond returns by this mix each year. Bonds are the remainder.",
  blockLen: "Length of the contiguous block sampled from history. Longer blocks preserve more of the real sequence (e.g. multi-year crashes and recoveries stay intact); 1 = independent single years.",
  spendFloor: "The lowest your spending can be cut to under dynamic guardrails. Cuts won't drive spending below this — it's your essential-expenses backstop.",
};

function clamp(n: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, n)); }

function randNormal(mean: number, sd: number) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Annual REAL (inflation-adjusted) total returns, 1928–2022 (95 years). Derived from
// Damodaran's published nominal S&P 500 total returns and 10-yr Treasury returns, each
// converted to real via (1+nominal)/(1+CPI)−1.
const HIST_STOCK = [0.4548,-0.0883,-0.2000,-0.3807,0.0182,0.4885,-0.0267,0.4248,0.3005,-0.3714,0.3298,-0.0110,-0.1130,-0.2065,0.0930,0.2146,0.1635,0.3284,-0.2248,-0.0334,0.0263,0.2080,0.2349,0.1668,0.1722,-0.0195,0.5200,0.3359,0.0704,-0.1295,0.3951,0.1012,-0.0114,0.2479,-0.1031,0.2116,0.1453,0.1108,-0.1167,0.1979,0.0754,-0.1238,-0.0240,0.0828,0.1490,-0.1714,-0.3189,0.2210,0.1572,-0.1125,-0.0024,0.0870,0.1627,-0.1521,0.1054,0.1778,0.0226,0.2625,0.1419,0.0463,0.1162,0.2591,-0.0737,0.2273,0.0430,0.0687,-0.0138,0.3363,0.1964,0.2882,0.2619,0.1897,-0.1114,-0.1348,-0.2443,0.2412,0.0800,0.0072,0.1551,0.0269,-0.3749,0.2232,0.1286,0.0059,0.1502,0.3119,0.1344,-0.0076,0.1052,0.1869,-0.0608,0.2989,0.1307,-0.2418,0.2213];
const HIST_BOND = [0.0201,0.0360,0.1169,0.0745,0.2124,0.0109,0.0634,0.0144,0.0352,-0.0144,0.0719,0.0441,0.0466,-0.1087,-0.0618,-0.0046,0.0014,0.0153,-0.1541,-0.1054,-0.0114,0.0789,-0.0588,-0.0600,-0.0056,0.0221,0.0029,0.0238,-0.0274,-0.0041,0.0466,-0.0373,0.0518,-0.0006,0.0224,0.0107,0.0188,-0.0167,-0.0189,-0.0467,0.0120,0.0579,-0.0021,-0.0632,-0.0114,0.0052,-0.0321,-0.0918,-0.0299,-0.0134,-0.0572,0.0094,-0.0058,-0.0424,0.0180,0.1067,0.0396,0.1020,0.0552,0.0577,0.1309,0.0368,0.0312,0.0340,-0.0541,0.1366,0.0287,0.1193,0.0663,0.1084,0.0519,0.0018,0.0766,0.0312,0.0399,-0.0297,0.0268,-0.0113,0.1048,-0.1347,0.0686,0.0540,0.0029,0.0913,0.0647,-0.0165,0.0262,-0.0017,0.0253,0.0786,-0.0348,-0.0300,-0.0071,-0.0418,-0.0146];

function makeHistoricalSeries(stockPct: number) {
  const s = stockPct / 100;
  const b = 1 - s;
  const n = Math.min(HIST_STOCK.length, HIST_BOND.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(HIST_STOCK[i] * s + HIST_BOND[i] * b);
  return out;
}

type SimParams = {
  portfolio: number;
  withdrawal: number;
  years: number;
  retMean: number;
  retVol: number;
  trials: number;
  currentAge?: number;
  ssClaimAge?: number;
  ssAnnual?: number;
  ssCola?: boolean;
  inf?: number;
  engine?: string;
  series?: number[] | null;
  blockLen?: number;
  haircut?: number;
  dynamic?: boolean;
  gkUpper?: number;
  gkLower?: number;
  gkAdjust?: number;
  gkExtWidth?: number;
  gkExtAdjust?: number;
  spendFloor?: number;
};

function simulateSuccess(p: SimParams) {
  const {
    portfolio, withdrawal, years, retMean, retVol, trials,
    currentAge = 0, ssClaimAge = 999, ssAnnual = 0, ssCola = true, inf = 0,
    engine = "normal", series = null, blockLen = 5, haircut = 0,
    dynamic = false, gkUpper = 6, gkLower = 4, gkAdjust = 10, gkExtWidth = 2, gkExtAdjust = 20, spendFloor = 0,
  } = p;

  if (years <= 0) return { success: 100, medianFinalSpend: withdrawal };
  const useHist = engine === "historical" && series && series.length > 0;
  const n = useHist ? series!.length : 0;
  const hc = haircut / 100;
  let successes = 0;
  const finalSpends: number[] = [];
  for (let t = 0; t < trials; t++) {
    let bal = portfolio;
    let ok = true;
    let blockPos = 0, blockStart = 0;
    let spend = withdrawal;
    for (let y = 0; y < years; y++) {
      const age = currentAge + y;
      let r: number;
      if (useHist) {
        if (blockPos === 0) {
          blockStart = Math.floor(Math.random() * n);
          blockPos = blockLen;
        }
        const idx = (blockStart + (blockLen - blockPos)) % n;
        r = series![idx] - hc;
        blockPos--;
      } else {
        r = randNormal(retMean / 100, retVol / 100);
      }

      if (dynamic && bal > 0) {
        const curRate = (spend / bal) * 100;
        if (curRate >= gkUpper + gkExtWidth) spend = spend * (1 - gkExtAdjust / 100);
        else if (curRate >= gkUpper) spend = spend * (1 - gkAdjust / 100);
        else if (curRate <= gkLower - gkExtWidth) spend = spend * (1 + gkExtAdjust / 100);
        else if (curRate <= gkLower) spend = spend * (1 + gkAdjust / 100);
        if (spend < spendFloor) spend = spendFloor;
      }

      let ssThisYear = 0;
      if (age >= ssClaimAge && ssAnnual > 0) {
        ssThisYear = ssCola ? ssAnnual : ssAnnual / Math.pow(1 + inf / 100, age - ssClaimAge);
      }
      const portfolioDraw = Math.max(0, spend - ssThisYear);
      bal = bal * (1 + r) - portfolioDraw;
      if (bal <= 0) { ok = false; break; }
    }
    if (ok) successes++;
    finalSpends.push(spend);
  }
  finalSpends.sort((a, b) => a - b);
  const medianFinalSpend = finalSpends[Math.floor(finalSpends.length / 2)] || withdrawal;
  return { success: (successes / trials) * 100, medianFinalSpend };
}

type SsParams = {
  currentAge: number;
  ssClaimAge: number;
  ssAnnual: number;
  ssCola: boolean;
  inf: number;
  engine: string;
  series: number[] | null;
  blockLen: number;
  haircut: number;
};

function withdrawalForTargetSuccess(p: {
  portfolio: number; years: number; retMean: number; retVol: number;
  trials: number; targetSuccess: number; ssParams: Partial<SsParams>;
}) {
  const { portfolio, years, retMean, retVol, trials, targetSuccess, ssParams } = p;
  let lo = 0, hi = portfolio * 0.25 + (ssParams?.ssAnnual || 0);
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const s = simulateSuccess({ portfolio, withdrawal: mid, years, retMean, retVol, trials: Math.min(trials, 500), ...ssParams, dynamic: false }).success;
    if (s > targetSuccess) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function getZone(success: number, lowerBand: number, upperBand: number, extWidth: number) {
  if (success <= lowerBand - extWidth) return "extCut";
  if (success <= lowerBand) return "cut";
  if (success >= upperBand + extWidth) return "extRaise";
  if (success >= upperBand) return "raise";
  return "hold";
}

const ZONE_LABEL: Record<string, string> = {
  extCut: "Deep cut required",
  cut: "Cut spending",
  hold: "On track — hold",
  raise: "Raise spending",
  extRaise: "Significant raise available",
};

const ZONE_COLOR: Record<string, string> = {
  extCut: "#b91c1c",
  cut: "#d97706",
  hold: "#15803d",
  raise: "#1d6fbf",
  extRaise: "#7c3aed",
};

type FieldProps = {
  id: string;
  label: string;
  value: NumOrStr;
  onChange: (v: NumOrStr) => void;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
  activeTip: string | null;
  setActiveTip: (id: string | null) => void;
};

function Field({ id, label, value, onChange, suffix, step = 1, min, max, hint, activeTip, setActiveTip }: FieldProps) {
  return (
    <div className="field">
      <div className="field-label-row">
        <label className="field-label">{label}</label>
        <button
          type="button"
          className="tip-trigger"
          onClick={() => setActiveTip(activeTip === id ? null : id)}
          aria-label={`About ${label}`}
        >?</button>
      </div>
      {activeTip === id && <p className="tip-text">{TIPS[id]}</p>}
      <div className="field-input-wrap">
        <input
          type="number"
          inputMode="decimal"
          className="field-input"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

type BridgeResult = {
  years: number;
  claimAge: number;
  survive: number;
  median: number;
  p10: number;
};

type CalcResult = {
  success: number;
  zone: string;
  recommended: number;
  successAfter: number;
  bridge: BridgeResult | null;
  staticSuccess: number;
  dynamicSuccess: number;
  dynamicMedianSpend: number;
};

type SensPoint = { withdrawal: number; success: number; current?: number };

export default function ProbabilityGuardrailsCalculator({ onRegisterDataGetter }: { onRegisterDataGetter?: (fn: () => Record<string, unknown>) => void }) {
  const [portfolio, setPortfolio] = useState<NumOrStr>(DEFAULTS.portfolio);
  const [withdrawal, setWithdrawal] = useState<NumOrStr>(DEFAULTS.withdrawal);
  const [currentAge, setCurrentAge] = useState<NumOrStr>(DEFAULTS.currentAge);
  const [endAge, setEndAge] = useState<NumOrStr>(DEFAULTS.endAge);
  const [ret, setRet] = useState<NumOrStr>(DEFAULTS.ret);
  const [vol, setVol] = useState<NumOrStr>(DEFAULTS.vol);
  const [inf, setInf] = useState<NumOrStr>(DEFAULTS.inf);
  const [targetSuccess, setTargetSuccess] = useState<NumOrStr>(DEFAULTS.targetSuccess);
  const [lowerBand, setLowerBand] = useState<NumOrStr>(DEFAULTS.lowerBand);
  const [upperBand, setUpperBand] = useState<NumOrStr>(DEFAULTS.upperBand);
  const [adjust, setAdjust] = useState<NumOrStr>(DEFAULTS.adjust);
  const [extWidth, setExtWidth] = useState<NumOrStr>(DEFAULTS.extWidth);
  const [extAdjust, setExtAdjust] = useState<NumOrStr>(DEFAULTS.extAdjust);
  const [trials, setTrials] = useState<NumOrStr>(DEFAULTS.trials);
  const [symmetric, setSymmetric] = useState(false);
  const [ssEnabled, setSsEnabled] = useState(true);
  const [ssClaimAge, setSsClaimAge] = useState<NumOrStr>(70);
  const [ssMonthly, setSsMonthly] = useState<NumOrStr>(4500);
  const [ssCola, setSsCola] = useState(true);
  const [engine, setEngine] = useState("historical");
  const [haircut, setHaircut] = useState<NumOrStr>(2.0);
  const [stockPct, setStockPct] = useState<NumOrStr>(60);
  const [blockLen, setBlockLen] = useState<NumOrStr>(7);
  const [dynamicMode, setDynamicMode] = useState(true);
  const [spendFloor, setSpendFloor] = useState<NumOrStr>(60000);

  const liveDataRef = useRef<Record<string, unknown>>({});
  const runCalcRef = useRef<() => void>(() => {});

  const [activeTip, setActiveTip] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [result, setResult] = useState<CalcResult | null>(null);
  const [sensitivityData, setSensitivityData] = useState<SensPoint[]>([]);
  const [sustainableWithdrawal, setSustainableWithdrawal] = useState<number | null>(null);
  const [computing, setComputing] = useState(false);
  const [stale, setStale] = useState(true);

  const num = (v: NumOrStr, fallback = 0): number =>
    (v === "" || v == null || isNaN(Number(v)) ? fallback : Number(v));
  const years = Math.max(0, num(endAge) - num(currentAge));

  useEffect(() => { setStale(true); }, [
    portfolio, withdrawal, currentAge, endAge, ret, vol, inf,
    targetSuccess, lowerBand, upperBand, adjust, extWidth, extAdjust, trials,
    ssEnabled, ssClaimAge, ssMonthly, ssCola,
    engine, haircut, stockPct, blockLen, dynamicMode, spendFloor,
  ]);

  const runCalc = () => {
    setComputing(true);
    setTimeout(() => {
      const p = num(portfolio), w = num(withdrawal);
      const r = num(ret), v = num(vol), tr = clamp(num(trials, 1500), 100, 5000);
      const tgt = num(targetSuccess), lb = num(lowerBand), ub = num(upperBand);
      const ew = num(extWidth), adj = num(adjust), eadj = num(extAdjust), infl = num(inf);

      const ssParams = {
        currentAge: num(currentAge),
        ssClaimAge: ssEnabled ? num(ssClaimAge) : 999,
        ssAnnual: ssEnabled ? num(ssMonthly) * 12 : 0,
        ssCola,
        inf: infl,
      };

      const engineParams = {
        engine,
        series: engine === "historical" ? makeHistoricalSeries(num(stockPct, 60)) : null,
        blockLen: clamp(num(blockLen, 5), 1, 20),
        haircut: num(haircut, 0),
      };

      const initRate = p > 0 ? (w / p) * 100 : 0;
      const gkParams = {
        gkUpper: initRate * 1.2,
        gkLower: initRate * 0.8,
        gkAdjust: adj,
        gkExtWidth: initRate * 0.1,
        gkExtAdjust: eadj,
        spendFloor: num(spendFloor, 0),
      };

      const simBase = { ...ssParams, ...engineParams };

      const staticRes = simulateSuccess({ portfolio: p, withdrawal: w, years, retMean: r, retVol: v, trials: tr, ...simBase, dynamic: false });
      const dynRes = simulateSuccess({ portfolio: p, withdrawal: w, years, retMean: r, retVol: v, trials: tr, ...simBase, dynamic: true, ...gkParams });

      const success = dynamicMode ? dynRes.success : staticRes.success;
      const zone = getZone(success, lb, ub, ew);
      const isExtended = zone === "extCut" || zone === "extRaise";
      const pct = isExtended ? eadj : adj;

      let recommended = w;
      if (zone === "cut" || zone === "extCut") recommended = w * (1 - pct / 100);
      else if (zone === "raise" || zone === "extRaise") recommended = w * (1 + pct / 100);
      else recommended = w * (1 + infl / 100);

      const successAfter = simulateSuccess({ portfolio: p, withdrawal: recommended, years, retMean: r, retVol: v, trials: tr, ...simBase, dynamic: dynamicMode, ...gkParams }).success;

      const points: SensPoint[] = [];
      const steps = 10;
      const minW = w * 0.5, maxW = w * 1.6;
      const chartTrials = Math.min(tr, 1000);
      for (let i = 0; i <= steps; i++) {
        const wi = minW + (maxW - minW) * (i / steps);
        const wiInit = p > 0 ? (wi / p) * 100 : 0;
        const gkP = dynamicMode
          ? { dynamic: true, gkUpper: wiInit * 1.2, gkLower: wiInit * 0.8, gkAdjust: adj, gkExtWidth: wiInit * 0.1, gkExtAdjust: eadj, spendFloor: num(spendFloor, 0) }
          : { dynamic: false };
        const s = simulateSuccess({ portfolio: p, withdrawal: wi, years, retMean: r, retVol: v, trials: chartTrials, ...simBase, ...gkP }).success;
        points.push({ withdrawal: wi, success: s });
      }
      points.push({ withdrawal: w, success, current: success });
      points.sort((a, b) => a.withdrawal - b.withdrawal);

      const sustainable = withdrawalForTargetSuccess({ portfolio: p, years, retMean: r, retVol: v, trials: tr, targetSuccess: tgt, ssParams: simBase });

      let bridge: BridgeResult | null = null;
      if (ssEnabled && num(ssClaimAge) > num(currentAge)) {
        const bridgeYears = num(ssClaimAge) - num(currentAge);
        const ser = engineParams.series;
        const useHist = engineParams.engine === "historical" && ser && ser.length > 0;
        const nH = useHist ? ser!.length : 0;
        const hc = engineParams.haircut / 100;
        const bl = engineParams.blockLen;
        let bridgeSurvive = 0;
        const endBalances: number[] = [];
        for (let t = 0; t < tr; t++) {
          let bal = p;
          let ok = true;
          let bp = 0, bs = 0;
          for (let y = 0; y < bridgeYears; y++) {
            let rr: number;
            if (useHist) {
              if (bp === 0) { bs = Math.floor(Math.random() * nH); bp = bl; }
              const idx = (bs + (bl - bp)) % nH;
              rr = ser![idx] - hc; bp--;
            } else {
              rr = randNormal(r / 100, v / 100);
            }
            bal = bal * (1 + rr) - w;
            if (bal <= 0) { ok = false; bal = 0; break; }
          }
          if (ok) bridgeSurvive++;
          endBalances.push(bal);
        }
        endBalances.sort((a, b) => a - b);
        const median = endBalances[Math.floor(endBalances.length / 2)];
        const p10 = endBalances[Math.floor(endBalances.length * 0.10)];
        bridge = { years: bridgeYears, claimAge: num(ssClaimAge), survive: (bridgeSurvive / tr) * 100, median, p10 };
      }

      setResult({
        success, zone, recommended, successAfter, bridge,
        staticSuccess: staticRes.success,
        dynamicSuccess: dynRes.success,
        dynamicMedianSpend: dynRes.medianFinalSpend,
      });
      setSensitivityData(points);
      setSustainableWithdrawal(sustainable);
      setStale(false);
      setComputing(false);
    }, 30);
  };
  runCalcRef.current = runCalc;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const set = (k: string, fn: (v: NumOrStr) => void) => { if (d[k] != null) fn(d[k]); };
        const setB = (k: string, fn: (v: boolean) => void) => { if (d[k] != null) fn(d[k]); };
        const setS = (k: string, fn: (v: string) => void) => { if (d[k] != null) fn(d[k]); };
        set("portfolio", setPortfolio); set("withdrawal", setWithdrawal);
        set("currentAge", setCurrentAge); set("endAge", setEndAge);
        set("ret", setRet); set("vol", setVol); set("inf", setInf);
        set("targetSuccess", setTargetSuccess); set("lowerBand", setLowerBand);
        set("upperBand", setUpperBand); set("adjust", setAdjust);
        set("extWidth", setExtWidth); set("extAdjust", setExtAdjust);
        set("trials", setTrials);
        setB("symmetric", setSymmetric); setB("ssEnabled", setSsEnabled);
        set("ssClaimAge", setSsClaimAge); set("ssMonthly", setSsMonthly);
        setB("ssCola", setSsCola); setS("engine", setEngine);
        set("haircut", setHaircut); set("stockPct", setStockPct);
        set("blockLen", setBlockLen);
        setB("dynamicMode", setDynamicMode);
        set("spendFloor", setSpendFloor);
        if (d.savedAt) setSavedAt(d.savedAt);
      }
    } catch { /* no saved state */ }
    setTimeout(() => runCalcRef.current(), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = () => {
    setSaveStatus("saving");
    setSaveError(null);
    const ts = new Date().toLocaleString();
    const data = JSON.stringify({
      portfolio, withdrawal, currentAge, endAge, ret, vol, inf,
      targetSuccess, lowerBand, upperBand, adjust, extWidth, extAdjust, trials, symmetric,
      ssEnabled, ssClaimAge, ssMonthly, ssCola,
      engine, haircut, stockPct, blockLen, dynamicMode, spendFloor,
      savedAt: ts,
    });
    try {
      localStorage.setItem(STORAGE_KEY, data);
      setSavedAt(ts);
      setSaveStatus("saved");
    } catch (e) {
      setSaveError(String(e));
      setSaveStatus("error");
    }
    setTimeout(() => setSaveStatus(null), 4000);
  };

  const handleReset = () => {
    setSaveStatus("resetting");
    setPortfolio(DEFAULTS.portfolio); setWithdrawal(DEFAULTS.withdrawal);
    setCurrentAge(DEFAULTS.currentAge); setEndAge(DEFAULTS.endAge);
    setRet(DEFAULTS.ret); setVol(DEFAULTS.vol); setInf(DEFAULTS.inf);
    setTargetSuccess(DEFAULTS.targetSuccess); setLowerBand(DEFAULTS.lowerBand);
    setUpperBand(DEFAULTS.upperBand); setAdjust(DEFAULTS.adjust);
    setExtWidth(DEFAULTS.extWidth); setExtAdjust(DEFAULTS.extAdjust);
    setTrials(DEFAULTS.trials); setSymmetric(false);
    setSsEnabled(true); setSsClaimAge(70); setSsMonthly(4500); setSsCola(true);
    setEngine("historical"); setHaircut(2.0); setStockPct(60); setBlockLen(7);
    setDynamicMode(true); setSpendFloor(60000);
    setTimeout(() => runCalcRef.current(), 80);
    setTimeout(() => setSaveStatus(null), 1200);
  };

  const onLowerChange = (val: NumOrStr) => {
    setLowerBand(val);
    if (symmetric && val !== "") {
      const dist = num(targetSuccess) - num(val);
      setUpperBand(clamp(num(targetSuccess) + dist, num(targetSuccess) + 1, 100));
    }
  };
  const onUpperChange = (val: NumOrStr) => {
    setUpperBand(val);
    if (symmetric && val !== "") {
      const dist = num(val) - num(targetSuccess);
      setLowerBand(clamp(num(targetSuccess) - dist, 0, num(targetSuccess) - 1));
    }
  };
  const onTargetChange = (val: NumOrStr) => {
    const lowerDist = num(targetSuccess) - num(lowerBand);
    setTargetSuccess(val);
    if (symmetric && val !== "") {
      setLowerBand(clamp(num(val) - lowerDist, 0, num(val) - 1));
      setUpperBand(clamp(num(val) + lowerDist, num(val) + 1, 100));
    }
  };

  // Keep ref current so App can read live state for export
  liveDataRef.current = {
    portfolio, withdrawal, currentAge, endAge, ret, vol, inf,
    targetSuccess, lowerBand, upperBand, adjust, extWidth, extAdjust, trials, symmetric,
    ssEnabled, ssClaimAge, ssMonthly, ssCola,
    engine, haircut, stockPct, blockLen, dynamicMode, spendFloor,
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onRegisterDataGetter?.(() => liveDataRef.current); }, []);

  const zoneColor = result ? ZONE_COLOR[result.zone] : "#5dc9a8";
  const zoneLabel = result ? ZONE_LABEL[result.zone] : "—";
  const tipProps = { activeTip, setActiveTip };

  return (
    <div className="pg-root">
      <style>{`
        .pg-root {
          --bg: #f7f7f7;
          --panel: #ffffff;
          --panel-2: #f5f5f5;
          --border: #e2e2e2;
          --text: #1a1a1a;
          --text-dim: #555;
          --text-faint: #aaa;
          --accent: #2563eb;
          font-family: 'IBM Plex Sans', -apple-system, sans-serif;
          background: var(--bg);
          color: var(--text);
          min-height: 100vh;
          padding: 20px 14px 80px;
          box-sizing: border-box;
        }
        .pg-root * { box-sizing: border-box; }
        .pg-container { max-width: 1100px; margin: 0 auto; }
        .pg-title {
          font-family: 'Crimson Text', Georgia, serif;
          font-size: clamp(22px, 5vw, 32px);
          font-weight: 600;
          margin: 0 0 4px;
        }
        .pg-subtitle {
          color: var(--text-dim);
          font-size: 13.5px;
          margin: 0 0 16px;
          line-height: 1.5;
          max-width: 640px;
        }
        .pg-note {
          background: var(--panel-2);
          border: 1px solid var(--border);
          border-left: 3px solid var(--accent);
          border-radius: 6px;
          padding: 11px 13px;
          font-size: 12px;
          color: var(--text-dim);
          line-height: 1.55;
          margin-bottom: 20px;
        }
        .pg-grid {
          display: grid;
          grid-template-columns: 1fr 370px;
          gap: 18px;
          align-items: start;
        }
        @media (max-width: 820px) {
          .pg-grid { grid-template-columns: 1fr; gap: 0; }
          .pg-result { order: -1; margin-bottom: 18px; }
          .pg-result-sticky { position: static !important; }
        }
        .pg-panel {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 18px;
        }
        .pg-panel + .pg-panel { margin-top: 14px; }
        .pg-panel-title {
          font-size: 12.5px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-dim);
          margin: 0 0 14px;
        }
        .field-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        @media (max-width: 420px) {
          .field-row { grid-template-columns: 1fr; gap: 0; }
        }
        .field { margin-bottom: 14px; }
        .field-label-row {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 6px; gap: 8px;
        }
        .field-label { font-size: 12.5px; color: var(--text-dim); font-weight: 500; }
        .tip-trigger {
          width: 18px; height: 18px; min-width: 18px;
          border-radius: 50%; background: transparent;
          border: 1px solid var(--text-faint); color: var(--text-faint);
          font-size: 10px; line-height: 1; cursor: pointer; padding: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .tip-trigger:active { border-color: var(--accent); color: var(--accent); }
        .tip-text {
          font-size: 12px; color: var(--text-dim);
          background: var(--panel-2); border-radius: 6px;
          padding: 8px 10px; margin: 0 0 8px; line-height: 1.5;
        }
        .field-input-wrap { position: relative; display: flex; align-items: center; }
        .field-input {
          width: 100%; background: var(--panel-2);
          border: 1px solid var(--border); border-radius: 7px;
          color: var(--text); font-size: 16px; padding: 11px 12px;
          font-family: inherit; min-height: 46px;
        }
        .field-input:focus { outline: none; border-color: var(--accent); }
        .field-suffix {
          position: absolute; right: 12px; color: var(--text-faint);
          font-size: 13px; pointer-events: none;
        }
        .field-hint { font-size: 11.5px; color: var(--text-faint); margin: 5px 0 0; }
        .pg-result-sticky { position: sticky; top: 14px; }
        .result-zone { border-radius: 10px; padding: 16px; margin-bottom: 12px; border: 1px solid var(--border); }
        .result-zone-label {
          font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em;
          font-weight: 600; margin-bottom: 6px; display: flex; align-items: center;
        }
        .result-amount {
          font-family: 'Crimson Text', Georgia, serif;
          font-size: 36px; font-weight: 600; line-height: 1.1; margin: 4px 0;
        }
        .result-amount.stale { opacity: 0.4; }
        .result-sub { font-size: 12.5px; color: var(--text-dim); margin: 4px 0 0; }
        .result-stat-row {
          display: flex; justify-content: space-between; gap: 10px;
          padding: 9px 0; border-bottom: 1px solid var(--border); font-size: 12.5px;
        }
        .result-stat-row:last-child { border-bottom: none; }
        .result-stat-label { color: var(--text-dim); }
        .result-stat-value { font-weight: 600; text-align: right; }
        .calc-btn {
          width: 100%; padding: 13px; border-radius: 8px; border: none;
          background: var(--accent); color: #fff; font-size: 14.5px;
          font-weight: 600; cursor: pointer; font-family: inherit; min-height: 48px;
          margin-bottom: 12px;
        }
        .calc-btn:disabled { opacity: 0.6; cursor: default; }
        .calc-btn.stale { box-shadow: 0 0 0 2px rgba(93,156,232,0.3); }
        .toggle-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 0; width: 100%;
        }
        .toggle-label { font-size: 12.5px; color: var(--text-dim); }
        .toggle-switch {
          width: 40px; height: 24px; min-width: 40px; border-radius: 12px;
          background: var(--border); border: none; position: relative; cursor: pointer;
          transition: background 0.15s;
        }
        .toggle-switch.on { background: var(--accent); }
        .toggle-knob {
          position: absolute; top: 2px; left: 2px; width: 20px; height: 20px;
          border-radius: 50%; background: #fff; transition: left 0.15s;
        }
        .toggle-switch.on .toggle-knob { left: 18px; }
        .btn-row { display: flex; gap: 10px; margin-top: 14px; }
        .bridge-box {
          margin-top: 12px; padding: 12px 14px;
          background: var(--panel-2); border: 1px solid var(--border);
          border-left: 3px solid #d97706; border-radius: 8px;
        }
        .bridge-title {
          font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em;
          font-weight: 600; color: #d97706; margin-bottom: 6px;
        }
        .bridge-box .result-stat-row { padding: 7px 0; }
        .bridge-note { font-size: 11px; color: var(--text-faint); margin: 8px 0 0; line-height: 1.5; }
        .ref-line .result-stat-label, .ref-line .result-stat-value { color: var(--text-faint); font-weight: 400; font-size: 12px; }
        .ref-delta { color: #15803d; }
        .btn {
          flex: 1; padding: 11px 14px; border-radius: 7px;
          border: 1px solid var(--border); background: var(--panel-2);
          color: var(--text); font-size: 13px; font-weight: 500;
          cursor: pointer; min-height: 44px; font-family: inherit;
        }
        .btn:active { border-color: var(--accent); }
        .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
        .save-msg { font-size: 12px; color: var(--text-faint); margin-top: 8px; text-align: center; }
        .save-msg.error { color: #e85d5d; }
        .chart-wrap { margin-top: 6px; height: 190px; }
        .chart-caption { font-size: 11.5px; color: var(--text-faint); margin: 6px 0 0; line-height: 1.5; }
        .legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
        .engine-toggle {
          display: flex; gap: 6px; margin-bottom: 16px;
          background: var(--panel-2); padding: 4px; border-radius: 8px;
        }
        .engine-btn {
          flex: 1; padding: 9px 8px; border-radius: 6px; border: none;
          background: transparent; color: var(--text-dim); font-size: 12.5px;
          font-weight: 500; cursor: pointer; font-family: inherit; min-height: 40px;
        }
        .engine-btn.active { background: var(--accent); color: #fff; font-weight: 600; }
      `}</style>

      <div className="pg-container">
        <h1 className="pg-title">Probability-of-Success Guardrails</h1>
        <p className="pg-subtitle">
          Runs a Monte Carlo simulation from your current portfolio and remaining horizon, then adjusts spending based on
          how your probability of plan success has moved — rather than off your withdrawal rate.
        </p>

        <div className="pg-note">
          <strong>How this differs from rate-based guardrails:</strong> withdrawal rate can't tell two retirees with the
          same rate but different ages apart. Probability of success accounts for time remaining directly — research
          (Kitces/Income Lab, 2021–2024) argues this is a more robust trigger. Tradeoff: results depend on your return and
          volatility assumptions, and this normal-distribution Monte Carlo tends to read more optimistic than historical
          backtesting because it understates sequence-of-returns risk.
        </div>

        <div className="pg-grid">
          <div>
            <div className="pg-panel">
              <h2 className="pg-panel-title">Current position</h2>
              <div className="field-row">
                <Field id="portfolio" label="Portfolio balance" value={portfolio} onChange={setPortfolio} suffix="$" step={10000} {...tipProps} />
                <Field id="withdrawal" label="Current withdrawal" value={withdrawal} onChange={setWithdrawal} suffix="$" step={1000} {...tipProps} />
              </div>
              <div className="field-row">
                <Field id="currentAge" label="Current age" value={currentAge} onChange={setCurrentAge} step={1} {...tipProps} />
                <Field id="endAge" label="Plan through age" value={endAge} onChange={setEndAge} step={1} hint={`${years} years remaining`} {...tipProps} />
              </div>
            </div>

            <div className="pg-panel">
              <h2 className="pg-panel-title">Market engine</h2>
              <div className="engine-toggle">
                <button
                  className={`engine-btn ${engine === "normal" ? "active" : ""}`}
                  onClick={() => setEngine("normal")}
                >Normal distribution</button>
                <button
                  className={`engine-btn ${engine === "historical" ? "active" : ""}`}
                  onClick={() => setEngine("historical")}
                >Historical bootstrap</button>
              </div>

              {engine === "normal" ? (
                <div className="field-row">
                  <Field id="ret" label="Expected return" value={ret} onChange={setRet} suffix="%" step={0.5} {...tipProps} />
                  <Field id="vol" label="Volatility (SD)" value={vol} onChange={setVol} suffix="%" step={0.5} {...tipProps} />
                </div>
              ) : (
                <>
                  <div className="field-row">
                    <Field id="stockPct" label="Stock allocation" value={stockPct} onChange={setStockPct} suffix="%" step={5} min={0} max={100} {...tipProps} />
                    <Field id="haircut" label="Return haircut" value={haircut} onChange={setHaircut} suffix="pts" step={0.25} {...tipProps} />
                  </div>
                  <Field id="blockLen" label="Block length" value={blockLen} onChange={setBlockLen} suffix="yrs" step={1} min={1} max={20} {...tipProps} />
                  <p className="field-hint" style={{ marginTop: -4 }}>
                    Samples real US stock/bond returns (1928–2024) in {clamp(num(blockLen, 5), 1, 20)}-year blocks, minus a {num(haircut)}pt haircut. Preserves historical crash-clustering that the normal engine misses.
                  </p>
                </>
              )}
              <div className="field-row" style={{ marginTop: 14 }}>
                <Field id="inf" label="Inflation" value={inf} onChange={setInf} suffix="%" step={0.5} {...tipProps} />
                <Field id="trials" label="Simulation trials" value={trials} onChange={setTrials} step={500} min={100} max={5000} {...tipProps} />
              </div>
            </div>

            <div className="pg-panel">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ssEnabled ? 14 : 0 }}>
                <h2 className="pg-panel-title" style={{ margin: 0 }}>Social Security</h2>
                <button
                  className={`toggle-switch ${ssEnabled ? "on" : ""}`}
                  onClick={() => setSsEnabled(!ssEnabled)}
                  aria-label="Toggle Social Security"
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              {ssEnabled && (
                <>
                  <div className="field-row">
                    <Field id="ssClaimAge" label="Claim age" value={ssClaimAge} onChange={setSsClaimAge} step={1} min={62} max={70} {...tipProps} />
                    <Field id="ssMonthly" label="Monthly benefit" value={ssMonthly} onChange={setSsMonthly} suffix="$" step={100} {...tipProps} />
                  </div>
                  <div className="toggle-row">
                    <span className="toggle-label">Inflation-adjusted (COLA)</span>
                    <button
                      className={`toggle-switch ${ssCola ? "on" : ""}`}
                      onClick={() => setSsCola(!ssCola)}
                      aria-label="Toggle COLA"
                    >
                      <span className="toggle-knob" />
                    </button>
                  </div>
                  <p className="field-hint" style={{ marginTop: 4 }}>
                    {fmtMoney(num(ssMonthly) * 12)}/yr starting at age {num(ssClaimAge)} reduces the portfolio draw, not your spending.
                  </p>
                </>
              )}
            </div>

            <div className="pg-panel">
              <h2 className="pg-panel-title">Guardrail bands</h2>
              <Field id="targetSuccess" label="Target success rate" value={targetSuccess} onChange={onTargetChange} suffix="%" step={1} min={50} max={99} {...tipProps} />
              <div className="toggle-row">
                <span className="toggle-label">Keep bands symmetric around target</span>
                <button
                  className={`toggle-switch ${symmetric ? "on" : ""}`}
                  onClick={() => setSymmetric(!symmetric)}
                  aria-label="Toggle symmetric bands"
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="field-row">
                <Field id="lowerBand" label="Lower guardrail (cut)" value={lowerBand} onChange={onLowerChange} suffix="%" step={1} min={0} {...tipProps} />
                <Field id="upperBand" label="Upper guardrail (raise)" value={upperBand} onChange={onUpperChange} suffix="%" step={1} max={100} {...tipProps} />
              </div>
              <div className="field-row">
                <Field id="adjust" label="Standard adjustment" value={adjust} onChange={setAdjust} suffix="%" step={1} {...tipProps} />
                <Field id="extWidth" label="Extended zone width" value={extWidth} onChange={setExtWidth} suffix="pts" step={1} {...tipProps} />
              </div>
              <Field id="extAdjust" label="Extended adjustment" value={extAdjust} onChange={setExtAdjust} suffix="%" step={1} {...tipProps} />
            </div>

            <div className="pg-panel">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: dynamicMode ? 14 : 4 }}>
                <h2 className="pg-panel-title" style={{ margin: 0 }}>Spending strategy</h2>
                <button
                  className={`toggle-switch ${dynamicMode ? "on" : ""}`}
                  onClick={() => setDynamicMode(!dynamicMode)}
                  aria-label="Toggle dynamic guardrails"
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <p className="field-hint" style={{ marginTop: 0, marginBottom: dynamicMode ? 12 : 0 }}>
                {dynamicMode
                  ? "Dynamic (recommended): spending flexes — cut or raised inside each simulated path when the withdrawal rate breaches the bands. This models the strategy you'd actually follow, so the headline success rate reflects it."
                  : "Static: spending held fixed in real terms every year. This is a strawman that ignores the whole point of guardrails — the headline rate will understate your real robustness. Leave dynamic on unless you're deliberately testing the no-flex case."}
              </p>
              {dynamicMode && (
                <Field id="spendFloor" label="Spending floor (cuts stop here)" value={spendFloor} onChange={setSpendFloor} suffix="$" step={1000} {...tipProps} />
              )}
            </div>
          </div>

          <div className="pg-result">
            <div className="pg-result-sticky">
              <button
                className={`calc-btn ${stale && !computing ? "stale" : ""}`}
                onClick={runCalc}
                disabled={computing}
              >
                {computing ? "Calculating…" : stale ? "Update results" : "Recalculate"}
              </button>

              <div className="pg-panel" style={{ borderColor: zoneColor }}>
                <div className="result-zone">
                  <div className="result-zone-label" style={{ color: zoneColor }}>
                    <span className="legend-dot" style={{ background: zoneColor }} />
                    {zoneLabel}
                  </div>
                  <div className={`result-amount ${stale ? "stale" : ""}`}>
                    {result ? fmtMoney(result.recommended) : "—"}
                  </div>
                  <p className="result-sub">recommended withdrawal for this year</p>
                </div>

                <div className="result-stat-row">
                  <span className="result-stat-label">Success rate{dynamicMode ? " (with guardrails)" : " (static)"}</span>
                  <span className="result-stat-value">{result ? fmtPct(result.success) : "—"}</span>
                </div>

                {result && dynamicMode && result.staticSuccess != null && (
                  <>
                    <div className="result-stat-row ref-line">
                      <span className="result-stat-label">For reference: fixed spending</span>
                      <span className="result-stat-value">
                        {fmtPct(result.staticSuccess)}
                        {result.dynamicSuccess > result.staticSuccess && <span className="ref-delta"> · flexing adds {(result.dynamicSuccess - result.staticSuccess).toFixed(0)} pts</span>}
                      </span>
                    </div>
                    <div className="result-stat-row">
                      <span className="result-stat-label">Median spending under guardrails</span>
                      <span className="result-stat-value">{fmtMoney(result.dynamicMedianSpend)}</span>
                    </div>
                  </>
                )}
                {ssEnabled && (
                  <div className="result-stat-row">
                    <span className="result-stat-label">SS covers (at {num(ssClaimAge)})</span>
                    <span className="result-stat-value">{fmtMoney(num(ssMonthly) * 12)}/yr</span>
                  </div>
                )}
                <div className="result-stat-row">
                  <span className="result-stat-label">Success after adjustment</span>
                  <span className="result-stat-value">{result ? fmtPct(result.successAfter) : "—"}</span>
                </div>
                <div className="result-stat-row">
                  <span className="result-stat-label">Target band</span>
                  <span className="result-stat-value">{fmtPct(num(lowerBand), 0)} – {fmtPct(num(upperBand), 0)}</span>
                </div>
                <div className="result-stat-row">
                  <span className="result-stat-label">Withdrawal at target</span>
                  <span className="result-stat-value">{sustainableWithdrawal != null ? fmtMoney(sustainableWithdrawal) : "—"}</span>
                </div>
                <div className="result-stat-row">
                  <span className="result-stat-label">Engine</span>
                  <span className="result-stat-value">{engine === "historical" ? `Historical −${num(haircut)}pt` : "Normal dist."}</span>
                </div>
                <div className="result-stat-row">
                  <span className="result-stat-label">Years remaining</span>
                  <span className="result-stat-value">{years}</span>
                </div>

                {result && result.bridge && (
                  <div className="bridge-box">
                    <div className="bridge-title">Pre-SS bridge stress (age {num(currentAge)}–{result.bridge.claimAge})</div>
                    <div className="result-stat-row">
                      <span className="result-stat-label">Portfolio survives bridge alone</span>
                      <span className="result-stat-value" style={{ color: result.bridge.survive >= 90 ? "#15803d" : result.bridge.survive >= 75 ? "#d97706" : "#b91c1c" }}>
                        {fmtPct(result.bridge.survive)}
                      </span>
                    </div>
                    <div className="result-stat-row">
                      <span className="result-stat-label">Median balance at {result.bridge.claimAge}</span>
                      <span className="result-stat-value">{fmtMoney(result.bridge.median)}</span>
                    </div>
                    <div className="result-stat-row">
                      <span className="result-stat-label">Poor case (10th pct) at {result.bridge.claimAge}</span>
                      <span className="result-stat-value">{fmtMoney(result.bridge.p10)}</span>
                    </div>
                    <p className="bridge-note">
                      Full {fmtMoney(num(withdrawal))} draw from the portfolio alone, before SS starts. This is the window most exposed to a bad early sequence.
                    </p>
                  </div>
                )}

                <div className="btn-row">
                  <button className="btn btn-primary" onClick={handleSave} disabled={saveStatus === "saving"}>
                    {saveStatus === "saving" ? "Saving…" : "Save"}
                  </button>
                  <button className="btn" onClick={handleReset}>Reset</button>
                </div>
                {saveStatus === "saved" && <p className="save-msg">✓ Saved {savedAt}</p>}
                {saveStatus === "resetting" && <p className="save-msg">Reset to defaults</p>}
                {saveStatus === "error" && <p className="save-msg error">Save failed: {saveError}</p>}
                {!saveStatus && savedAt && <p className="save-msg">Last saved {savedAt}</p>}
              </div>

              <div className="pg-panel">
                <h2 className="pg-panel-title">Success rate vs. withdrawal</h2>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sensitivityData} margin={{ top: 5, right: 10, left: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e8e8e8" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="withdrawal" type="number" domain={["dataMin", "dataMax"]} tickFormatter={fmtShort} stroke="#ccc" fontSize={11} tick={{ fill: "#888" }} />
                      <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => v + "%"} stroke="#ccc" fontSize={11} tick={{ fill: "#888" }} width={46} />
                      <Tooltip
                        contentStyle={{ background: "#fff", border: "1px solid #e2e2e2", borderRadius: 6, fontSize: 12, color: "#1a1a1a" }}
                        labelFormatter={(v) => fmtShort(Number(v))}
                        formatter={(v) => [fmtPct(Number(v)), "Success"]}
                      />
                      <ReferenceLine y={num(targetSuccess)} stroke="#15803d" strokeDasharray="4 4" />
                      <ReferenceLine x={num(withdrawal)} stroke="#555" strokeDasharray="2 2" />
                      <Area type="monotone" dataKey="success" stroke="#2563eb" fill="url(#successGrad)" strokeWidth={2} isAnimationActive={false} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <p className="chart-caption">
                  Dashed teal = target. White line = current withdrawal. Curve shows how success probability changes if you
                  spent more or less.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
