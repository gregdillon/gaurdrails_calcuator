import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot,
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
  lowerBand: 65,
  upperBand: 98,
  adjust: 10,
  extWidth: 10,
  extAdjust: 20,
  trials: 1500,
  // Reserve to reach SS claim age with: the post-SS spending shortfall
  // (≈ $85k draw − $54k SS) discounted over the ~20 post-SS years at ~3% real ≈ $450k.
  bridgeMinBalance: 450000,
};

// The bridge confidence floor defaults to this many points below the target success rate,
// keeping it a subordinate early-warning floor rather than a second full-strength constraint
// that would double-count the post-SS risk already captured in the headline success number.
const BRIDGE_CONFIDENCE_OFFSET = 20;

const STORAGE_KEY = "pos-guardrails-settings";

const TIPS: Record<string, string> = {
  portfolio: "The total value of your investment portfolio right now.",
  withdrawal: "What you plan to withdraw this year for living expenses, before any adjustment.",
  currentAge: "Your current age. Used to determine how many years remain in the simulation.",
  endAge: "The age through which your plan needs to last. Common choices: 90 (typical), 95–100 (conservative).",
  ret: "Expected average annual portfolio return, before inflation.",
  vol: "Annual volatility (standard deviation) of returns. ~12% is roughly historical for a 60/40 portfolio; ~15-18% for all-equity.",
  inf: "Expected annual inflation. The simulation runs in today's dollars, so this converts your nominal expected return to a real return and erodes any non-COLA Social Security over time.",
  targetSuccess: "Your comfort target for probability of plan success. 85-90% is a common industry default — high enough to be safe, not so high that you're needlessly underspending.",
  lowerBand: "If simulated success probability falls below this, your plan is taking on too much risk — spending is cut.",
  upperBand: "If simulated success probability rises above this, you have more room than needed — spending can increase.",
  adjust: "Standard spending adjustment when a guardrail is crossed.",
  extWidth: "How many additional percentage points beyond the guardrail trigger the larger deep cut or raise. E.g. if the lower band is 70% and this is 10, a deep cut applies when success falls below 60%.",
  extAdjust: "The larger adjustment applied when success probability is far outside the target band — a bigger miss warrants a stronger correction.",
  trials: "Number of simulated market paths. More trials = smoother, more reliable estimate, but slower to compute.",
  ssClaimAge: "The age you start claiming Social Security. Delaying to 70 maximizes the monthly benefit.",
  ssMonthly: "Your expected monthly benefit in today's dollars — pull this from your ssa.gov statement for your chosen claim age.",
  haircut: "Percentage points subtracted from every historical return before it's used. The favorable US historical record likely overstates future returns (high valuations, survivorship); a 1–2% haircut is a common way to be conservative. Only applies to the historical engine.",
  stockPct: "Your stock allocation. The historical engine blends real US stock and bond returns by this mix each year. Bonds are the remainder.",
  blockLen: "Length of the contiguous block sampled from history. Longer blocks preserve more of the real sequence (e.g. multi-year crashes and recoveries stay intact); 1 = independent single years.",
  spendFloor: "The lowest your spending can be cut to under dynamic guardrails. Cuts won't drive spending below this — it's your essential-expenses backstop.",
  floorWarnPct: "Your spending floor is a fixed dollar amount, so it can quietly fall behind as your withdrawal grows with inflation. This sets the threshold (as a share of current withdrawal) below which a warning appears next to the floor field, prompting you to revisit it. Doesn't affect the calculation itself — just a reminder.",
  bridgeGuardrail: "When enabled, the chance your portfolio reaches SS claim age with at least your target reserve is treated as a safety floor. If that chance falls below the threshold you set, the spending recommendation is made more conservative — even if the full-plan success rate is in the safe zone. A badly missed floor escalates to a deeper cut. This protects against the period most exposed to sequence-of-returns risk.",
  bridgeFloor: "The minimum confidence you require of reaching SS claim age with at least your minimum balance. Below it, spending is cut regardless of the full-plan success rate. Read it as a downside test: 85% means your reserve must survive all but the worst 15% of outcomes (your ~15th-percentile balance); 75% means all but the worst 25%. It defaults to your target success rate minus 15 points — that keeps the bridge a supplementary early-warning floor rather than a second full-strength constraint that would double-count the post-SS risk already in the headline number. By default it auto-tracks your target; switch on 'Set required confidence manually' to enter a custom value that won't move when the target changes. Turning the override back off restores the tracked default.",
  bridgeMinBalance: "The portfolio balance you want to still have when Social Security starts. Success on the bridge means reaching claim age with at least this much, not merely avoiding $0 — over a long bridge, arriving with a near-empty portfolio still leaves decades to fund. A sensible value is roughly the present value of your post-SS spending shortfall (what the portfolio still has to cover once SS is flowing). Set to 0 to score the bridge purely on not running out.",
  successPair: "Now: the simulated probability that your portfolio lasts through your planning horizon at your current withdrawal level. After adjustment: what that probability becomes if you follow the guardrail recommendation this year. A healthy plan sits between your lower and upper guardrail bands — the adjustment is designed to bring you back toward your target.",
  symmetric: "A one-click helper: sets the lower guardrail so it sits the same distance below your target success rate as the upper guardrail sits above it (e.g. target 90%, upper 99% → lower becomes 81%). It anchors on the upper band because that one is capped at 100%. After clicking, both bands remain fully editable — this doesn't lock them together, it just squares them up once. The button greys out when the bands are already symmetric.",
};

function clamp(n: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, n)); }

