import { describe, expect, it } from 'vitest';
import { byId, CATALOG } from './catalog';
import { createMission, floorWh, NOT_HERE_YET, tick, transmit } from './engine';
import { fsplDb } from './link';
import { periodMin } from './orbit';
import { buildScenario, checkCommunity } from './scenario';
import type { LatLon, MissionDesign, MissionState } from './types';

const LOCATIONS: LatLon[] = [
  { lat: 6.5, lon: 3.4 },     // Lagos
  { lat: 29.8, lon: -95.4 },  // Houston
  { lat: -33.9, lon: 151.2 }, // Sydney
  { lat: 51.5, lon: -0.1 },   // London
  { lat: 0, lon: 179.5 },     // dateline wrap
  { lat: -54.8, lon: -68.3 }, // Ushuaia, near the latitude limit
  { lat: 19.4, lon: -99.1 },
  { lat: 35.7, lon: 139.7 },
];

const design = (community: LatLon, tx: string, bat: string, orb: string): MissionDesign => ({
  community, transmitter: byId(tx), battery: byId(bat), orbit: byId(orb),
});

const setup = (loc: LatLon, tx: string, bat: string, orb: string) => {
  const d = design(loc, tx, bat, orb);
  const sc = buildScenario(loc, d.orbit.altitudeKm!);
  if (!sc) throw new Error('no scenario');
  return { d, sc, s: createMission(d, sc) };
};

const run = (s: MissionState, d: MissionDesign, policy: (s: MissionState) => boolean) => {
  let batteryAtR3: number | null = null;
  // First post-disruption relief pass opens exactly when the flood lifts.
  while (s.outcome === 'running') {
    if (batteryAtR3 === null && s.tMin >= s.disruption.endMin) batteryAtR3 = s.batteryWh;
    if (s.activePass && policy(s)) s = transmit(s, d).state;
    s = tick(s, d, 1);
  }
  return { s, batteryAtR3 };
};

describe('orbit', () => {
  it('1. 400 km period is 91-94 min', () => {
    expect(periodMin(400)).toBeGreaterThan(91);
    expect(periodMin(400)).toBeLessThan(94);
  });

  it('2. every orbit and location yields >= 3 passes per site', () => {
    for (const orb of CATALOG.filter((c) => c.slot === 'orbit')) {
      for (const loc of LOCATIONS) {
        const sc = buildScenario(loc, orb.altitudeKm!);
        expect(sc, `${orb.id} @ ${loc.lat},${loc.lon}`).not.toBeNull();
        expect(sc!.passes.filter((p) => p.site === 'community').length).toBeGreaterThanOrEqual(3);
        expect(sc!.passes.filter((p) => p.site === 'relief').length).toBeGreaterThanOrEqual(3);
        expect(sc!.passes.every((p) => p.endMin <= sc!.deadlineMin)).toBe(true);
        expect(sc!.deadlineMin).toBeLessThanOrEqual(1440);
      }
    }
  });

  it('rejects polar communities with a reason', () => {
    const c = checkCommunity({ lat: 78, lon: 15 });
    expect(c.ok).toBe(false);
    expect(buildScenario({ lat: 78, lon: 15 }, 400)).toBeNull();
  });
});

describe('link', () => {
  it('3. FSPL at 1000 km, 437 MHz is ~145.2 dB', () => {
    expect(Math.abs(fsplDb(1000) - 145.2)).toBeLessThan(0.5);
  });
});

describe('4. the trap', () => {
  for (const loc of LOCATIONS) {
    it(`a. brute force tx25+bat40+orb600 runs out of energy @ ${loc.lat},${loc.lon}`, () => {
      const { d, s } = setup(loc, 'tx25', 'bat40', 'orb600');
      const { s: end, batteryAtR3 } = run(s, d, () => true);
      expect(batteryAtR3!).toBeLessThan(floorWh(d));
      expect(end.outcome).toBe('lost');
      expect(end.failure).toBe('energy');
    });

    it(`b. frugal tx2+bat80+orb400 wins with a disciplined plan @ ${loc.lat},${loc.lon}`, () => {
      const { d, s } = setup(loc, 'tx2', 'bat80', 'orb400');
      const { s: end } = run(s, d, (st) => {
        const p = st.activePass!;
        if (p.site === 'community') return st.message === 'AT_COMMUNITY';
        return st.message === 'ON_SATELLITE' && st.reliefOfflineUntilMin === null && st.tMin >= st.disruption.endMin;
      });
      expect(end.outcome).toBe('won');
    });
  }
});

