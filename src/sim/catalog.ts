import type { ComponentOption, Slot } from './types';

const SRC = 'NASA State-of-the-Art Small Spacecraft Technology report';

export const CATALOG: ComponentOption[] = [
  { id: 'tx2', slot: 'transmitter', name: '2 W UHF', costK: 20, txPowerW: 2, txDrawW: 8, standbyW: 0.2, tradeoff: 'Sips power, needs close passes', source: SRC },
  { id: 'tx10', slot: 'transmitter', name: '10 W UHF', costK: 45, txPowerW: 10, txDrawW: 40, standbyW: 1, tradeoff: 'Balanced', source: SRC },
  { id: 'tx25', slot: 'transmitter', name: '25 W UHF', costK: 80, txPowerW: 25, txDrawW: 125, standbyW: 6, tradeoff: 'Punches through anything, drinks the battery', source: SRC },
  { id: 'bat40', slot: 'battery', name: '40 Wh pack', costK: 15, capacityWh: 40, tradeoff: 'Light and cheap, no reserves', source: SRC },
  { id: 'bat80', slot: 'battery', name: '80 Wh pack', costK: 30, capacityWh: 80, tradeoff: 'Room for one night pass', source: SRC },
  { id: 'bat120', slot: 'battery', name: '120 Wh pack', costK: 50, capacityWh: 120, tradeoff: 'Heavy, survives mistakes', source: SRC },
  { id: 'orb400', slot: 'orbit', name: '400 km LEO', costK: 30, altitudeKm: 400, tradeoff: 'Strong signal, brief windows', source: SRC },
  { id: 'orb600', slot: 'orbit', name: '600 km LEO', costK: 40, altitudeKm: 600, tradeoff: 'Balanced', source: SRC },
  { id: 'orb800', slot: 'orbit', name: '800 km LEO', costK: 55, altitudeKm: 800, tradeoff: 'Long faint passes, weak signal', source: SRC },
];

export const SLOTS: Slot[] = ['transmitter', 'battery', 'orbit'];

export const byId = (id: string): ComponentOption => {
  const c = CATALOG.find((o) => o.id === id);
  if (!c) throw new Error(`Unknown component ${id}`);
  return c;
};

export const totalCostK = (parts: ComponentOption[]): number =>
  parts.reduce((s, p) => s + p.costK, 0);
