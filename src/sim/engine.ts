import { IDLE_LOAD_W, SOLAR_W, TX_FLOOR_FRACTION } from './constants';
import { marginDb } from './link';
import { isSunlit, slantRangeKm } from './orbit';
import type {
  FailureClass, LogEvent, LogKind, MissionDesign, MissionState, Pass, Scenario, Site,
} from './types';

// ---------- formatting helpers (pure, shared with UI) ----------

export const fmtClock = (tMin: number): string => {
  const m = Math.max(0, Math.floor(tMin));
  return `T+${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Sim minutes rendered as mm:ss. */
export const fmtMMSS = (min: number): string => {
  const s = Math.max(0, Math.round(min * 60));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const SITE_NAME: Record<Site, string> = { community: 'community', relief: 'relief station' };

// ---------- derived values ----------

/** Bus idle load plus the radio's standby draw. CONSERVE switches both off. */
export const idleLoadW = (d: MissionDesign): number => IDLE_LOAD_W + (d.transmitter.standbyW ?? 0);
export const capacity = (d: MissionDesign): number => d.battery.capacityWh ?? 0;
export const floorWh = (d: MissionDesign): number => capacity(d) * TX_FLOOR_FRACTION;
export const alt = (d: MissionDesign): number => d.orbit.altitudeKm ?? 0;
export const linkMargin = (d: MissionDesign): number =>
  marginDb(d.transmitter.txPowerW ?? 0, slantRangeKm(alt(d)));

export const neededSite = (s: MissionState): Site | null =>
  s.message === 'AT_COMMUNITY' ? 'community' : s.message === 'ON_SATELLITE' ? 'relief' : null;

/**
 * The pass in progress at t. Community and relief footprints can overlap, so
 * when both are in view the one the message needs next takes priority.
 */
export const passAt = (passes: Pass[], t: number, prefer?: Site | null): Pass | null => {
  const open = passes.filter((p) => t >= p.startMin && t <= p.endMin);
  return open.find((p) => p.site === prefer) ?? open[0] ?? null;
};

export const nextPass = (s: MissionState, site?: Site | null): Pass | null =>
  s.passes.find((p) => p.startMin > s.tMin && (!site || p.site === site)) ?? null;

const passIndex = (s: MissionState, p: Pass): number => s.passes.indexOf(p);

// ---------- state construction ----------

export const createMission = (design: MissionDesign, scenario: Scenario): MissionState => {
  const s: MissionState = {
    tMin: 0,
    deadlineMin: scenario.deadlineMin,
    message: 'AT_COMMUNITY',
    batteryWh: capacity(design),
    conserve: false,
    passes: scenario.passes,
    activePass: passAt(scenario.passes, 0, 'community'),
    reliefOfflineUntilMin: null,
    log: [],
    outcome: 'running',
    failure: null,
    disruption: scenario.disruption,
    usedPasses: [],
    closedPasses: [],
    everBelowFloor: false,
    failures: [],
  };
  const c = scenario.passes.filter((p) => p.site === 'community').length;
  const r = scenario.passes.length - c;
  return log(s, 'info', `Launched: ${design.transmitter.name}, ${design.battery.name}, ${design.orbit.name}. ${c} community passes and ${r} relief passes predicted before the deadline. Link margin ${fmtDb(linkMargin(design))}.`);
};

const fmtDb = (db: number): string => `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;

const log = (s: MissionState, kind: LogKind, text: string): MissionState => ({
  ...s, log: [...s.log, { tMin: s.tMin, kind, text } as LogEvent],
});

// ---------- tick ----------

export const tick = (state: MissionState, design: MissionDesign, dt = 1): MissionState => {
  if (state.outcome !== 'running') return state;
  let s: MissionState = { ...state, tMin: Math.min(state.tMin + dt, state.deadlineMin) };
  const hours = (s.tMin - state.tMin) / 60;
  const cap = capacity(design);
  const wasAboveFloor = state.batteryWh >= floorWh(design);

  let wh = s.batteryWh;
  if (!s.conserve) wh -= idleLoadW(design) * hours;
  if (isSunlit(state.tMin, alt(design))) wh += SOLAR_W * hours;
  s.batteryWh = Math.min(cap, Math.max(0, wh));

  if (wasAboveFloor && s.batteryWh < floorWh(design)) {
    s = log({ ...s, everBelowFloor: true }, 'battery_empty',
      `Battery fell below the ${Math.round(TX_FLOOR_FRACTION * 100)}% transmit floor (${s.batteryWh.toFixed(1)} of ${cap} Wh). The radio is locked out until the solar panels recharge it.`);
  }

  // Scripted disruption.
  if (s.reliefOfflineUntilMin === null && state.tMin < s.disruption.startMin && s.tMin >= s.disruption.startMin) {
    s = log({ ...s, reliefOfflineUntilMin: s.disruption.endMin }, 'disruption',
      `Relief station flooded. Back online at ${fmtClock(s.disruption.endMin)}.`);
  }
  if (s.reliefOfflineUntilMin !== null && s.tMin >= s.reliefOfflineUntilMin) {
    s = log({ ...s, reliefOfflineUntilMin: null }, 'info', 'Relief station is back online.');
  }

  // Report passes that closed without being used while they mattered.
  for (const p of s.passes) {
    const i = passIndex(s, p);
    if (p.endMin < s.tMin && p.endMin >= state.tMin && !s.closedPasses.includes(i)) {
      s = { ...s, closedPasses: [...s.closedPasses, i] };
      if (!s.usedPasses.includes(i) && neededSite(s) === p.site && !(p.site === 'relief' && s.reliefOfflineUntilMin !== null)) {
        s = log(s, 'pass_missed', `The ${SITE_NAME[p.site]} pass closed at ${fmtClock(p.endMin)} with no transmission. The message stayed ${s.message === 'AT_COMMUNITY' ? 'with the community' : 'on the satellite'}.`);
      }
    }
  }

  s.activePass = passAt(s.passes, s.tMin, neededSite(s));

  if (s.tMin >= s.deadlineMin) s = lose(s);
  return s;
};

// ---------- transmit ----------

export const NOT_HERE_YET = (nextInMin: number): string =>
  `You're pointing correctly. Your satellite isn't here yet. Next pass in ${fmtMMSS(nextInMin)}.`;

export interface TransmitResult { state: MissionState; ok: boolean; text: string; }

export const transmit = (state: MissionState, design: MissionDesign): TransmitResult => {
  if (state.outcome !== 'running') return { state, ok: false, text: 'The mission is over.' };
  const want = neededSite(state);
  const pass = passAt(state.passes, state.tMin, want);

  if (!pass) {
    const np = nextPass(state, want) ?? nextPass(state);
    const text = np
      ? NOT_HERE_YET(np.startMin - state.tMin)
      : "You're pointing correctly, but no more passes are predicted before the deadline.";
    return { state: log(state, 'info', text), ok: false, text };
  }

  const hop = pass.site === 'community' ? 'uplink' : 'downlink';
  const fail = (s: MissionState, text: string, cls: FailureClass | null): TransmitResult => ({
    state: log(cls ? { ...s, failures: [...s.failures, cls] } : s, `${hop}_fail`, text), ok: false, text,
  });

  if (state.conserve) {
    return fail(state, 'Radio is powered down while Conserve is on. Switch Conserve off to transmit.', null);
  }
  const idx = passIndex(state, pass);
  if (state.usedPasses.includes(idx)) {
    const text = `Already transmitted on this ${SITE_NAME[pass.site]} pass. Wait for the next one.`;
    return { state: log(state, 'info', text), ok: false, text };
  }
  if (state.batteryWh < floorWh(design)) {
    return fail(state, `Battery at ${state.batteryWh.toFixed(1)} Wh, below the ${floorWh(design).toFixed(0)} Wh transmit floor. The radio refused to key. The ${design.transmitter.name} needs charge you no longer have.`, 'energy');
  }

  // Radio keys for the rest of the pass: energy is spent whatever happens next.
  const remaining = Math.max(0.5, pass.endMin - state.tMin);
  const cost = (design.transmitter.txDrawW ?? 0) * (remaining / 60);
  const after = state.batteryWh - cost;
  let s: MissionState = { ...state, usedPasses: [...state.usedPasses, idx], batteryWh: Math.max(0, after) };

  if (after < 0) {
    return fail(s, `Battery ran dry mid-transmission: the ${design.transmitter.name} needed ${cost.toFixed(1)} Wh for this ${remaining.toFixed(0)}-minute pass but only ${state.batteryWh.toFixed(1)} Wh was left.`, 'energy');
  }
  if (want !== pass.site) {
    const why = state.message === 'AT_COMMUNITY'
      ? 'There is nothing to downlink yet: the message is still with the community.'
      : 'The message is already on board, so this community pass had nothing to send.';
    return fail(s, `${why} Keying the radio burned ${cost.toFixed(1)} Wh for nothing.`, 'scheduling');
  }
  const m = linkMargin(design);
  if (m < 0) {
    return fail(s, `Signal ${Math.abs(m).toFixed(1)} dB too weak: a ${design.transmitter.name} radio can't close the link from ${design.orbit.name}. ${cost.toFixed(1)} Wh spent.`, 'link');
  }
  if (pass.site === 'relief' && s.reliefOfflineUntilMin !== null) {
    return fail(s, `Relief station is offline (flooded) until ${fmtClock(s.reliefOfflineUntilMin)}. Nobody was listening; ${cost.toFixed(1)} Wh spent.`, 'disruption');
  }

  if (pass.site === 'community') {
    s = log({ ...s, message: 'ON_SATELLITE', activePass: passAt(s.passes, s.tMin, 'relief') }, 'uplink_ok',
      `Uplink succeeded at ${fmtDb(m)} margin. The message is on board. Cost ${cost.toFixed(1)} Wh.`);
    return { state: s, ok: true, text: 'Uplink succeeded. The message is on board.' };
  }
  s = log({ ...s, message: 'DELIVERED' }, 'downlink_ok',
    `Downlink succeeded at ${fmtDb(m)} margin. The relief station has the message. Cost ${cost.toFixed(1)} Wh.`);
  s = log({ ...s, outcome: 'won', activePass: pass }, 'info', `Message delivered at ${fmtClock(s.tMin)}, ${fmtClock(s.deadlineMin - s.tMin).slice(2)} before the deadline.`);
  return { state: s, ok: true, text: 'Delivered.' };
};

export const setConserve = (s: MissionState, on: boolean): MissionState =>
  s.outcome !== 'running' || s.conserve === on ? s
    : log({ ...s, conserve: on }, 'info', on ? 'Conserve on: idle loads shut down, radio powered off.' : 'Conserve off: radio powered up.');

// ---------- outcome ----------

/** Root cause wins over symptoms: running dry outranks a weak link, the flood, or idle passes. */
const PRIORITY: FailureClass[] = ['energy', 'link', 'disruption', 'scheduling'];
const classify = (s: MissionState): FailureClass => {
  if (s.everBelowFloor) return 'energy';
  return PRIORITY.find((c) => s.failures.includes(c)) ?? 'scheduling';
};

const CLOSING: Record<FailureClass, string> = {
  energy: 'Deadline reached. Failure class: energy. The battery could not cover the transmissions this mission needed.',
  scheduling: 'Deadline reached. Failure class: scheduling. The usable passes went by without the right transmission.',
  link: 'Deadline reached. Failure class: link. The signal was too weak to reach the ground from this orbit.',
  disruption: 'Deadline reached. Failure class: disruption. The flooded relief station blocked delivery and no later pass was used.',
};

const lose = (s: MissionState): MissionState => {
  const failure = classify(s);
  return log({ ...s, outcome: 'lost', failure, activePass: null }, 'info', CLOSING[failure]);
};

/** One plain-language lesson keyed to how the mission ended. */
export const takeaway = (s: MissionState, d: MissionDesign): string => {
  const draw = d.transmitter.txDrawW ?? 0;
  const pass = s.passes[0] ? s.passes[0].endMin - s.passes[0].startMin : 5;
  const perPass = (draw * pass) / 60;
  if (s.outcome === 'won') {
    return `Delivered with a $${d.transmitter.costK + d.battery.costK + d.orbit.costK}k build. The winning move was matching radio, battery and orbit to each other and transmitting only when it counted.`;
  }
  switch (s.failure) {
    case 'energy':
      return `Your ${d.transmitter.name} radio burns about ${perPass.toFixed(0)} Wh every pass, plus ${d.transmitter.standbyW ?? 0} W just sitting idle. Your ${capacity(d)} Wh battery and small solar panels could not keep up. More power was not more mission.`;
    case 'link':
      return `A ${d.transmitter.name} radio from ${d.orbit.name} arrives ${Math.abs(linkMargin(d)).toFixed(1)} dB under what the ground can hear. Fly lower or transmit stronger.`;
    case 'disruption':
      return 'The flood was scripted. The mission that wins keeps enough energy in reserve to use the pass after the station comes back.';
    default:
      return 'The satellite flew over the right places, but the transmissions did not happen on the passes that mattered. Watch the next-pass timer and key the radio only when the message can move.';
  }
};