function randNormal(mean: number, sd: number) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Annual REAL (inflation-adjusted) total returns, 1928–2025 (98 years). Derived from
// Damodaran's published nominal S&P 500 total returns and 10-yr Treasury returns
// (NYU Stern, histretSP), each converted to real via (1+nominal)/(1+CPI)−1 using the
// annual-average US CPI. The 2019–2025 tail was recomputed from source in 2026 (the prior
// values had a 2021/2022 swap and bad bond figures); refresh annually when Damodaran updates.
const HIST_STOCK = [0.4548,-0.0883,-0.2000,-0.3807,0.0182,0.4885,-0.0267,0.4248,0.3005,-0.3714,0.3298,-0.0110,-0.1130,-0.2065,0.0930,0.2146,0.1635,0.3284,-0.2248,-0.0334,0.0263,0.2080,0.2349,0.1668,0.1722,-0.0195,0.5200,0.3359,0.0704,-0.1295,0.3951,0.1012,-0.0114,0.2479,-0.1031,0.2116,0.1453,0.1108,-0.1167,0.1979,0.0754,-0.1238,-0.0240,0.0828,0.1490,-0.1714,-0.3189,0.2210,0.1572,-0.1125,-0.0024,0.0870,0.1627,-0.1521,0.1054,0.1778,0.0226,0.2625,0.1419,0.0463,0.1162,0.2591,-0.0737,0.2273,0.0430,0.0687,-0.0138,0.3363,0.1964,0.2882,0.2619,0.1897,-0.1114,-0.1348,-0.2443,0.2412,0.0800,0.0072,0.1551,0.0269,-0.3749,0.2232,0.1286,0.0059,0.1502,0.3119,0.1344,-0.0076,0.1052,0.1869,-0.0608,0.2889,0.1662,0.2270,-0.2411,0.2110,0.2136,0.1480];
const HIST_BOND = [0.0201,0.0360,0.1169,0.0745,0.2124,0.0109,0.0634,0.0144,0.0352,-0.0144,0.0719,0.0441,0.0466,-0.1087,-0.0618,-0.0046,0.0014,0.0153,-0.1541,-0.1054,-0.0114,0.0789,-0.0588,-0.0600,-0.0056,0.0221,0.0029,0.0238,-0.0274,-0.0041,0.0466,-0.0373,0.0518,-0.0006,0.0224,0.0107,0.0188,-0.0167,-0.0189,-0.0467,0.0120,0.0579,-0.0021,-0.0632,-0.0114,0.0052,-0.0321,-0.0918,-0.0299,-0.0134,-0.0572,0.0094,-0.0058,-0.0424,0.0180,0.1067,0.0396,0.1020,0.0552,0.0577,0.1309,0.0368,0.0312,0.0340,-0.0541,0.1366,0.0287,0.1193,0.0663,0.1084,0.0519,0.0018,0.0766,0.0312,0.0399,-0.0297,0.0268,-0.0113,0.1048,-0.1347,0.0686,0.0540,0.0029,0.0913,0.0647,-0.0165,0.0262,-0.0017,0.0253,0.0786,-0.0348,0.0770,0.1001,-0.0871,-0.2392,-0.0021,-0.0441,0.0507];

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
        // The whole simulation runs in real (inflation-adjusted) dollars: the historical
        // series is real, withdrawals are held constant in real terms, and non-COLA SS is
        // discounted to real. So the nominal expected return must be converted to real here.
        r = randNormal((retMean - inf) / 100, retVol / 100);
      }

      let ssThisYear = 0;
      if (age >= ssClaimAge && ssAnnual > 0) {
        ssThisYear = ssCola ? ssAnnual : ssAnnual / Math.pow(1 + inf / 100, age - ssClaimAge);
      }

      if (dynamic && bal > 0) {
        // Guardrail tracks the NET portfolio draw rate (spending net of Social Security),
        // matching Guyton-Klinger and the rate-based calculator. Using gross spend here
        // would overstate the draw rate once SS begins and bias success upward.
        const curRate = (Math.max(0, spend - ssThisYear) / bal) * 100;
        if (curRate >= gkUpper + gkExtWidth) spend = spend * (1 - gkExtAdjust / 100);
        else if (curRate >= gkUpper) spend = spend * (1 - gkAdjust / 100);
        else if (curRate <= gkLower - gkExtWidth) spend = spend * (1 + gkExtAdjust / 100);
        else if (curRate <= gkLower) spend = spend * (1 + gkAdjust / 100);
        if (spend < spendFloor) spend = spendFloor;
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

const ZONE_SUBLABEL: Record<string, string> = {
  extCut: "A significant reduction is needed to protect your plan",
  cut: "Trim spending now to stay on track",
  hold: "No change needed — your plan is on course",
  raise: "Your plan has room — consider spending more",
  extRaise: "Excellent shape — a meaningful increase is available",
};

const ZONE_COLOR: Record<string, string> = {
  extCut: "#b91c1c",
  cut: "#d97706",
  hold: "#15803d",
  raise: "#0d9488",
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
  hint?: ReactNode;
  disabled?: boolean;
  highlight?: boolean;
  activeTip: string | null;
  setActiveTip: (id: string | null) => void;
};

function Field({ id, label, value, onChange, suffix, step = 1, min, max, hint, disabled, highlight, activeTip, setActiveTip }: FieldProps) {
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
        {suffix === "$" && <span className="field-prefix">$</span>}
        <input
          type="number"
          inputMode="decimal"
          className={`field-input${highlight ? " highlight" : ""}${suffix === "$" ? " has-prefix" : ""}`}
          value={value}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
        {suffix && suffix !== "$" && <span className="field-suffix">{suffix}</span>}
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

type BridgeResult = {
  years: number;
  claimAge: number;
  minBalance: number;
  survive: number;
  surviveRigid: number;
  surviveFlex: number;
  median: number;
  p10: number;
  claimSensitivity: { claimAge: number; survive: number }[];
};

type CalcResult = {
  success: number;
  zone: string;
  recommended: number;
  floorBound: boolean;
  successAfter: number;
  bridge: BridgeResult | null;
  staticSuccess: number;
  dynamicSuccess: number;
  dynamicMedianSpend: number;
  bridgeOverrode: boolean;
  bridgeFloorRestored: boolean;
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
  const [floorWarnPct, setFloorWarnPct] = useState<NumOrStr>(50);
  const [bridgeGuardrail, setBridgeGuardrail] = useState(true);
  const [bridgeFloor, setBridgeFloor] = useState<NumOrStr>(DEFAULTS.targetSuccess - BRIDGE_CONFIDENCE_OFFSET);
  const [bridgeFloorManual, setBridgeFloorManual] = useState(false);
  const [bridgeMinBalance, setBridgeMinBalance] = useState<NumOrStr>(DEFAULTS.bridgeMinBalance);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [currentPositionOpen, setCurrentPositionOpen] = useState(true);
  const [socialSecurityOpen, setSocialSecurityOpen] = useState(true);
  const [guardrailBandsOpen, setGuardrailBandsOpen] = useState(false);
  const [spendingStrategyOpen, setSpendingStrategyOpen] = useState(false);
  const [marketEngineOpen, setMarketEngineOpen] = useState(false);

  const liveDataRef = useRef<Record<string, unknown>>({});
  const runCalcRef = useRef<() => void>(() => {});

  const [infoOpen, setInfoOpen] = useState(false);
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

  const withdrawalRate = num(portfolio) > 0 ? (num(withdrawal) / num(portfolio)) * 100 : 0;

  // The rate that actually matters for portfolio survival is the draw NET of any Social Security
  // already flowing — that's what the simulation's guardrail tracks (see initRate in runCalc).
  // SS is only netted once you're claiming; during the pre-SS bridge the portfolio funds 100%,
  // so the net rate equals the gross rate.
  const annualSs = ssEnabled ? num(ssMonthly) * 12 : 0;
  const ssFlowingNow = annualSs > 0 && num(currentAge) >= num(ssClaimAge)
    ? (ssCola ? annualSs : annualSs / Math.pow(1 + num(inf) / 100, num(currentAge) - num(ssClaimAge)))
    : 0;
  const netPortfolioDraw = Math.max(0, num(withdrawal) - ssFlowingNow);
  const netWithdrawalRate = num(portfolio) > 0 ? (netPortfolioDraw / num(portfolio)) * 100 : 0;
  const ssReducesDraw = ssFlowingNow > 0 && netWithdrawalRate < withdrawalRate - 0.005;

  const validationErrors: string[] = [];
  if (num(currentAge) >= num(endAge)) validationErrors.push("Plan end age must exceed current age.");
  if (num(lowerBand) >= num(targetSuccess)) validationErrors.push("Lower guardrail must be below the target success rate.");
  if (num(upperBand) <= num(targetSuccess)) validationErrors.push("Upper guardrail must be above the target success rate.");
  if (dynamicMode && num(spendFloor) > 0 && num(spendFloor) > num(withdrawal))
    validationErrors.push("Spending floor exceeds current withdrawal — cuts would never trigger.");

  // Heuristic reserve suggestion for the bridge: present value of the post-SS spending
  // shortfall the portfolio still has to cover after Social Security begins.
  const suggestedBridgeReserve = (() => {
    const postYrs = Math.max(0, num(endAge) - num(ssClaimAge));
    if (postYrs <= 0) return 0;
    const gap = Math.max(0, num(withdrawal) - (ssEnabled ? num(ssMonthly) * 12 : 0));
    const realR = (num(ret) - num(inf)) / 100;
    return realR > 0.0001 ? gap * (1 - Math.pow(1 + realR, -postYrs)) / realR : gap * postYrs;
  })();
  const suggestedReserveRounded = Math.round(suggestedBridgeReserve / 1000) * 1000;

  useEffect(() => {
    if (suggestedReserveRounded > 0) setBridgeMinBalance(suggestedReserveRounded);
  }, [suggestedReserveRounded]);

  useEffect(() => { setStale(true); }, [
    portfolio, withdrawal, currentAge, endAge, ret, vol, inf,
    targetSuccess, lowerBand, upperBand, adjust, extWidth, extAdjust, trials,
    ssEnabled, ssClaimAge, ssMonthly, ssCola,
    engine, haircut, stockPct, blockLen, dynamicMode, spendFloor, bridgeGuardrail, bridgeFloor, bridgeMinBalance,
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

      // Social Security flowing in the first simulated year (0 while still in the pre-SS bridge).
      // The guardrail band is anchored to the NET initial draw rate so it is consistent with the
      // net rate the in-path guardrail measures — otherwise an already-claiming retiree's band
      // would be set off gross spending and the two would disagree.
      const ssAtStart = ssParams.ssAnnual > 0 && ssParams.currentAge >= ssParams.ssClaimAge
        ? (ssParams.ssCola
            ? ssParams.ssAnnual
            : ssParams.ssAnnual / Math.pow(1 + infl / 100, ssParams.currentAge - ssParams.ssClaimAge))
        : 0;
      const initRate = p > 0 ? (Math.max(0, w - ssAtStart) / p) * 100 : 0;
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

      // Full-plan (Guyton-Klinger) recommendation, before any bridge constraint. A pure function
      // of zone/adjustments — the bridge block below reads it to know how far up a proposed raise
      // would go, so the bridge floor can cap the raise as well as deepen a cut.
      const planExtended = zone === "extCut" || zone === "extRaise";
      const planPct = planExtended ? eadj : adj;
      let recommended = w;
      if (zone === "cut" || zone === "extCut") recommended = w * (1 - planPct / 100);
      else if (zone === "raise" || zone === "extRaise") recommended = w * (1 + planPct / 100);
      else recommended = w * (1 + infl / 100);

      let bridge: BridgeResult | null = null;
      // The largest draw whose bridge survival still meets the floor. Used two-sidedly: to
      // right-size a cut when the bridge is already breached, AND to cap a raise/inflation bump
      // that would push the bridge below its floor. null when the floor is met across the range.
      let bridgeMaxDraw: number | null = null;
      // False when even the deepest allowed cut (down to the spending floor) can't lift bridge
      // survival back to the floor — spending alone isn't enough; claiming SS earlier is the remedy.
      let bridgeFloorRestored = true;
      if (ssEnabled && num(ssClaimAge) > num(currentAge)) {
        const bridgeYears = num(ssClaimAge) - num(currentAge);
        const minBal = num(bridgeMinBalance, 0);
        const ser = engineParams.series;
        const useHist = engineParams.engine === "historical" && ser && ser.length > 0;
        const nH = useHist ? ser!.length : 0;
        const hc = engineParams.haircut / 100;
        const bl = engineParams.blockLen;

        // True while the reserve target is still auto-tracking the suggestion (the user hasn't
        // typed a custom override). When tracking, the target should move with whatever draw is
        // being tested rather than stay pinned to today's withdrawal — otherwise a raise is judged
        // against a reserve requirement it will have already outgrown the moment it's taken, and a
        // cut isn't credited for needing a smaller reserve too. Mirrors suggestedBridgeReserve above.
        const isTrackingReserve = Math.abs(minBal - suggestedReserveRounded) < 500;
        const reserveForDraw = (draw: number) => {
          const postYrs = Math.max(0, num(endAge) - num(ssClaimAge));
          if (postYrs <= 0) return 0;
          const gap = Math.max(0, draw - (ssEnabled ? num(ssMonthly) * 12 : 0));
          const realR = (r - infl) / 100;
          return realR > 0.0001 ? gap * (1 - Math.pow(1 + realR, -postYrs)) / realR : gap * postYrs;
        };
        const minBalForDraw = (draw: number) => (isTrackingReserve ? reserveForDraw(draw) : minBal);

        const runBridge = (draw: number, byears: number, flex: boolean) => {
          let bal = p, bp = 0, bs = 0, spend = draw;
          // Guardrail band re-anchored to the draw being tested, not the outer gkParams (fixed to
          // today's withdrawal) — otherwise a lower candidate draw looks like underspending against
          // bands sized for a higher one, the flex sim ratchets it back up, and a cut appears far
          // less effective than it actually is.
          const bandInit = p > 0 ? (draw / p) * 100 : 0;
          const bandUpper = bandInit * 1.2, bandLower = bandInit * 0.8, bandExt = bandInit * 0.1;
          for (let y = 0; y < byears; y++) {
            let rr: number;
            if (useHist) {
              if (bp === 0) { bs = Math.floor(Math.random() * nH); bp = bl; }
              const idx = (bs + (bl - bp)) % nH;
              rr = ser![idx] - hc; bp--;
            } else {
              rr = randNormal((r - infl) / 100, v / 100);
            }
            if (flex && bal > 0) {
              const cr = (spend / bal) * 100;
              if (cr >= bandUpper + bandExt) spend = spend * (1 - eadj / 100);
              else if (cr >= bandUpper) spend = spend * (1 - adj / 100);
              else if (cr <= bandLower - bandExt) spend = spend * (1 + eadj / 100);
              else if (cr <= bandLower) spend = spend * (1 + adj / 100);
              if (spend < gkParams.spendFloor) spend = gkParams.spendFloor;
            }
            bal = bal * (1 + rr) - spend;
            if (bal <= 0) { bal = 0; break; }
          }
          return bal;
        };

        // Governing bridge-survival % for an arbitrary annual draw (flex when dynamic, rigid
        // otherwise) — matches surviveGov below, so the bisection is consistent with the number
        // shown to the user. Uses the goalpost-aware reserve target for the draw under test.
        const bridgeSurvivePct = (draw: number, trialsN: number) => {
          const mb = minBalForDraw(draw);
          let surv = 0;
          for (let t = 0; t < trialsN; t++) {
            const end = runBridge(draw, bridgeYears, dynamicMode);
            if (end > 0 && end >= mb) surv++;
          }
          return (surv / trialsN) * 100;
        };

        // Largest draw whose bridge survival still meets the floor. Survival is monotonically
        // decreasing in the draw, so bisect between the spending floor and `hi`. `hi` defaults to
        // the current draw (right-sizing a cut) but is raised to the plan's proposed draw when we
        // need to cap a raise. Mirrors withdrawalForTargetSuccess.
        const withdrawalForBridgeFloor = (floorPct: number, hi: number = w) => {
          let lo = Math.max(0, num(spendFloor, 0)); // never recommend below the floor
          const searchTrials = Math.min(tr, 500);
          for (let i = 0; i < 18; i++) {
            const mid = (lo + hi) / 2;
            // small buffer above the floor to absorb Monte Carlo noise
            if (bridgeSurvivePct(mid, searchTrials) >= floorPct + 1) lo = mid;
            else hi = mid;
          }
          return lo;
        };

        let surviveRigid = 0, surviveFlex = 0;
        const endBalances: number[] = [];
        for (let t = 0; t < tr; t++) {
          const endR = runBridge(w, bridgeYears, false);
          if (endR > 0 && endR >= minBal) surviveRigid++;
          endBalances.push(endR);
          const endF = runBridge(w, bridgeYears, dynamicMode);
          if (endF > 0 && endF >= minBal) surviveFlex++;
        }
        endBalances.sort((a, b) => a - b);
        const median = endBalances[Math.floor(endBalances.length / 2)];
        const p10 = endBalances[Math.floor(endBalances.length * 0.10)];

        const claimSensitivity: { claimAge: number; survive: number }[] = [];
        if (bridgeYears >= 10) {
          const sTrials = Math.min(tr, 1000);
          for (const ca of [62, 65, 67, 70]) {
            if (ca <= num(currentAge)) continue;
            let surv = 0;
            for (let t = 0; t < sTrials; t++) {
              const end = runBridge(w, ca - num(currentAge), dynamicMode);
              if (end > 0 && end >= minBal) surv++;
            }
            claimSensitivity.push({ claimAge: ca, survive: (surv / sTrials) * 100 });
          }
        }

        const surviveGov = dynamicMode ? surviveFlex : surviveRigid;
        bridge = {
          years: bridgeYears, claimAge: num(ssClaimAge), minBalance: minBal,
          survive: (surviveGov / tr) * 100,
          surviveRigid: (surviveRigid / tr) * 100,
          surviveFlex: (surviveFlex / tr) * 100,
          median, p10, claimSensitivity,
        };

        if (bridgeGuardrail) {
          const floorPct = num(bridgeFloor, 75);
          if (bridge.survive < floorPct) {
            // (a) Bridge already breached at the current draw → right-size a cut. Gated on the
            // low-noise governing figure (tr trials) so the decision doesn't hinge on a marginal
            // point estimate. Searches [spendFloor, w] — never raising to fix a breach.
            bridgeMaxDraw = withdrawalForBridgeFloor(floorPct);
            bridgeFloorRestored = bridgeSurvivePct(bridgeMaxDraw, Math.min(tr, 500)) >= floorPct;
          } else if (recommended > w && bridgeSurvivePct(recommended, tr) < floorPct) {
            // (b) Bridge is fine at the current draw, but the full-plan raise/inflation bump would
            // push it below the floor. Cap the increase at the largest draw that still meets the
            // floor. Gate on tr trials to match the breach check's robustness.
            bridgeMaxDraw = withdrawalForBridgeFloor(floorPct, recommended);
            bridgeFloorRestored = bridgeSurvivePct(bridgeMaxDraw, Math.min(tr, 500)) >= floorPct;
          }
        }
      }

      // Bridge as a two-sided floor on spending: never let the recommendation sit at a draw whose
      // bridge survival is below the floor. This deepens a cut when the bridge is already breached
      // and trims a raise/inflation bump that would breach it. The bridge target is right-sized to
      // exactly restore reserve odds to the floor rather than borrowing the full-strength cut.
      let finalZone = zone;
      let bridgeOverrode = false;
      if (bridge && bridgeMaxDraw != null && bridgeMaxDraw < recommended) {
        recommended = bridgeMaxDraw;
        bridgeOverrode = true;
        // Color/label only: an actual reduction below the current draw is a cut; a merely *capped*
        // raise (still at or above the current draw) is "on track — hold", not a cut.
        finalZone = recommended < w
          ? (bridge.survive < num(bridgeFloor, 75) - ew ? "extCut" : "cut")
          : "hold";
      }

      let floorBound = false;
      if (dynamicMode) {
        const fl = num(spendFloor, 0);
        if (fl > 0 && recommended < fl) {
          recommended = fl;
          floorBound = true;
        }
      }

      const successAfter = simulateSuccess({ portfolio: p, withdrawal: recommended, years, retMean: r, retVol: v, trials: tr, ...simBase, dynamic: dynamicMode, ...gkParams }).success;

      const points: SensPoint[] = [];
      const steps = 10;
      const minW = w * 0.5, maxW = w * 1.6;
      const chartTrials = Math.min(tr, 1000);
      for (let i = 0; i <= steps; i++) {
        const wi = minW + (maxW - minW) * (i / steps);
        const wiInit = p > 0 ? (Math.max(0, wi - ssAtStart) / p) * 100 : 0;
        const gkP = dynamicMode
          ? { dynamic: true, gkUpper: wiInit * 1.2, gkLower: wiInit * 0.8, gkAdjust: adj, gkExtWidth: wiInit * 0.1, gkExtAdjust: eadj, spendFloor: num(spendFloor, 0) }
          : { dynamic: false };
        const s = simulateSuccess({ portfolio: p, withdrawal: wi, years, retMean: r, retVol: v, trials: chartTrials, ...simBase, ...gkP }).success;
        points.push({ withdrawal: wi, success: s });
      }
      points.push({ withdrawal: w, success, current: success });
      points.sort((a, b) => a.withdrawal - b.withdrawal);

      const sustainable = withdrawalForTargetSuccess({ portfolio: p, years, retMean: r, retVol: v, trials: tr, targetSuccess: tgt, ssParams: simBase });

      setResult({
        success, zone: finalZone, recommended, floorBound, successAfter, bridge, bridgeOverrode, bridgeFloorRestored,
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
        setB("ssEnabled", setSsEnabled);
        set("ssClaimAge", setSsClaimAge); set("ssMonthly", setSsMonthly);
        setB("ssCola", setSsCola); setS("engine", setEngine);
        set("haircut", setHaircut); set("stockPct", setStockPct);
        set("blockLen", setBlockLen);
        setB("dynamicMode", setDynamicMode);
        set("spendFloor", setSpendFloor);
        set("floorWarnPct", setFloorWarnPct);
        setB("bridgeGuardrail", setBridgeGuardrail);
        set("bridgeFloor", setBridgeFloor);
        setB("bridgeFloorManual", setBridgeFloorManual);
        set("bridgeMinBalance", setBridgeMinBalance);
        if (d.savedAt) setSavedAt(d.savedAt);
      }
    } catch { /* no saved state */ }
    setTimeout(() => runCalcRef.current(), 80);
  }, []);

  const handleSave = () => {
    setSaveStatus("saving");
    setSaveError(null);
    const ts = new Date().toLocaleString();
    const data = JSON.stringify({
      portfolio, withdrawal, currentAge, endAge, ret, vol, inf,
      targetSuccess, lowerBand, upperBand, adjust, extWidth, extAdjust, trials,
      ssEnabled, ssClaimAge, ssMonthly, ssCola,
      engine, haircut, stockPct, blockLen, dynamicMode, spendFloor, floorWarnPct, bridgeGuardrail, bridgeFloor, bridgeFloorManual, bridgeMinBalance,
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
    setTrials(DEFAULTS.trials);
    setSsEnabled(true); setSsClaimAge(70); setSsMonthly(4500); setSsCola(true);
    setEngine("historical"); setHaircut(2.0); setStockPct(60); setBlockLen(7);
    setDynamicMode(true); setSpendFloor(60000); setFloorWarnPct(50); setBridgeGuardrail(true);
    setBridgeFloor(DEFAULTS.targetSuccess - BRIDGE_CONFIDENCE_OFFSET); setBridgeFloorManual(false);
    setBridgeMinBalance(DEFAULTS.bridgeMinBalance);
    setTimeout(() => runCalcRef.current(), 80);
    setTimeout(() => setSaveStatus(null), 1200);
  };

  const onLowerChange = (val: NumOrStr) => setLowerBand(val);
  const onUpperChange = (val: NumOrStr) => setUpperBand(val);
  const onTargetChange = (val: NumOrStr) => {
    setTargetSuccess(val);
    if (!bridgeFloorManual && val !== "") setBridgeFloor(clamp(num(val) - BRIDGE_CONFIDENCE_OFFSET, 50, 99));
  };
  const onBridgeFloorManualToggle = () => {
    const next = !bridgeFloorManual;
    setBridgeFloorManual(next);
    if (!next) setBridgeFloor(clamp(num(targetSuccess) - BRIDGE_CONFIDENCE_OFFSET, 50, 99));
  };
  // One-shot: mirror the lower guardrail to match the upper's distance from the target.
  // Anchors on the upper band because it's bounded by the 100% ceiling (a symmetric upper
  // would often clamp), whereas the lower band has room to move.
  const makeSymmetric = () => {
    const dist = num(upperBand) - num(targetSuccess);
    setLowerBand(clamp(num(targetSuccess) - dist, 0, num(targetSuccess) - 1));
  };
  const bandsAreSymmetric =
    num(upperBand) - num(targetSuccess) === num(targetSuccess) - num(lowerBand);

  liveDataRef.current = {
    portfolio, withdrawal, currentAge, endAge, ret, vol, inf,
    targetSuccess, lowerBand, upperBand, adjust, extWidth, extAdjust, trials,
    ssEnabled, ssClaimAge, ssMonthly, ssCola,
    engine, haircut, stockPct, blockLen, dynamicMode, spendFloor, floorWarnPct, bridgeGuardrail, bridgeFloor, bridgeFloorManual, bridgeMinBalance,
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onRegisterDataGetter?.(() => liveDataRef.current); }, []);

  const zoneColor = result ? ZONE_COLOR[result.zone] : "#5dc9a8";
  const zoneLabel = result ? ZONE_LABEL[result.zone] : "—";
  const zoneSubLabel = result ? ZONE_SUBLABEL[result.zone] : "Run the calculator to see your status";
  const tipProps = { activeTip, setActiveTip };

  const ageValidErr = num(currentAge) >= num(endAge);
  const lowerValidErr = num(lowerBand) >= num(targetSuccess);
  const upperValidErr = num(upperBand) <= num(targetSuccess);
  const floorValidErr = dynamicMode && num(spendFloor) > 0 && num(spendFloor) > num(withdrawal);
  // Surface when the fixed-dollar floor has slipped below the user's chosen share of current spending —
  // a sign it may have been left to erode against inflation while the withdrawal grew, and should be revisited.
  const floorLowWarn = dynamicMode && !floorValidErr && num(spendFloor) > 0 && num(withdrawal) > 0
    && num(spendFloor) < (num(floorWarnPct, 50) / 100) * num(withdrawal);

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
          --accent: #0ea5e9;
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
          margin: 0;
        }
        .pg-title-row {
          display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
        }
        .pg-info-btn {
          width: 24px; height: 24px; min-width: 24px;
          border-radius: 50%; background: var(--panel-2);
          border: 1px solid var(--border); color: var(--text-dim);
          font-size: 12px; font-weight: 700; line-height: 1; cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0; margin-top: 4px;
        }
        .pg-info-btn:active { border-color: var(--accent); color: var(--accent); }
        .pg-info-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 1000;
          display: flex; align-items: center; justify-content: center; padding: 16px;
        }
        .pg-info-modal {
          background: var(--panel); border-radius: 12px;
          width: 100%; max-width: 520px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.25);
          max-height: 90vh; overflow-y: auto;
        }
        .pg-info-modal-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 16px 20px 12px; border-bottom: 1px solid var(--border);
        }
        .pg-info-modal-header strong { font-size: 15px; }
        .pg-info-modal-close {
          background: none; border: none; font-size: 22px; color: var(--text-faint);
          cursor: pointer; line-height: 1; padding: 0 4px;
        }
        .pg-info-body { padding: 16px 20px 20px; }
        .pg-info-body p { font-size: 13.5px; color: var(--text-dim); line-height: 1.55; margin: 0 0 14px; }
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
        .pg-current-position { margin-bottom: 14px; }
        @media (max-width: 820px) {
          .pg-grid { display: flex; flex-direction: column; gap: 0; }
          .pg-left-col { display: contents; }
          .pg-current-position { order: 1; margin-bottom: 14px; }
          .pg-result { order: 2; margin-bottom: 18px; }
          .pg-left-rest { order: 3; }
          .pg-result-sticky { position: static !important; }
        }
        .pg-panel-header {
          width: 100%; display: flex; align-items: center; justify-content: space-between;
          background: none; border: none; padding: 0; cursor: pointer; text-align: left;
          font-family: inherit; gap: 8px;
        }
        .pg-panel-chevron {
          font-size: 11px; color: var(--text-faint); transition: transform 0.2s;
          display: inline-block; flex-shrink: 0;
        }
        .pg-panel-chevron.open { transform: rotate(180deg); }
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
          .field-row-2col { grid-template-columns: 1fr 1fr !important; gap: 12px !important; }
        }
        .field { margin-bottom: 14px; }
        .field-label-row {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 6px; gap: 8px;
        }
        .field-label { font-size: 12.5px; color: var(--text-dim); font-weight: 500; }
        .tip-trigger {
          width: 21px; height: 21px; min-width: 21px;
          border-radius: 50%; background: transparent;
          border: 1px solid var(--text-faint); color: var(--text-faint);
          font-size: 8px; line-height: 1; cursor: pointer; padding: 0;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .tip-trigger:hover { border-color: var(--accent); color: var(--accent); }
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
        .field-input:disabled { opacity: 0.5; cursor: not-allowed; background: var(--panel); }
        .field-input.highlight { border-color: #d97706; box-shadow: 0 0 0 2px rgba(217,119,6,0.25); }
        .field-input.err { border-color: #b91c1c; box-shadow: 0 0 0 2px rgba(185,28,28,0.18); }
        .field-suffix {
          position: absolute; right: 12px; color: var(--text-faint);
          font-size: 13px; pointer-events: none;
        }
        .field-prefix {
          position: absolute; left: 12px; color: var(--text-faint);
          font-size: 13px; pointer-events: none;
        }
        .field-input.has-prefix { padding-left: 24px; }
        .field-hint { font-size: 11.5px; color: var(--text-faint); margin: 5px 0 0; }
        .field-hint.err { color: #b91c1c; }
        .hint-link {
          background: none; border: none; padding: 0; font: inherit;
          color: var(--accent); cursor: pointer; text-decoration: underline;
        }
        .hint-link:active { color: var(--text); }
        .pg-result-sticky { position: sticky; top: 14px; }

        /* Stale / validation banners */
        .stale-banner {
          background: #fffbeb;
          border: 1px solid #fbbf24;
          color: #92400e;
          font-size: 12px;
          font-weight: 500;
          padding: 8px 12px;
          border-radius: 7px;
          margin-bottom: 10px;
          text-align: center;
        }
        .validation-banner {
          background: #fee2e2;
          border: 1px solid #fca5a5;
          color: #b91c1c;
          border-radius: 7px;
          padding: 10px 12px;
          font-size: 12.5px;
          line-height: 1.6;
          margin-bottom: 10px;
        }
        .validation-banner > div + div { margin-top: 3px; }

        /* Results panel */
        .result-zone { border-radius: 10px; padding: 16px; margin-bottom: 12px; border: 1px solid var(--border); }
        .result-zone-label {
          font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em;
          font-weight: 600; margin-bottom: 4px; display: flex; align-items: center;
        }
        .result-zone-sublabel {
          font-size: 12px; line-height: 1.4; margin-bottom: 12px;
        }
        .result-amount {
          font-family: 'Crimson Text', Georgia, serif;
          font-size: 36px; font-weight: 600; line-height: 1.1; margin: 4px 0 2px;
        }
        .result-amount.stale { opacity: 0.4; }
        .result-amount-monthly {
          font-size: 13px; font-weight: 500; color: var(--text-dim);
          margin-bottom: 4px;
        }
        .result-sub { font-size: 12px; color: var(--text-faint); margin: 0; }
        .floor-warning {
          margin: 12px 0 0; text-align: left;
          background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px;
          color: #92400e; font-size: 12px; line-height: 1.45; padding: 9px 11px;
        }

        /* Success probability before/after pair */
        .success-pair-row {
          padding: 12px 0;
          border-bottom: 1px solid var(--border);
        }
        .success-pair-section-label {
          font-size: 11.5px; color: var(--text-dim); font-weight: 500; margin-bottom: 8px;
        }
        .success-pair {
          display: flex; align-items: center; gap: 14px;
        }
        .success-pair-item { text-align: center; }
        .success-pair-value {
          font-family: 'Crimson Text', Georgia, serif;
          font-size: 26px; font-weight: 600; line-height: 1;
        }
        .success-pair-item-label {
          font-size: 10.5px; color: var(--text-faint); margin-top: 2px;
        }
        .success-pair-arrow { font-size: 18px; color: var(--text-faint); flex-shrink: 0; }

        /* Stats */
        .result-stat-row {
          display: flex; justify-content: space-between; gap: 10px;
          padding: 9px 0; border-bottom: 1px solid var(--border); font-size: 12.5px;
        }
        .result-stat-row:last-child { border-bottom: none; }
        .result-stat-label { color: var(--text-dim); }
        .result-stat-value { font-weight: 600; text-align: right; }
        .ref-line .result-stat-label, .ref-line .result-stat-value { color: var(--text-faint); font-weight: 400; font-size: 12px; }
        .ref-delta { color: #15803d; }

        /* Details collapsible */
        .details-toggle {
          width: 100%; background: none;
          border: none; border-top: 1px solid var(--border);
          padding: 9px 0 5px;
          font-size: 11.5px; color: var(--text-faint);
          cursor: pointer; text-align: left;
          font-family: inherit; margin-top: 4px;
        }
        .details-toggle:hover { color: var(--text-dim); }
        .details-section { padding-top: 4px; }

        /* Action buttons */
        .calc-btn {
          width: 100%; padding: 13px; border-radius: 8px; border: none;
          background: var(--accent); color: #fff; font-size: 14.5px;
          font-weight: 600; cursor: pointer; font-family: inherit; min-height: 48px;
          margin-bottom: 10px;
        }
        .calc-btn:disabled { opacity: 0.6; cursor: default; }
        .calc-btn.stale { box-shadow: 0 0 0 3px rgba(14,165,233,0.3); }
        .btn-row { display: flex; gap: 10px; margin-bottom: 14px; }
        .btn {
          flex: 1; padding: 11px 14px; border-radius: 7px;
          border: 1px solid var(--border); background: var(--panel-2);
          color: var(--text); font-size: 13px; font-weight: 500;
          cursor: pointer; min-height: 44px; font-family: inherit;
        }
        .btn:active { border-color: var(--accent); }
        .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
        .save-msg { font-size: 12px; color: var(--text-faint); margin-bottom: 10px; text-align: center; }
        .save-msg.error { color: #e85d5d; }

        /* Bridge */
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

        /* Chart */
        .chart-wrap { margin-top: 6px; height: 240px; }
        .chart-caption { font-size: 11.5px; color: var(--text-faint); margin: 6px 0 0; line-height: 1.5; }
        .legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }

        /* Toggle */
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
        .sym-btn {
          padding: 7px 12px; border-radius: 7px; border: 1px solid var(--border);
          background: var(--panel-2); color: var(--accent); font-size: 12px;
          font-weight: 600; cursor: pointer; font-family: inherit; min-height: 34px;
          white-space: nowrap; transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .sym-btn:hover:not(:disabled) { background: var(--accent); color: #fff; border-color: var(--accent); }
        .sym-btn:disabled { color: var(--text-faint); cursor: default; }

        /* Engine toggle */
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
        <div className="pg-title-row">
          <h1 className="pg-title">Probability-of-Success Guardrails</h1>
          <button className="pg-info-btn" onClick={() => setInfoOpen(true)} aria-label="About this calculator">?</button>
        </div>

        {resetConfirmOpen && (
          <div className="pg-info-overlay" onClick={() => setResetConfirmOpen(false)}>
            <div className="pg-info-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
              <div className="pg-info-modal-header">
                <strong>Reset to defaults?</strong>
                <button className="pg-info-modal-close" onClick={() => setResetConfirmOpen(false)} aria-label="Cancel">×</button>
              </div>
              <div className="pg-info-body">
                <p style={{ marginBottom: 16 }}>All inputs will be restored to their default values. Any unsaved changes will be lost.</p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    className="btn"
                    style={{ flex: 1 }}
                    onClick={() => setResetConfirmOpen(false)}
                  >Cancel</button>
                  <button
                    className="btn"
                    style={{ flex: 1, background: "#b91c1c", borderColor: "#b91c1c", color: "#fff" }}
                    onClick={() => { setResetConfirmOpen(false); handleReset(); }}
                  >Reset</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {infoOpen && (
          <div className="pg-info-overlay" onClick={() => setInfoOpen(false)}>
            <div className="pg-info-modal" onClick={e => e.stopPropagation()}>
              <div className="pg-info-modal-header">
                <strong>About this calculator</strong>
                <button className="pg-info-modal-close" onClick={() => setInfoOpen(false)} aria-label="Close">×</button>
              </div>
              <div className="pg-info-body">
                <p>
                  Runs a Monte Carlo simulation from your current portfolio and remaining horizon, then adjusts spending
                  based on how your probability of plan success has moved — rather than off your withdrawal rate.
                </p>
                <div className="pg-note" style={{ marginBottom: 0 }}>
                  <strong>How this differs from rate-based guardrails:</strong> withdrawal rate can't tell two retirees
                  with the same rate but different ages apart. Probability of success accounts for time remaining
                  directly — research (Kitces/Income Lab, 2021–2024) argues this is a more robust trigger. Tradeoff:
                  results depend on your return and volatility assumptions, and this normal-distribution Monte Carlo
                  tends to read more optimistic than historical backtesting because it understates sequence-of-returns
                  risk.
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="pg-grid">
          <div className="pg-left-col">
          {/* ── CURRENT POSITION (extracted to control mobile ordering) ── */}
          <div className="pg-current-position">
            <div className="pg-panel">
              <button className="pg-panel-header" onClick={() => setCurrentPositionOpen(o => !o)}>
                <h2 className="pg-panel-title" style={{ margin: 0 }}>Current position</h2>
                <span className={`pg-panel-chevron ${currentPositionOpen ? "open" : ""}`}>▼</span>
              </button>
              {currentPositionOpen && (
                <div style={{ marginTop: 14 }}>
                  <div className="field-row">
                    <Field id="portfolio" label="Portfolio balance" value={portfolio} onChange={setPortfolio} suffix="$" step={10000} {...tipProps} />
                    <Field
                      id="withdrawal"
                      label="Current withdrawal"
                      value={withdrawal}
                      onChange={setWithdrawal}
                      suffix="$"
                      step={1000}
                      hint={num(portfolio) > 0
                        ? (ssReducesDraw
                            ? `${netWithdrawalRate.toFixed(2)}% of portfolio (net of SS)`
                            : `${withdrawalRate.toFixed(2)}% of portfolio`)
                        : undefined}
                      {...tipProps}
                    />
                  </div>
                  <div className="field-row field-row-2col">
                    <Field id="currentAge" label="Current age" value={currentAge} onChange={setCurrentAge} step={1} {...tipProps} />
                    <Field
                      id="endAge"
                      label="Plan through age"
                      value={endAge}
                      onChange={setEndAge}
                      step={1}
                      highlight={ageValidErr}
                      hint={ageValidErr
                        ? <span className="err">End age must exceed current age</span>
                        : `${years} years remaining`}
                      {...tipProps}
                    />
                  </div>
                  <div className="field-row">
                    <Field
                      id="spendFloor"
                      label="Spending floor"
                      value={spendFloor}
                      onChange={setSpendFloor}
                      suffix="$"
                      step={1000}
                      disabled={!dynamicMode}
                      highlight={floorValidErr || floorLowWarn}
                      hint={!dynamicMode
                        ? "Only applies in Dynamic guardrails mode (see Spending strategy)"
                        : floorValidErr
                          ? <span className="err">Floor exceeds current withdrawal — cuts would never trigger</span>
                          : floorLowWarn
                            ? <span style={{ color: "#d97706", fontWeight: 600 }}>Floor has dropped below {num(floorWarnPct, 50)}% of your current withdrawal — review and raise it so inflation hasn't eroded your essential-expenses backstop.</span>
                            : (num(withdrawal) > 0
                                ? `${((num(spendFloor) / num(withdrawal)) * 100).toFixed(0)}% of current withdrawal — your essential-expenses backstop`
                                : undefined)}
                      {...tipProps}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── REST OF LEFT COLUMN ── */}
          <div className="pg-left-rest">

            {/* Social Security — moved above guardrail bands */}
            <div className="pg-panel">
              <button className="pg-panel-header" onClick={() => setSocialSecurityOpen(o => !o)}>
                <h2 className="pg-panel-title" style={{ margin: 0 }}>Social Security</h2>
                <span className={`pg-panel-chevron ${socialSecurityOpen ? "open" : ""}`}>▼</span>
              </button>
              {socialSecurityOpen && (
                <div style={{ marginTop: 14 }}>
                  <div className="toggle-row" style={{ paddingTop: 0 }}>
                    <span className="toggle-label">Enable Social Security</span>
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
                      {num(ssClaimAge) > num(currentAge) && (
                        <>
                          <div className="toggle-row" style={{ marginTop: 6 }}>
                            <span className="toggle-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              Factor bridge survival into spending decisions
                              <button type="button" className="tip-trigger" onClick={() => setActiveTip(activeTip === "bridgeGuardrail" ? null : "bridgeGuardrail")} aria-label="About bridge guardrail">?</button>
                            </span>
                            <button className={`toggle-switch ${bridgeGuardrail ? "on" : ""}`} onClick={() => setBridgeGuardrail(!bridgeGuardrail)} aria-label="Toggle bridge guardrail">
                              <span className="toggle-knob" />
                            </button>
                          </div>
                          {activeTip === "bridgeGuardrail" && <p className="tip-text">{TIPS.bridgeGuardrail}</p>}
                          {bridgeGuardrail && (
                            <>
                              <Field id="bridgeMinBalance" label="Min. balance at claim age" value={bridgeMinBalance} onChange={setBridgeMinBalance} suffix="$" step={10000} min={0}
                                highlight={suggestedBridgeReserve > 0 && num(bridgeMinBalance) !== suggestedReserveRounded}
                                hint={suggestedBridgeReserve > 0
                                  ? (<>
                                      {"Suggested ≈ "}
                                      <button type="button" className="hint-link" onClick={() => setBridgeMinBalance(suggestedReserveRounded)}>
                                        {fmtShort(suggestedBridgeReserve)}
                                      </button>
                                      {` — covers your ${fmtShort(Math.max(0, num(withdrawal) - (ssEnabled ? num(ssMonthly) * 12 : 0)))}/yr post-SS gap to age ${num(endAge)}. Set to 0 to score on not running out.`}
                                    </>)
                                  : "Reach claim age with at least this much. Set to 0 to score on not running out."}
                                {...tipProps} />
                              <div className="toggle-row">
                                <span className="toggle-label">Set required confidence manually</span>
                                <button
                                  className={`toggle-switch ${bridgeFloorManual ? "on" : ""}`}
                                  onClick={onBridgeFloorManualToggle}
                                  aria-label="Toggle manual confidence override"
                                >
                                  <span className="toggle-knob" />
                                </button>
                              </div>
                              <Field id="bridgeFloor" label="Required confidence" value={bridgeFloor} onChange={setBridgeFloor} suffix="%" step={1} min={50} max={99} disabled={!bridgeFloorManual}
                                hint={bridgeFloorManual
                                  ? `Cut if the chance of reaching age ${num(ssClaimAge)} with ≥ ${fmtShort(num(bridgeMinBalance, 0))} falls below ${num(bridgeFloor, 75)}% — your reserve must clear in all but the worst ${100 - num(bridgeFloor, 75)}% of outcomes.`
                                  : `Auto-tracking your ${num(targetSuccess)}% target − ${BRIDGE_CONFIDENCE_OFFSET} = ${num(bridgeFloor, 75)}%. Turn on manual override to set a custom value.`}
                                {...tipProps} />
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Guardrail bands */}
            <div className="pg-panel">
              <button className="pg-panel-header" onClick={() => setGuardrailBandsOpen(o => !o)}>
                <h2 className="pg-panel-title" style={{ margin: 0 }}>Guardrail bands</h2>
                <span className={`pg-panel-chevron ${guardrailBandsOpen ? "open" : ""}`}>▼</span>
              </button>
              {guardrailBandsOpen && (
                <div style={{ marginTop: 14 }}>
                  <Field id="targetSuccess" label="Target success rate" value={targetSuccess} onChange={onTargetChange} suffix="%" step={1} min={50} max={99} {...tipProps} />
                  <div className="toggle-row">
                    <span className="toggle-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      Symmetric bands
                      <button type="button" className="tip-trigger" onClick={() => setActiveTip(activeTip === "symmetric" ? null : "symmetric")} aria-label="About symmetric bands">?</button>
                    </span>
                    <button
                      type="button"
                      className="sym-btn"
                      onClick={makeSymmetric}
                      disabled={bandsAreSymmetric}
                      aria-label="Make bands symmetric around target"
                    >
                      {bandsAreSymmetric ? "Bands symmetric" : "Make symmetric"}
                    </button>
                  </div>
                  {activeTip === "symmetric" && <p className="tip-text">{TIPS.symmetric}</p>}
                  <div className="field-row">
                    <Field
                      id="lowerBand"
                      label="Lower guardrail (cut)"
                      value={lowerBand}
                      onChange={onLowerChange}
                      suffix="%"
                      step={1}
                      min={0}
                      highlight={lowerValidErr}
                      hint={lowerValidErr ? <span className="err">Must be below target ({fmtPct(num(targetSuccess), 0)})</span> : undefined}
                      {...tipProps}
                    />
                    <Field
                      id="upperBand"
                      label="Upper guardrail (raise)"
                      value={upperBand}
                      onChange={onUpperChange}
                      suffix="%"
                      step={1}
                      max={100}
                      highlight={upperValidErr}
                      hint={upperValidErr ? <span className="err">Must be above target ({fmtPct(num(targetSuccess), 0)})</span> : undefined}
                      {...tipProps}
                    />
                  </div>
                  <div className="field-row">
                    <Field id="adjust" label="Standard adjustment" value={adjust} onChange={setAdjust} suffix="%" step={1} {...tipProps} />
                    <Field id="extWidth" label="Deep-zone buffer" value={extWidth} onChange={setExtWidth} suffix="pts" step={1} {...tipProps} />
                  </div>
                  <Field id="extAdjust" label="Deep cut / raise size" value={extAdjust} onChange={setExtAdjust} suffix="%" step={1} {...tipProps} />
                </div>
              )}
            </div>

            {/* Spending strategy */}
            <div className="pg-panel">
              <button className="pg-panel-header" onClick={() => setSpendingStrategyOpen(o => !o)}>
                <h2 className="pg-panel-title" style={{ margin: 0 }}>Spending strategy</h2>
                <span className={`pg-panel-chevron ${spendingStrategyOpen ? "open" : ""}`}>▼</span>
              </button>
              {spendingStrategyOpen && (
                <div style={{ marginTop: 14 }}>
                  <div className="toggle-row" style={{ paddingTop: 0 }}>
                    <span className="toggle-label">Dynamic guardrails</span>
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
                    <Field
                      id="floorWarnPct"
                      label="Floor warning threshold"
                      value={floorWarnPct}
                      onChange={setFloorWarnPct}
                      suffix="%"
                      step={5}
                      min={0}
                      max={100}
                      hint="Warn (in Current position) when your spending floor falls below this share of current withdrawal."
                      {...tipProps}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Market engine */}
            <div className="pg-panel">
              <button className="pg-panel-header" onClick={() => setMarketEngineOpen(o => !o)}>
                <h2 className="pg-panel-title" style={{ margin: 0 }}>Market engine</h2>
                <span className={`pg-panel-chevron ${marketEngineOpen ? "open" : ""}`}>▼</span>
              </button>
              {marketEngineOpen && (
                <div style={{ marginTop: 14 }}>
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
              )}
            </div>

          </div>
          </div>{/* end pg-left-col */}

          {/* ── RIGHT COLUMN ── */}
          <div className="pg-result">
            <div className="pg-result-sticky">

              {/* Validation errors */}
              {validationErrors.length > 0 && (
                <div className="validation-banner">
                  {validationErrors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                </div>
              )}

              {/* Stale state indicator */}
              {stale && !computing && (
                <div className="stale-banner">Results are out of date — recalculate to update</div>
              )}

              {/* Calculate button */}
              <button
                className={`calc-btn ${stale && !computing ? "stale" : ""}`}
                onClick={runCalc}
                disabled={computing || ageValidErr}
              >
                {computing ? "Calculating…" : stale ? "Update results" : "Recalculate"}
              </button>

              {/* Save / Reset — moved up so always visible */}
              <div className="btn-row">
                <button className="btn btn-primary" onClick={handleSave} disabled={saveStatus === "saving"}>
                  {saveStatus === "saving" ? "Saving…" : "Save"}
                </button>
                <button className="btn" onClick={() => setResetConfirmOpen(true)}>Reset</button>
              </div>
              {saveStatus === "saved" && <p className="save-msg">✓ Saved {savedAt}</p>}
              {saveStatus === "resetting" && <p className="save-msg">Reset to defaults</p>}
              {saveStatus === "error" && <p className="save-msg error">Save failed: {saveError}</p>}
              {!saveStatus && savedAt && <p className="save-msg">Last saved {savedAt}</p>}

              {/* Main results panel */}
              <div className="pg-panel" style={{ borderColor: zoneColor }}>

                {/* Zone + hero spending */}
                <div className="result-zone">
                  <div className="result-zone-label" style={{ color: zoneColor }}>
                    <span className="legend-dot" style={{ background: zoneColor }} />
                    {zoneLabel}
                  </div>
                  <div className="result-zone-sublabel" style={{ color: zoneColor }}>
                    {zoneSubLabel}
                  </div>

                  <div className={`result-amount ${stale ? "stale" : ""}`}>
                    {result ? fmtMoney(result.recommended) : "—"}
                  </div>
                  {result && result.recommended > 0 && (
                    <div className="result-amount-monthly">
                      {fmtMoney(result.recommended / 12)} / month
                    </div>
                  )}
                  <p className="result-sub">
                    {stale
                      ? "recalculate to update"
                      : result?.floorBound
                        ? "capped at your spending floor"
                        : "recommended withdrawal for this year"}
                  </p>
                  {result?.floorBound && (
                    <div className="floor-warning">
                      This year's guardrail cut would have gone below your {fmtMoney(num(spendFloor, 0))} floor.
                      The floor is now your binding constraint — if this persists, your essential spending
                      itself may be at risk, not just discretionary spending.
                    </div>
                  )}
                </div>

                {/* Success probability before → after */}
                {result && (
                  <div className="success-pair-row">
                    <div className="success-pair-section-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      Success probability
                      <button type="button" className="tip-trigger" onClick={() => setActiveTip(activeTip === "successPair" ? null : "successPair")} aria-label="About success probability">?</button>
                    </div>
                    {activeTip === "successPair" && <p className="tip-text">{TIPS.successPair}</p>}
                    <div className="success-pair">
                      <div className="success-pair-item">
                        <div className="success-pair-value" style={{ color: zoneColor }}>
                          {fmtPct(result.success)}
                        </div>
                        <div className="success-pair-item-label">now</div>
                      </div>
                      <div className="success-pair-arrow">→</div>
                      <div className="success-pair-item">
                        <div className="success-pair-value" style={{ color: "#15803d" }}>
                          {fmtPct(result.successAfter)}
                        </div>
                        <div className="success-pair-item-label">after adjustment</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Key stats */}
                <div className="result-stat-row">
                  <span className="result-stat-label">{ssReducesDraw ? "Portfolio draw rate" : "Withdrawal rate"}</span>
                  <span className="result-stat-value">{(ssReducesDraw ? netWithdrawalRate : withdrawalRate).toFixed(2)}%</span>
                </div>
                <div className="result-stat-row">
                  <span className="result-stat-label">Target band</span>
                  <span className="result-stat-value">{fmtPct(num(lowerBand), 0)} – {fmtPct(num(upperBand), 0)}</span>
                </div>
                <div className="result-stat-row">
                  <span className="result-stat-label">Sustainable at {fmtPct(num(targetSuccess), 0)}</span>
                  <span className="result-stat-value">{sustainableWithdrawal != null ? fmtMoney(sustainableWithdrawal) : "—"}</span>
                </div>
                {ssEnabled && (
                  <div className="result-stat-row">
                    <span className="result-stat-label">SS covers (at {num(ssClaimAge)})</span>
                    <span className="result-stat-value">{fmtMoney(num(ssMonthly) * 12)}/yr</span>
                  </div>
                )}

                {/* Collapsible details */}
                <button className="details-toggle" onClick={() => setDetailsOpen(!detailsOpen)}>
                  {detailsOpen ? "▲ Hide details" : "▼ Show details"}
                </button>
                {detailsOpen && result && (
                  <div className="details-section">
                    {dynamicMode && result.staticSuccess != null && (
                      <>
                        <div className="result-stat-row ref-line">
                          <span className="result-stat-label">Fixed spending (reference)</span>
                          <span className="result-stat-value">
                            {fmtPct(result.staticSuccess)}
                            {result.dynamicSuccess > result.staticSuccess && <span className="ref-delta"> · flexing adds {(result.dynamicSuccess - result.staticSuccess).toFixed(0)} pts</span>}
                          </span>
                        </div>
                        <div className="result-stat-row">
                          <span className="result-stat-label">Median spending w/ guardrails</span>
                          <span className="result-stat-value">{fmtMoney(result.dynamicMedianSpend)}</span>
                        </div>
                      </>
                    )}
                    <div className="result-stat-row">
                      <span className="result-stat-label">Engine</span>
                      <span className="result-stat-value">{engine === "historical" ? `Historical −${num(haircut)}pt` : "Normal dist."}</span>
                    </div>
                    <div className="result-stat-row">
                      <span className="result-stat-label">Years remaining</span>
                      <span className="result-stat-value">{years}</span>
                    </div>
                  </div>
                )}

                {/* Bridge stress box */}
                {result && result.bridge && ssEnabled && num(ssClaimAge) > num(currentAge) && (
                  <div className="bridge-box">
                    <div className="bridge-title">Pre-SS bridge stress (age {num(currentAge)}–{result.bridge.claimAge})</div>
                    <div className="result-stat-row">
                      <span className="result-stat-label">
                        {result.bridge.minBalance > 0
                          ? `Chance of ≥ ${fmtShort(result.bridge.minBalance)} at ${result.bridge.claimAge}${dynamicMode ? " (with guardrails)" : ""}`
                          : `Portfolio survives bridge alone${dynamicMode ? " (with guardrails)" : ""}`}
                      </span>
                      <span className="result-stat-value" style={{ color: result.bridge.survive >= num(bridgeFloor, 75) ? "#15803d" : result.bridge.survive >= num(bridgeFloor, 75) - num(extWidth) ? "#d97706" : "#b91c1c" }}>
                        {fmtPct(result.bridge.survive)}
                      </span>
                    </div>
                    {dynamicMode && (
                      <div className="result-stat-row ref-line">
                        <span className="result-stat-label">Rigid stress — no spending cuts</span>
                        <span className="result-stat-value">{fmtPct(result.bridge.surviveRigid)}</span>
                      </div>
                    )}
                    <div className="result-stat-row">
                      <span className="result-stat-label">Median balance at {result.bridge.claimAge} (rigid)</span>
                      <span className="result-stat-value">{fmtMoney(result.bridge.median)}</span>
                    </div>
                    <div className="result-stat-row">
                      <span className="result-stat-label">Poor case (10th pct) at {result.bridge.claimAge}</span>
                      <span className="result-stat-value">{fmtMoney(result.bridge.p10)}</span>
                    </div>
                    {result.bridgeOverrode && (
                      result.recommended < num(withdrawal) ? (
                        <p className="bridge-note" style={{ color: "#d97706", fontWeight: 600, marginTop: 8 }}>
                          ⚠ Bridge reserve odds are below your {num(bridgeFloor, 75)}% floor — spending was trimmed {Math.round((1 - result.recommended / num(withdrawal)) * 100)}% below your current draw{result.bridgeFloorRestored
                            ? ", the minimum needed to restore it, rather than applying the standard cut."
                            : ", the deepest cut allowed by your spending floor. That isn't enough to fully restore the reserve — consider claiming SS earlier (see below)."}
                        </p>
                      ) : (
                        <p className="bridge-note" style={{ color: "#d97706", fontWeight: 600, marginTop: 8 }}>
                          ⚠ The full-plan guardrail would raise spending, but that would push your bridge reserve odds below your {num(bridgeFloor, 75)}% floor. The increase was limited to {fmtMoney(result.recommended)} — the most you can spend while keeping the reserve intact.
                        </p>
                      )
                    )}
                    {result.bridge.claimSensitivity.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div className="bridge-title" style={{ color: "var(--text-dim)" }}>If you claimed SS at…</div>
                        {result.bridge.claimSensitivity.map(cs => (
                          <div className="result-stat-row ref-line" key={cs.claimAge}>
                            <span className="result-stat-label">
                              Age {cs.claimAge} · {cs.claimAge - num(currentAge)}-yr bridge{cs.claimAge === result.bridge!.claimAge ? " (current)" : ""}
                            </span>
                            <span className="result-stat-value">{fmtPct(cs.survive)}</span>
                          </div>
                        ))}
                        <p className="bridge-note">
                          Claiming earlier shortens the bridge and lifts these odds, but permanently lowers your monthly benefit and stretches the years funded partly from the portfolio. A planning signal, not a recommendation.
                        </p>
                      </div>
                    )}
                    <p className="bridge-note">
                      Full {fmtMoney(num(withdrawal))} draw from the portfolio alone, before SS starts — the window most exposed to a bad early sequence.{dynamicMode ? " Top line assumes you flex spending per your guardrails; the rigid line assumes you don't." : ""}
                    </p>
                  </div>
                )}
              </div>

              {/* Sensitivity chart */}
              <div className="pg-panel">
                <h2 className="pg-panel-title">Success rate vs. withdrawal</h2>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sensitivityData} margin={{ top: 5, right: 10, left: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
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
                      {/* Target success rate */}
                      <ReferenceLine y={num(targetSuccess)} stroke="#15803d" strokeDasharray="4 4" />
                      {/* Lower guardrail band */}
                      <ReferenceLine y={num(lowerBand)} stroke="#d97706" strokeDasharray="3 3" strokeOpacity={0.75} />
                      {/* Upper guardrail band */}
                      <ReferenceLine y={num(upperBand)} stroke="#0d9488" strokeDasharray="3 3" strokeOpacity={0.75} />
                      {/* Current withdrawal vertical marker */}
                      <ReferenceLine x={num(withdrawal)} stroke="#555" strokeDasharray="2 2" />
                      <Area type="monotone" dataKey="success" stroke="#0ea5e9" fill="url(#successGrad)" strokeWidth={2} isAnimationActive={false} dot={false} />
                      {/* Dot at current position on the curve */}
                      {result && !stale && (
                        <ReferenceDot x={num(withdrawal)} y={result.success} r={5} fill="#0ea5e9" stroke="#fff" strokeWidth={2} />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <p className="chart-caption">
                  Green dashed = target. Amber dashed = lower guardrail. Teal dashed = upper guardrail. Vertical line = current withdrawal. Dot = your current plan position.
                </p>
              </div>
            </div>
          </div>

        </div>

        <p style={{ fontSize: 12, color: "#ccc", textAlign: "center", marginTop: 20 }}>For educational purposes only · Not financial advice</p>
      </div>
    </div>
  );
}
