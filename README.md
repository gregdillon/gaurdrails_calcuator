# Guardrails Calculator

A retirement withdrawal guardrails calculator based on the [Guyton-Klinger rules](https://www.kitces.com/blog/guyton-klinger-guardrails-retirement-spending-rules/).

## What it does

Enter your portfolio value, planned annual spending, and guardrail thresholds, and the app will:

- Compute your current withdrawal rate and show your guardrail status (on track / cut / raise / extended cut / extended raise)
- Calculate adjusted spending after a guardrail trigger, with an optional midpoint reset
- Run a year-by-year portfolio projection and display it as a line chart

<a href="https://gregdillon.github.io/gaurdrails_calcuator/" target="_blank">Try it out</a>

## Key features

- **Symmetric guardrails** — keeps upper/lower thresholds equidistant from your initial withdrawal rate
- **Prosperity rule** (Guyton-Klinger 2006) — skips the annual inflation adjustment in years where the portfolio had a negative pre-withdrawal return
- **Fixed income** — subtract Social Security, pension, or other fixed income from gross withdrawals before computing the portfolio draw rate, with optional COLA inflation adjustment
- **Persistent settings** — inputs are saved to `localStorage` and restored on reload

## Stack

React 19 + TypeScript, bundled with Vite. Chart rendered with [Recharts](https://recharts.org). No routing, no state management library, no backend.

## Commands

```bash
npm run dev        # Start dev server (Vite HMR)
npm run build      # Type-check then build for production
npm run lint       # Run ESLint
npm run preview    # Preview the production build locally
```
