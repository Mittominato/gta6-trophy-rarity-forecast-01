// GTA VI trophy rarity forecast — per-trophy logit-growth forecaster.
//
// The median for each trophy comes from a least-squares line fitted on the
// case's own reads: logit(earn rate) against ln(1 + hours since launch),
// fitted on the last 24 hours of reads (launch-week growth decelerates, so
// the fast early hours must not drag the extrapolation; with fewer than
// three reads in the window, all reads are used). Each trophy's slope is
// shrunk towards its tier's mean slope (platinum, gold, silver, bronze),
// itself shrunk towards the overall mean for small tiers, and the line is
// anchored on the last read, so a flat history forecasts a flat rate and
// the median never runs more than 3 logit units from the last observed
// rate. The spread around the median combines a random-walk term that
// grows with the horizon, the fit's own residuals, and — only when the
// case's page has been completely flat for hours — a refresh allowance
// explained below.
//
// The stale-page allowance: Exophase refreshes its counts on its own
// schedule, not continuously. The rules note the launch-night page sat
// unchanged (638 players tracked, every rate the same) from 2026-11-18
// 23:48 UTC until a refresh at 2026-11-19 04:30 UTC, when the tracked count
// jumped to 3,868 and every rate but the one at 100% fell. So a history in
// which nothing has moved for hours is not evidence that nothing will move:
// it is evidence a refresh is pending, and a refresh moves rates down,
// because the denominator jumps faster than earned counts do. When the
// history is flat like that (at most two distinct reads and nothing changed
// for at least 1.5 hours before the checkpoint), the median is shifted down
// by the refresh probability times a central drop, and the spread is widened
// by the mixture variance. When the history moves normally — as the final
// case's two days of reads will — this allowance is zero and the fitted
// growth curves do all the work. The central drop of 1.6 logit is inferred
// from numbers the rules themselves report: the house baseline's practice
// loss (~1.51, typical miss ~0.68 points) together with that 638 -> 3,868
// jump. A refresh that left earned counts frozen would put the baseline's
// loss at ~1.69; the reported ~1.51 is matched when earned counts grew
// only ~1.2x across the refresh, i.e. the refreshed rates sit at ~0.20x
// the last read, a logit drop of ~1.6 (and the 6.06x denominator jump caps
// any drop at ln(6.06) = 1.80). The exact drop is uncertain — hence the
// mixture spread — but the centre is the rules' own numbers, not a guess
// at any answer.
//
// Standard library only, no network, no randomness, no clock reads: the
// output is a pure function of the case file, so two runs agree byte for
// byte. Node 22, run as `node main.ts` with MAKEFUN_INPUT_DIR /
// MAKEFUN_OUTPUT_DIR set outside the grader, else /input and /output.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Random-walk spread, in logit units per square-root day. */
const SIGMA_RW = 0.5;
/** Launch moment the log-time clock runs from (the game's release day). */
const LAUNCH_MS = Date.parse('2026-11-19T00:00:00Z');
/** How strongly a trophy's growth is pulled towards its tier's mean growth. */
const SHRINK_K = 4;
/** Central logit drop if a pending refresh lands (see the header note). */
const REFRESH_DROP = 1.6;

interface Trophy {
  id: number;
  tier: string;
}

interface Read {
  at: string;
  players_tracked: number;
  rates: Array<number | null>;
}

interface Case {
  id: string;
  at: string;
  horizon_minutes: number;
  levels: number[];
  trophies: Trophy[];
  history: Read[];
}

const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));
const logit = (pct: number): number => {
  const p = clamp(pct, 0.01, 99.99) / 100;
  return Math.log(p / (1 - p));
};
const invLogit = (l: number): number => 100 / (1 + Math.exp(-l));
/** x rounded to 4 decimals. */
const round4 = (x: number): number => Math.round(x * 10000) / 10000;
const hoursSinceLaunch = (iso: string): number =>
  (Date.parse(iso) - LAUNCH_MS) / 3600000;
/** log-time coordinate: ln(1 + hours since launch). */
const logTime = (iso: string): number =>
  Math.log(1 + Math.max(0, hoursSinceLaunch(iso)));

interface Fit {
  slope: number;
  residStd: number;
  distinct: number;
}

/**
 * Least-squares line of y against x. With fewer than two distinct x values
 * the slope is unidentified and reported as 0 with zero residual spread.
 */
function leastSquares(xs: number[], ys: number[]): Fit {
  const n = xs.length;
  if (n === 0) return { slope: 0, residStd: 0, distinct: 0 };
  const distinct = new Set(xs.map((x) => x.toFixed(9))).size;
  if (n < 2 || distinct < 2) return { slope: 0, residStd: 0, distinct };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx <= 1e-12) return { slope: 0, residStd: 0, distinct };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ss = 0;
  for (let i = 0; i < n; i += 1) {
    const r = ys[i] - (intercept + slope * xs[i]);
    ss += r * r;
  }
  const residStd = n > 2 ? Math.sqrt(ss / (n - 2)) : 0;
  return { slope, residStd, distinct };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Last non-null rate for a trophy, scanning the history backwards. */
function lastRate(history: Read[], j: number): number | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const r = history[i].rates[j];
    if (r !== null && r !== undefined) return r;
  }
  return null;
}

