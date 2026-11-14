export type MessageState = 'AT_COMMUNITY' | 'ON_SATELLITE' | 'DELIVERED';
export type Screen = 'briefing' | 'workbench' | 'console' | 'receipt';
export type Site = 'community' | 'relief';
export type Slot = 'transmitter' | 'battery' | 'orbit';
export type FailureClass = 'energy' | 'scheduling' | 'link' | 'disruption';

export interface LatLon { lat: number; lon: number; }

export interface ComponentOption {
  id: string;
  slot: Slot;
  name: string;
  costK: number;
  tradeoff: string;
  source: string;
  txPowerW?: number;
  txDrawW?: number;
  standbyW?: number;     // radio standby load added to the bus
  capacityWh?: number;
  altitudeKm?: number;
}

export interface MissionDesign {
  community: LatLon;
  transmitter: ComponentOption;
  battery: ComponentOption;
  orbit: ComponentOption;
}

export interface Pass {
  site: Site;
  startMin: number;
  endMin: number;
  maxElevationDistanceKm: number;
  sunlit: boolean;
}

export type LogKind = 'uplink_ok' | 'uplink_fail' | 'downlink_ok' | 'downlink_fail'
  | 'disruption' | 'battery_empty' | 'pass_missed' | 'info';

export interface LogEvent { tMin: number; kind: LogKind; text: string; }

export interface Scenario {
  community: LatLon;
  relief: LatLon;
  lon0: number;
  phaseMin: number;
  deadlineMin: number;
  passes: Pass[];
  disruption: { startMin: number; endMin: number };
}

export interface MissionState {
  tMin: number;
  deadlineMin: number;
  message: MessageState;
  batteryWh: number;
  conserve: boolean;
  passes: Pass[];
  activePass: Pass | null;
  reliefOfflineUntilMin: number | null;
  log: LogEvent[];
  outcome: 'running' | 'won' | 'lost';
  failure: FailureClass | null;
  disruption: { startMin: number; endMin: number };
  /** Passes already keyed: one transmission session per pass. */
  usedPasses: number[];
  /** Passes we have already reported as missed / closed. */
  closedPasses: number[];
  everBelowFloor: boolean;
  /** Every failure cause seen this mission, used for the loss classification. */
  failures: FailureClass[];
}
