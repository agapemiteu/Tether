import { DEADLINE_MIN, MAX_COMMUNITY_LAT, MAX_DEADLINE_MIN, MIN_PASSES_PER_SITE, RELIEF_LON_OFFSET_DEG } from './constants';
import { computePasses, normLon, periodMin } from './orbit';
import type { LatLon, Pass, Scenario } from './types';

export const SCENARIO_LABEL = 'Simulated scenario. Not a prediction for this location.';

export const reliefFor = (community: LatLon): LatLon => ({
  lat: community.lat,
  lon: normLon(community.lon + RELIEF_LON_OFFSET_DEG),
});

export type LocationCheck = { ok: true } | { ok: false; reason: string };

export const checkCommunity = (c: LatLon): LocationCheck =>
  Math.abs(c.lat) > MAX_COMMUNITY_LAT
    ? { ok: false, reason: `Too close to the pole. A 51.6° orbit can't reliably reach latitudes beyond ±${MAX_COMMUNITY_LAT}°. Pick a spot nearer the equator.` }
    : { ok: true };

/**
 * Relief passes that could carry the message: those still open once the
 * community's first pass begins. The flood always hits the first of these
 * and lifts at the start of the second, so the disruption is a real obstacle
 * for every design and an uplink+downlink in one overlap is impossible.
 * (In the usual geometry this is exactly relief pass 2 -> relief pass 3.)
 */
const deliverable = (passes: Pass[]): Pass[] => {
  const c1 = passes.find((p) => p.site === 'community');
  return c1 ? passes.filter((p) => p.site === 'relief' && p.endMin > c1.startMin) : [];
};

const playable = (passes: Pass[]): boolean => {
  const c = passes.filter((p) => p.site === 'community').length;
  const r = passes.filter((p) => p.site === 'relief').length;
  return c >= MIN_PASSES_PER_SITE && r >= MIN_PASSES_PER_SITE && deliverable(passes).length >= 2;
};

const DEADLINE_STEP_MIN = 120;

/** Smallest deadline (in 2 h steps) at which this schedule becomes playable, or null. */
const minDeadline = (all: Pass[]): number | null => {
  for (let d = DEADLINE_MIN; d <= MAX_DEADLINE_MIN; d += DEADLINE_STEP_MIN) {
    if (playable(all.filter((p) => p.endMin <= d))) return d;
  }
  return null;
};

/**
 * Deterministic search over the satellite's starting longitude and orbital
 * phase. Prefers the standard 10 h window; near the equator the ground track
 * sweeps a site only ~2 times per 10 h, so the window is stretched in 2 h steps
 * (never faked) until a playable schedule exists.
 */
export const buildScenario = (community: LatLon, altKm: number): Scenario | null => {
  if (!checkCommunity(community).ok) return null;
  const relief = reliefFor(community);
  const period = periodMin(altKm);
  let best: { d: number; lon0: number; phaseMin: number; all: Pass[] } | null = null;
  for (let j = 0; j < 12; j++) {
    if (best && (best as { d: number }).d === DEADLINE_MIN) break;
    const phaseMin = (j * period) / 12;
    for (let k = 0; k < 180; k++) {
      const lon0 = normLon(community.lon - 60 + k * 2);
      const all = computePasses({ community, relief }, altKm, lon0, phaseMin, MAX_DEADLINE_MIN);
      const d = minDeadline(all);
      if (d !== null && (!best || d < best.d)) best = { d, lon0, phaseMin, all };
      if (best?.d === DEADLINE_MIN) break;
    }
  }
  if (!best) return null;
  const passes = best.all.filter((p) => p.endMin <= best!.d);
  const r = deliverable(passes);
  return {
    community, relief, lon0: best.lon0, phaseMin: best.phaseMin, passes, deadlineMin: best.d,
    disruption: { startMin: r[0].startMin, endMin: r[1].startMin },
  };
};
