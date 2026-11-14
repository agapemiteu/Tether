import { useEffect, useRef, useState } from 'react';
import logoUrl from '../assets/logo.png';
import { BUDGET_K, SIM_MIN_PER_REAL_SEC } from '../sim/constants';
import { byId, CATALOG, SLOTS, totalCostK } from '../sim/catalog';
import {
  capacity, createMission, fmtClock, fmtMMSS, linkMargin, neededSite, nextPass, setConserve, takeaway, tick, transmit,
} from '../sim/engine';
import { periodMin, subSatellite } from '../sim/orbit';
import { buildScenario, checkCommunity, reliefFor, SCENARIO_LABEL } from '../sim/scenario';
import type { ComponentOption, LatLon, MissionDesign, MissionState, Scenario, Screen, Slot } from '../sim/types';

const BASEMAP = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg';

function MapCanvas({ community, relief, onPick, scenario, design, state }: {
  community: LatLon | null; relief: LatLon | null; onPick?: (p: LatLon) => void;
  scenario?: Scenario; design?: MissionDesign; state?: MissionState;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [, setLoaded] = useState(0);
  useEffect(() => {
    const i = new Image(); i.crossOrigin = 'anonymous'; i.src = BASEMAP;
    i.onload = () => { img.current = i; setLoaded((n) => n + 1); };
  }, []);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const g = c.getContext('2d')!; const W = c.width, H = c.height;
    const xy = (p: LatLon) => [((p.lon + 180) / 360) * W, ((90 - p.lat) / 180) * H];
    g.fillStyle = '#C9D6E8'; g.fillRect(0, 0, W, H);
    if (img.current) g.drawImage(img.current, 0, 0, W, H);
    else {
      // Fallback when the NASA basemap can't load: a labelled lat/lon grid keeps the map readable.
      g.strokeStyle = 'rgba(12,0,120,.15)'; g.lineWidth = 1;
      for (let lon = -180; lon <= 180; lon += 30) { const [x] = xy({ lat: 0, lon }); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let lat = -60; lat <= 60; lat += 30) { const [, y] = xy({ lat, lon: 0 }); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.fillStyle = 'rgba(12,0,120,.45)'; g.font = '12px DM Sans, sans-serif'; g.fillText('Equator', 6, H / 2 - 4);
    }
    if (scenario && design && state) {
      for (let t = 0; t <= state.deadlineMin; t += 1) {
        const [x, y] = xy(subSatellite(t, design.orbit.altitudeKm!, scenario.lon0, scenario.phaseMin));
        const past = t <= state.tMin;
        g.fillStyle = past ? '#0C0078' : 'rgba(12,0,120,0.3)';
        g.fillRect(x - 1, y - 1, past ? 3 : 2, past ? 3 : 2);
      }
      const [sx, sy] = xy(subSatellite(state.tMin, design.orbit.altitudeKm!, scenario.lon0, scenario.phaseMin));
      g.fillStyle = '#fff'; g.strokeStyle = '#0C0078'; g.lineWidth = 3; g.beginPath(); g.arc(sx, sy, 8, 0, 7); g.fill(); g.stroke();
    }
    const mark = (p: LatLon | null, col: string, label: string, dy: number) => {
      if (!p) return; const [x, y] = xy(p);
      g.fillStyle = col; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); g.stroke();
      g.font = '700 15px DM Sans, sans-serif'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = 'rgba(16,26,45,.85)';
      g.strokeText(label, x, y + dy); g.fillStyle = '#fff'; g.fillText(label, x, y + dy); g.textAlign = 'left';
    };
    // Labels go above / below so the two nearby sites never overlap.
    mark(community, '#0C0078', 'Community', -14);
    mark(relief, state?.reliefOfflineUntilMin != null ? '#D62F32' : '#1E9E5A', state?.reliefOfflineUntilMin != null ? 'Relief (flooded)' : 'Relief station', 26);
  });
  return (
    <canvas ref={ref} width={1024} height={512} className="map" style={{ cursor: onPick ? 'crosshair' : 'default' }}
      onClick={(e) => {
        if (!onPick) return; const r = e.currentTarget.getBoundingClientRect();
        onPick({ lat: 90 - ((e.clientY - r.top) / r.height) * 180, lon: ((e.clientX - r.left) / r.width) * 360 - 180 });
      }} />
  );
}


