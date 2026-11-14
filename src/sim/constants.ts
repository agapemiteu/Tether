// All physics constants and tuning values live here.
export const MU = 398600.4418; // km^3/s^2
export const R_EARTH = 6371; // km
export const DEADLINE_MIN = 600;
/** Hard cap when the window must stretch for low-latitude geometry. */
export const MAX_DEADLINE_MIN = 1440;
export const DT_MIN = 1;
export const SIM_MIN_PER_REAL_SEC = 2;

export const INCLINATION_DEG = 51.6;
export const EARTH_ROT_DEG_PER_MIN = 0.25;
export const ELEVATION_MASK_DEG = 10;
/** Communities poleward of this cannot be served reliably by a 51.6 deg orbit. */
export const MAX_COMMUNITY_LAT = 55;
export const RELIEF_LON_OFFSET_DEG = 13;

export const IDLE_LOAD_W = 5;
/** Tuned (PRD s9) so a 25 W radio cannot be sustained by a 40 Wh pack. Net +2 W in sun, -5 W in eclipse: idle time is not free, which is what CONSERVE is for. */
export const SOLAR_W = 7;
export const SUNLIT_FRACTION = 0.6;
export const TX_FLOOR_FRACTION = 0.1;

export const FREQ_MHZ = 437;
export const G_GROUND_DBI = 12;
export const G_SAT_DBI = 0;
/** Ground receiver sensitivity (dBm). Tuned so the 2 W radio closes only from 400 km. */
export const THRESHOLD_DBM = -104;

export const BUDGET_K = 150;
export const MIN_PASSES_PER_SITE = 3;