describe('player actions', () => {
  it('5. transmit outside a pass logs the exact "not here yet" line', () => {
    const { d, s: s0 } = setup(LOCATIONS[0], 'tx10', 'bat80', 'orb600');
    let s = s0;
    while (s.activePass) s = tick(s, d);
    const next = s.passes.find((p) => p.startMin > s.tMin && p.site === 'community')!;
    const r = transmit(s, d);
    expect(r.ok).toBe(false);
    expect(r.state.log[r.state.log.length - 1].text).toBe(NOT_HERE_YET(next.startMin - s.tMin));
    expect(r.state.log[r.state.log.length - 1].text).toMatch(/^You're pointing correctly\. Your satellite isn't here yet\. Next pass in \d{2,}:\d\d\.$/);
    expect(r.state.batteryWh).toBe(s.batteryWh);
  });

  it('6. relief offline window fails with the offline reason; next pass succeeds', () => {
    const { d, s: s0 } = setup(LOCATIONS[1], 'tx10', 'bat120', 'orb400');
    let s = s0;
    const r2 = s.passes.find((p) => p.site === 'relief' && p.startMin === s.disruption.startMin)!;
    const r3 = s.passes.find((p) => p.site === 'relief' && p.startMin === s.disruption.endMin)!;
    const c1 = s.passes.find((p) => p.site === 'community')!;
    while (s.tMin < c1.startMin) s = tick(s, d);
    s = transmit(s, d).state;
    expect(s.message).toBe('ON_SATELLITE');
    while (s.tMin < r2.startMin) s = tick(s, d);
    const fail = transmit(s, d);
    expect(fail.ok).toBe(false);
    expect(fail.text).toMatch(/offline \(flooded\)/);
    s = fail.state;
    while (s.tMin < r3.startMin) s = tick(s, d);
    const ok = transmit(s, d);
    expect(ok.ok).toBe(true);
    expect(ok.state.outcome).toBe('won');
  });

  it('weak link fails with a link reason (tx2 from 800 km)', () => {
    const { d, s: s0 } = setup(LOCATIONS[0], 'tx2', 'bat80', 'orb800');
    let s = s0;
    const c1 = s.passes.find((p) => p.site === 'community')!;
    while (s.tMin < c1.startMin) s = tick(s, d);
    const r = transmit(s, d);
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/dB too weak/);
  });

  it('conserve blocks transmit and stops idle drain; double-press on a pass is ignored', () => {
    const { d, s: s0 } = setup(LOCATIONS[0], 'tx2', 'bat80', 'orb400');
    let s = s0;
    const c1 = s.passes.find((p) => p.site === 'community')!;
    while (s.tMin < c1.startMin) s = tick(s, d);
    s = { ...s, conserve: true };
    expect(transmit(s, d).ok).toBe(false);
    s = { ...s, conserve: false };
    s = transmit(s, d).state;
    const wh = s.batteryWh;
    const again = transmit(s, d);
    expect(again.ok).toBe(false);
    expect(again.state.batteryWh).toBe(wh);
  });

  it('idle deadline with no action is lost as scheduling', () => {
    const { d, s: s0 } = setup(LOCATIONS[2], 'tx10', 'bat80', 'orb600');
    let s = s0;
    while (s.outcome === 'running') s = tick(s, d);
    expect(s.outcome).toBe('lost');
    expect(s.failure).toBe('scheduling');
    expect(s.tMin).toBe(s.deadlineMin);
  });
});
