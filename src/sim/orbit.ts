import {
  DEADLINE_MIN, EARTH_ROT_DEG_PER_MIN, ELEVATION_MASK_DEG, INCLINATION_DEG,
  MU, R_EARTH, SUNLIT_FRACTION,
} from './constants';
import type { LatLon, Pass, Site } from './types';

const D2R = Math.PI / 180;
const MASK = ELEVATION_MASK_DEG * D2R;

export const periodMin = (altKm: number): number =>
  (2 * Math.PI * Math.sqrt((R_EARTH + altKm) ** 3 / MU)) / 60;

export const normLon = (lon: number): number => {
  const x = ((((lon + 180) % 360) + 360) % 360) - 180;
  return x;
};

export const subSatellite = (t: number, altKm: number, lon0: number, phaseMin = 0): LatLon => {
  const p = periodMin(altKm);
  return {
    lat: INCLINATION_DEG * Math.sin((2 * Math.PI * (t + phaseMin)) / p),
    lon: normLon(lon0 + (360 * t) / p - EARTH_ROT_DEG_PER_MIN * t),
  };
};

export const greatCircleKm = (a: LatLon, b: LatLon): number => {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
};

export const footprintRadiusKm = (altKm: number): number =>
  R_EARTH * (Math.acos((R_EARTH / (R_EARTH + altKm)) * Math.cos(MASK)) - MASK);

/** Worst-case slant range (at the elevation mask), used for the whole pass. */
export const slantRangeKm = (altKm: number): number =>
  Math.sqrt((R_EARTH + altKm) ** 2 - (R_EARTH * Math.cos(MASK)) ** 2) - R_EARTH * Math.sin(MASK);

export const isSunlit = (t: number, altKm: number): boolean => {
  const p = periodMin(altKm);
  return (t % p) / p < SUNLIT_FRACTION;
};

const STEP = 0.5; // pass-detection resolution, minutes
const MIN_PASS_MIN = 1; // shorter grazes are not usable

export const computePasses = (
  sites: Record<Site, LatLon>, altKm: number, lon0: number, phaseMin = 0, horizon = DEADLINE_MIN,
): Pass[] => {
  const radius = footprintRadiusKm(altKm);
  const range = slantRangeKm(altKm);
  const passes: Pass[] = [];
  for (const site of ['community', 'relief'] as Site[]) {
    let start: number | null = null;
    const steps = Math.round(horizon / STEP);
    for (let i = 0; i <= steps; i++) {
      const t = i * STEP;
      const inView = greatCircleKm(subSatellite(t, altKm, lon0, phaseMin), sites[site]) <= radius;
      if (inView && start === null) start = t;
      const closing = start !== null && (!inView || i === steps);
      if (closing && start !== null) {
        const end = inView ? t : t - STEP;
        if (end - start >= MIN_PASS_MIN) {
          passes.push({ site, startMin: start, endMin: end, maxElevationDistanceKm: range, sunlit: isSunlit(start, altKm) });
        }
        start = null;
      }
    }
  }
  return passes.sort((a, b) => a.startMin - b.startMin);
};
