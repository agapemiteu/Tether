import { FREQ_MHZ, G_GROUND_DBI, G_SAT_DBI, THRESHOLD_DBM } from './constants';

export const fsplDb = (dKm: number, fMHz = FREQ_MHZ): number =>
  32.45 + 20 * Math.log10(dKm) + 20 * Math.log10(fMHz);

/** Received power above receiver sensitivity, in dB. >= 0 closes the link. */
export const marginDb = (txPowerW: number, dKm: number): number =>
  10 * Math.log10(txPowerW) + 30 + G_GROUND_DBI + G_SAT_DBI - fsplDb(dKm) - THRESHOLD_DBM;