/** Live view of the spacecraft the player is building or flying. */
function SatPanel({ parts, state }: { parts: ComponentOption[]; state?: MissionState }) {
  const [tx, bat, orb] = parts;
  const d = { community: { lat: 0, lon: 0 }, transmitter: tx, battery: bat, orbit: orb };
  const m = linkMargin(d);
  const pct = state ? state.batteryWh / (bat.capacityWh ?? 1) : 1;
  const antenna = 18 + (tx.txPowerW ?? 2) * 2.2;
  const cells = (bat.capacityWh ?? 40) / 40;
  const ringR = 70 + ((orb.altitudeKm ?? 400) - 400) / 10;
  return (
    <aside className="sat">
      <h3>Your satellite</h3>
      <svg viewBox="0 0 260 220" role="img" aria-label={`Satellite with ${tx.name}, ${bat.name}, ${orb.name}`}>
        <circle cx="130" cy="235" r={ringR + 80} fill="#C9E8F7" />
        <circle cx="130" cy="235" r={ringR + 120} fill="none" stroke="#0C0078" strokeDasharray="4 6" />
        <text x="130" y="18" textAnchor="middle" fontSize="11" fill="#4A5568">orbit {orb.altitudeKm} km</text>
        <rect x="18" y="78" width="62" height="34" fill="#0C0078" rx="3" />
        <rect x="180" y="78" width="62" height="34" fill="#0C0078" rx="3" />
        <line x1="80" y1="95" x2="100" y2="95" stroke="#101A2D" strokeWidth="3" />
        <line x1="160" y1="95" x2="180" y2="95" stroke="#101A2D" strokeWidth="3" />
        <rect x="100" y="65" width="60" height="60" rx="6" fill="#fff" stroke="#101A2D" strokeWidth="3" />
        {Array.from({ length: cells }).map((_, i) => (
          <rect key={i} x={108 + i * 15} y="98" width="12" height="20" rx="2" fill={pct < 0.1 ? '#D62F32' : '#1E9E5A'} opacity={i < Math.ceil(pct * cells) ? 1 : 0.25} />
        ))}
        <line x1="130" y1="65" x2="130" y2={65 - antenna} stroke="#D62F32" strokeWidth="3" />
        <circle cx="130" cy={65 - antenna} r="4" fill="#D62F32" />
        <text x="30" y="128" fontSize="10" fill="#4A5568">solar 7 W</text>
      </svg>
      <dl>
        <dt>Radio</dt><dd>{tx.name} · draws {tx.txDrawW} W transmitting, {tx.standbyW} W idle</dd>
        <dt>Battery</dt><dd>{bat.name}{state ? ` · ${state.batteryWh.toFixed(1)} Wh now` : ''} · floor {((bat.capacityWh ?? 0) * 0.1).toFixed(0)} Wh</dd>
        <dt>Orbit</dt><dd>{orb.name} · {periodMin(orb.altitudeKm ?? 400).toFixed(0)} min per lap</dd>
        <dt>Signal</dt><dd className={m < 0 ? 'err' : 'ok'}>{m >= 0 ? '+' : ''}{m.toFixed(1)} dB {m < 0 ? '· too weak, will not reach the ground' : '· reaches the ground'}</dd>
        <dt>Per pass</dt><dd>~{(((tx.txDrawW ?? 0) * 6) / 60).toFixed(1)} Wh for a 6-min transmission</dd>
      </dl>
    </aside>
  );
}

const CITIES = [
  { name: 'Lagos', lat: 6.5, lon: 3.4 }, { name: 'Houston', lat: 29.8, lon: -95.4 },
  { name: 'Dhaka', lat: 23.8, lon: 90.4 }, { name: 'Manila', lat: 14.6, lon: 121 },
  { name: 'São Paulo', lat: -23.5, lon: -46.6 }, { name: 'London', lat: 51.5, lon: -0.1 },
];

const Logo = () => <img className="logo" src={logoUrl} alt="tether" />;

