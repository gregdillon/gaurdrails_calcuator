# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server (Vite HMR)
npm run build      # Type-check then build for production (tsc -b && vite build)
npm run lint       # Run ESLint
npm run preview    # Preview the production build locally
```

No test framework is currently set up.

## Architecture

This is a single-page React 19 + TypeScript app bundled with Vite. All application logic lives in one file: [src/App.tsx](src/App.tsx).

**What it does:** A retirement withdrawal guardrails calculator based on the Guyton-Klinger rules. The user inputs portfolio value, withdrawal amount, guardrail thresholds, return/inflation assumptions, and age range. The app:
1. Computes the current withdrawal rate and determines guardrail status (ok / cut / raise / extCut / extRaise).
2. Calculates the adjusted spending after a guardrail trigger, with optional midpoint reset.
3. Runs a year-by-year portfolio projection (via `useMemo`) and renders it as a line chart using Recharts.

**Key data flow in `App.tsx`:**
- `DEFAULTS` — initial values for all inputs.
- `TIPS` — tooltip strings keyed to each input field name.
- `STATUS` — display config (label, color, emoji) for each guardrail status.
- `getStatus(rate, lower, upper, extWidth)` — pure function that maps a withdrawal rate to a status key.
- `GuardrailsCalc` (default export) — single large component holding all state. The `projection` memo re-runs the simulation whenever any relevant input changes.
- Symmetric guardrail mode: toggling `symmetric` keeps upper/lower equidistant from the initial withdrawal rate; the `setUpper`/`setLower` wrappers enforce this.
- Fixed income (Social Security, pension) is subtracted from gross withdrawal before computing the portfolio draw rate.
- Prosperity rule (Guyton-Klinger 2006): skips the annual inflation adjustment in years where the portfolio had a negative pre-withdrawal return.

**UI components (all in App.tsx):** `TooltipIcon`, `NumInput`, `Card`, `SectionTitle`, `SubHeading`, `Toggle`, `Divider` — small inline presentational helpers with inline styles (no CSS modules or Tailwind).

**Chart:** Recharts `LineChart` with a `ResponsiveContainer`. Data comes directly from the `projection` array.

**No routing, no state management library, no backend.**