function forecastCase(c: Case): Array<{ id: number; q: number[] }> {
  const horizonDays = c.horizon_minutes / 1440;
  const horizonHours = c.horizon_minutes / 60;
  const targetMs = Date.parse(c.at) + c.horizon_minutes * 60000;
  const targetIso = new Date(targetMs).toISOString();
  const xTarget = logTime(targetIso);
  const history = c.history;
  const nTrophies = c.trophies.length;

  // --- The fitting window: the last 24 hours of reads. ---
  // Launch-week growth decelerates, so the fast early hours must not drag
  // the extrapolation. With fewer than three reads in the window, all reads.
  const cutoffMs = Date.parse(c.at) - 24 * 3600 * 1000;
  const inWindow = history.filter((r) => Date.parse(r.at) >= cutoffMs);
  const wHist = inWindow.length >= 3 ? inWindow : history;
  const xs = wHist.map((r) => logTime(r.at));
  const xLast = xs.length > 0 ? xs[xs.length - 1] : 0;
  const xSpan = Math.max(0.5, xLast - (xs.length > 0 ? xs[0] : xLast));
  const extrap = clamp((xTarget - xLast) / xSpan, 0, 1);

  // --- Per-trophy logit-growth fits, shrunk to tier means. ---
  const rawSlopes: number[] = [];
  const residStds: number[] = [];
  for (let j = 0; j < nTrophies; j += 1) {
    const ex: number[] = [];
    const ey: number[] = [];
    for (let i = 0; i < wHist.length; i += 1) {
      const r = wHist[i].rates[j];
      if (r === null || r === undefined) continue;
      ex.push(xs[i]);
      ey.push(logit(r));
    }
    const fit = leastSquares(ex, ey);
    rawSlopes.push(clamp(fit.slope, -0.5, 3));
    residStds.push(Math.min(0.6, fit.residStd));
  }

  // Tier means of the raw slopes, themselves shrunk to the overall mean
  // when a tier has almost no trophies (platinum has one).
  const tiers = [...new Set(c.trophies.map((t) => t.tier))];
  const overallMean = mean(rawSlopes);
  const tierMean = new Map<string, number>();
  for (const tier of tiers) {
    const members: number[] = [];
    for (let j = 0; j < nTrophies; j += 1) {
      if (c.trophies[j].tier === tier) members.push(rawSlopes[j]);
    }
    const m = mean(members);
    tierMean.set(tier, (members.length * m + 2 * overallMean) / (members.length + 2));
  }

  // --- The stale-page (pending refresh) allowance. ---
  // Distinct reads and the last moment anything changed, measured at the
  // checkpoint (not the target: the final's target is days away, but its
  // page is fresh at the checkpoint, so this stays zero there).
  const seen = new Set<string>();
  let lastChangeAt = history.length > 0 ? Date.parse(history[0].at) : Date.parse(c.at);
  let prevKey = '';
  for (const r of history) {
    const key = `${r.players_tracked}|${r.rates.join(',')}`;
    seen.add(key);
    if (prevKey !== '' && key !== prevKey) lastChangeAt = Date.parse(r.at);
    prevKey = key;
  }
  const staleHours = Math.max(0, (Date.parse(c.at) - lastChangeAt) / 3600000);
  const staleRegime = seen.size <= 2 && staleHours >= 1.5;
  // The one refresh the rules report came about 4.7 hours after the page
  // froze, so treat the next refresh as due within roughly 6 hours of the
  // last change: the longer the page has already been stale, the larger the
  // share of that window the horizon covers, and the likelier the refresh
  // lands before the target. (An exponential waiting time would get this
  // backwards — longer staleness must raise, not lower, the probability.)
  const pRefresh = staleRegime
    ? clamp(horizonHours / Math.max(1, 6 - staleHours), 0, 0.9)
    : 0;
  const refreshShift = -pRefresh * REFRESH_DROP;
  const refreshSpread = staleRegime
    ? Math.sqrt(pRefresh * (1 - pRefresh)) * REFRESH_DROP + 0.25
    : 0;

  const rows: Array<{ id: number; q: number[] }> = [];
  for (let j = 0; j < nTrophies; j += 1) {
    const tier = c.trophies[j].tier;
    const shrunk =
      (wHist.length * rawSlopes[j] + SHRINK_K * (tierMean.get(tier) ?? overallMean)) /
      (wHist.length + SHRINK_K);
    const lr = lastRate(history, j);
    const base = lr === null ? 1.0 : lr;
    // Anchor on the last read: a flat history forecasts a flat rate, and
    // the extrapolation never runs more than 3 logit units from it.
    let centre = logit(base) + shrunk * (xTarget - xLast);
    if (lr !== null) centre = clamp(centre, logit(lr) - 3, logit(lr) + 3);
    // The trophy already at 100% did not fall in the reported refresh.
    if (!(lr !== null && lr >= 99.9)) centre += refreshShift;
    centre = clamp(centre, logit(0.01), logit(99.99));

    const sigmaRw = SIGMA_RW * Math.sqrt(Math.max(0, horizonDays));
    const sigmaFit = residStds[j] * (0.3 + 0.7 * extrap);
    const sigma = clamp(
      Math.sqrt(sigmaRw * sigmaRw + sigmaFit * sigmaFit + refreshSpread * refreshSpread),
      0.12,
      2.0,
    );
    const q = Z.map((z) => round4(clamp(invLogit(centre + z * sigma), 0, 100)));
    // Guard the ordering against rounding (z is increasing, so this is a
    // no-op in practice, but the contract is non-decreasing quantiles).
    for (let k = 1; k < q.length; k += 1) {
      if (q[k] < q[k - 1]) q[k] = q[k - 1];
    }
    rows.push({ id: c.trophies[j].id, q });
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR)
  .filter((f) => f.endsWith('.in'))
  .sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(
      `${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`,
    );
  }
  if (c.history.length === 0) throw new Error(`${file} has no history`);
  const trophies = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ trophies })}\n`);
}