export default function App() {
  const [screen, setScreen] = useState<Screen>('briefing');
  const [community, setCommunity] = useState<LatLon | null>(null);
  const [pick, setPick] = useState<Record<Slot, string>>({ transmitter: 'tx10', battery: 'bat80', orbit: 'orb600' });
  const [design, setDesign] = useState<MissionDesign | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [state, setState] = useState<MissionState | null>(null);
  const [running, setRunning] = useState(true);
  const [toast, setToast] = useState<{ ok: boolean; title: string; text: string } | null>(null);
  const [message, setMessage] = useState('Flood has cut us off. 40 people, 3 injured. Need boats and medical supplies.');
  const [error, setError] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const acc = useRef(0);

  const loc = community ? checkCommunity(community) : null;
  const parts = SLOTS.map((s) => byId(pick[s]));
  const cost = totalCostK(parts);

  // Sim loop: 1 real second = 2 sim minutes, ticked in whole minutes.
  useEffect(() => {
    if (screen !== 'console' || !running || !design || state?.outcome !== 'running') return;
    let last = performance.now(); let raf = 0;
    const loop = (now: number) => {
      acc.current += ((now - last) / 1000) * SIM_MIN_PER_REAL_SEC; last = now;
      if (acc.current >= 1) {
        const n = Math.floor(acc.current); acc.current -= n;
        setState((s) => { let x = s!; for (let i = 0; i < n; i++) x = tick(x, design, 1); return x; });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [screen, running, design, state?.outcome]);

  useEffect(() => {
    if (state && state.outcome !== 'running' && screen === 'console') {
      const t = setTimeout(() => setScreen("receipt"), 3500); return () => clearTimeout(t);
    }
  }, [state?.outcome, screen]);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3800); return () => clearTimeout(t); } }, [toast]);

  const launch = () => {
    if (!community) return;
    const d: MissionDesign = { community, transmitter: parts[0], battery: parts[1], orbit: parts[2] };
    const sc = buildScenario(community, d.orbit.altitudeKm!);
    if (!sc) { setError('No playable pass schedule exists for this location with this orbit. Try another orbit or location.'); return; }
    setError(null); setDesign(d); setScenario(sc); setState(createMission(d, sc)); acc.current = 0; setRunning(false); setScreen('console');
  };

  const doTransmit = () => {
    if (!state || !design) return;
    const r = transmit(state, design);
    setState(r.state);
    const title = !r.ok ? 'Transmission failed' : r.state.message === 'DELIVERED' ? 'Message delivered' : 'Uplink received: message on board';
    setToast({ ok: r.ok, title, text: r.text });
  };

  const finish = (to: Screen) => {
    if (state && design) setHistory((h) => [...h, `${design.transmitter.name} + ${design.battery.name} + ${design.orbit.name}: ${state.outcome === 'won' ? 'delivered' : `lost (${state.failure})`}`]);
    setScreen(to);
  };

  return (
    <div className="app">
      <header><Logo /><button className="ghost" onClick={() => setAbout(true)}>About</button></header>

      {screen === 'briefing' && (
        <main>
          <ol className="steps"><li className="on">1 · Choose a place</li><li>2 · Build</li><li>3 · Fly</li><li>4 · Debrief</li></ol>
          <h1>Get one message out.</h1>
          <p className="lede">A flood has cut a community off. You’ll build a small satellite and fly it to carry their emergency message to a relief station before the deadline.</p>
          <p><b>Step 1: pick a city, or tap anywhere on the map.</b></p>
          <div className="row cities">{CITIES.map((c) => (
            <button key={c.name} className={`ghost ${community?.lat === c.lat && community?.lon === c.lon ? 'picked' : ''}`} onClick={() => setCommunity({ lat: c.lat, lon: c.lon })}>{c.name}</button>
          ))}</div>
          <MapCanvas community={community} relief={community && loc?.ok ? reliefFor(community) : null} onPick={setCommunity} />
          <div className="card">
            <span className="tag">{SCENARIO_LABEL}</span>
            {community && !loc?.ok && <p className="err">{(loc as { reason: string }).reason}</p>}
            {community && loc?.ok && <p>Community at {community.lat.toFixed(1)}°, {community.lon.toFixed(1)}°. Relief station about 1,500 km east. The message hops twice: community → satellite → relief station.</p>}
            <label className="msg-label" htmlFor="msg">Their emergency message</label>
            <textarea id="msg" className="msg-input" maxLength={160} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type the message the community needs to send" />
            <small className="muted">{message.trim().length}/160 characters</small>
            {!message.trim() && <p className="err">Type a message before you build. That's what you're delivering.</p>}
            <button disabled={!community || !loc?.ok || !message.trim()} onClick={() => setScreen('workbench')}>Build your mission</button>
          </div>
        </main>
      )}

      {screen === 'workbench' && (
        <main>
          <ol className="steps"><li>1 · Place ✓</li><li className="on">2 · Build</li><li>3 · Fly</li><li>4 · Debrief</li></ol>
          <h1>Build your satellite</h1>
          <p className="lede">Choose one part per group on the right. Your satellite updates as you pick. The priciest parts are not always the best mission.</p>
          <div className="split build"><SatPanel parts={parts} /><div className="materials">
          {SLOTS.map((slot) => (
            <section key={slot}><h3>{slot}</h3><div className="row">
              {CATALOG.filter((c) => c.slot === slot).map((c) => (
                <button key={c.id} className={`opt ${pick[slot] === c.id ? 'sel' : ''}`} onClick={() => setPick({ ...pick, [slot]: c.id })}>
                  <b>{c.name}</b><span className="cost">${c.costK}k</span>
                  <small>{c.txPowerW ? `${c.txPowerW} W RF · ${c.txDrawW} W draw` : c.capacityWh ? `${c.capacityWh} Wh` : `${c.altitudeKm} km altitude`}</small>
                  <em>{c.tradeoff}</em>
                </button>))}
            </div></section>))}
          <p className="src">Ranges: {CATALOG[0].source}</p>
          </div></div>
          <footer className="sticky">
            <div className="bar"><div style={{ width: `${Math.min(100, (cost / BUDGET_K) * 100)}%`, background: cost > BUDGET_K ? 'var(--danger)' : 'var(--accent)' }} /></div>
            <span>${cost}k of ${BUDGET_K}k {cost > BUDGET_K ? `· over budget by $${cost - BUDGET_K}k, drop something to launch` : `· $${BUDGET_K - cost}k left`}</span>
            <span className="muted">Link margin: {linkMargin({ community: community!, transmitter: parts[0], battery: parts[1], orbit: parts[2] }).toFixed(1)} dB</span>
            {error && <span className="err">{error}</span>}
            <button disabled={cost > BUDGET_K} onClick={launch}>Launch</button>
          </footer>
        </main>
      )}

      {screen === 'console' && state && design && scenario && (() => {
        const want = neededSite(state); const np = nextPass(state, want);
        const pct = (state.batteryWh / capacity(design)) * 100;
        return (
          <main className={state.conserve ? 'dim' : ''}>
            <div className="top">
              <b>{fmtClock(state.tMin)}</b>
              <span>Deadline in {fmtClock(state.deadlineMin - state.tMin).slice(2)}</span>
              <span className="batt"><span className="bar"><div style={{ width: `${pct}%`, background: pct < 10 ? 'var(--danger)' : 'var(--accent)' }} /></span>{pct.toFixed(0)}%</span>
              <span className="chip">{state.message.replace('_', ' ')}</span>
              <button className="ghost" onClick={() => setRunning(!running)}>{running ? 'Pause' : (state.tMin === 0 ? '▶ Start mission' : 'Play')}</button>
            </div>
            {state.outcome !== 'running' && <div className={`result ${state.outcome}`}>{state.outcome === 'won' ? `✓ Message delivered at ${fmtClock(state.tMin)}. Opening your debrief…` : '✗ The message never made it. Opening your debrief…'}</div>}
            <div className={`status ${state.log[state.log.length - 1].kind}`}><b>{fmtClock(state.log[state.log.length - 1].tMin)}</b> {state.log[state.log.length - 1].text}</div>
            {state.reliefOfflineUntilMin != null && <div className="banner">Relief station flooded. Back online at {fmtClock(state.reliefOfflineUntilMin)}.</div>}
            <div className="split fly"><div>
            <MapCanvas community={scenario.community} relief={scenario.relief} scenario={scenario} design={design} state={state} />
            <div className="card ctl">
              {state.activePass
                ? <div><b>Satellite over the {state.activePass.site === 'community' ? 'community' : 'relief station'}</b> · closes in {fmtMMSS(state.activePass.endMin - state.tMin)} · margin {linkMargin(design).toFixed(1)} dB {state.activePass.sunlit ? '· sunlit' : '· in eclipse'}</div>
                : <div className="muted">{np ? `Next pass: ${np.site === 'community' ? 'community' : 'relief station'} in ${fmtMMSS(np.startMin - state.tMin)}` : 'No more useful passes before the deadline.'}</div>}
              <button className="tx" onClick={doTransmit}>TRANSMIT</button>
              <button className="ghost" onClick={() => setState(setConserve(state, !state.conserve))}>{state.conserve ? 'Conserve: ON' : 'Conserve: off'}</button>
            </div>
            {toast && (
              <div className={`tx-overlay ${toast.ok ? 'ok' : 'fail'}`} role="alert" onClick={() => setToast(null)}>
                <div className="tx-card">
                  <div className="tx-icon">{toast.ok ? '✓' : '✗'}</div>
                  <div className="beam"><span className="dot" /></div>
                  <h3>{toast.title}</h3>
                  {toast.ok && <blockquote>“{message}”</blockquote>}
                  <p>{toast.text}</p>
                </div>
              </div>
            )}
            <div className={`msg-card ${state.message.toLowerCase()}`}>
              <span className="msg-stage">{state.message === 'AT_COMMUNITY' ? '1/3 · Waiting at the community' : state.message === 'ON_SATELLITE' ? '2/3 · On board the satellite' : '3/3 · Delivered to the relief station'}</span>
              <span className="msg-text">“{message}”</span>
              <span className="msg-track"><i className="on" /><i className={state.message !== 'AT_COMMUNITY' ? 'on' : ''} /><i className={state.message === 'DELIVERED' ? 'on' : ''} /></span>
            </div>
            </div><SatPanel parts={[design.transmitter, design.battery, design.orbit]} state={state} /></div>
            <ol className="log">{[...state.log].reverse().slice(0, 6).map((e, i) => <li key={i} className={e.kind}><b>{fmtClock(e.tMin)}</b> {e.text}</li>)}</ol>
          </main>
        );
      })()}

      {screen === 'receipt' && state && design && (
        <main>
          <h1 className={state.outcome === 'won' ? 'ok' : 'err'}>{state.outcome === 'won' ? `Message delivered at ${fmtClock(state.tMin)}` : 'The message never made it'}</h1>
          <blockquote className={`final-msg ${state.outcome}`}>“{message}”<small>{state.outcome === 'won' ? 'Received by the relief station' : state.message === 'ON_SATELLITE' ? 'Stuck on the satellite' : 'Never left the community'}</small></blockquote>
          <p className="lede">{takeaway(state, design)}</p>
          <ol className="log full">{state.log.map((e, i) => <li key={i} className={e.kind}><b>{fmtClock(e.tMin)}</b> {e.text}</li>)}</ol>
          {history.length > 0 && <div className="card"><b>Earlier runs</b><ul>{history.map((h, i) => <li key={i}>{h}</li>)}</ul></div>}
          <div className="row"><button onClick={() => finish('workbench')}>Redesign mission</button><button className="ghost" onClick={() => { finish('briefing'); setCommunity(null); }}>New location</button></div>
        </main>
      )}

      {about && (
        <div className="modal" onClick={() => setAbout(false)}><div className="card" onClick={(e) => e.stopPropagation()}>
          <h3>About Tether</h3>
          <p>Tether teaches that engineering decisions interact: a stronger radio drains a battery faster, a higher orbit gives longer but fainter passes, and a satellite can only talk when it is overhead. The most expensive build is not the best mission. The physics (orbital period, footprint, free-space path loss, energy budget) are simplified but real.</p>
          <p className="muted">AI disclosure: built with assistance from AI coding tools; all mechanics were reviewed and tested by the team.</p>
          <button onClick={() => setAbout(false)}>Close</button>
        </div></div>
      )}

      <footer className="credits">Basemap: NASA Blue Marble. Component data ranges informed by NASA's State-of-the-Art Small Spacecraft Technology report. Scenario is fictional.</footer>
    </div>
  );
}
