import { useEffect, useRef, useState } from 'react';
import logoUrl from '../assets/logo.png';
import { BUDGET_K, SIM_MIN_PER_REAL_SEC } from '../sim/constants';
import { byId, CATALOG, SLOTS, totalCostK } from '../sim/catalog';
import {
  capacity, createMission, fmtClock, fmtMMSS, linkMargin, neededSite, nextPass, setConserve, takeaway, tick, transmit,
} from '../sim/engine';
import { footprintRadiusKm, subSatellite } from '../sim/orbit';
import { buildScenario, checkCommunity, reliefFor, SCENARIO_LABEL } from '../sim/scenario';
import type { ComponentOption, LatLon, MissionDesign, MissionState, Scenario, Screen, Site, Slot } from '../sim/types';

const BASEMAP = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg';

/** Designer icons (Canva kit), tinted with CSS masks. */
type IconName = 'tower' | 'dish' | 'battery' | 'check' | 'envelope';
const Icon = ({ name, className = '' }: { name: IconName; className?: string }) => (
  <span className={`ic ${className}`} style={{ ['--src' as string]: `url(/demo/icons/${name}.png)` }} aria-hidden="true" />
);

const SLOT_UI: Record<Slot, { title: string; icon: IconName; stat: (c: ComponentOption) => string }> = {
  transmitter: { title: 'Radio', icon: 'tower', stat: (c) => `${c.txPowerW} W` },
  battery: { title: 'Battery', icon: 'battery', stat: (c) => `${c.capacityWh} Wh` },
  orbit: { title: 'Orbit height', icon: 'dish', stat: (c) => `${c.altitudeKm} km` },
};

const CITIES = [
  { name: 'Lagos', lat: 6.5, lon: 3.4 }, { name: 'Houston', lat: 29.8, lon: -95.4 },
  { name: 'Dhaka', lat: 23.8, lon: 90.4 }, { name: 'Manila', lat: 14.6, lon: 121 },
  { name: 'São Paulo', lat: -23.5, lon: -46.6 }, { name: 'London', lat: 51.5, lon: -0.1 },
];

interface Beam { ok: boolean; site: Site; at: number }
interface Flash { tone: 'ok' | 'fail' | 'info'; title: string; text: string; id: number }

// ---------------------------------------------------------------- map

function MapCanvas({ community, relief, onPick, scenario, design, state, beam }: {
  community: LatLon | null; relief: LatLon | null; onPick?: (p: LatLon) => void;
  scenario?: Scenario; design?: MissionDesign; state?: MissionState; beam?: Beam | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const i = new Image(); i.crossOrigin = 'anonymous'; i.src = BASEMAP;
    i.onload = () => { img.current = i; setFrame((n) => n + 1); };
  }, []);
  // Animate while a beam or pass pulse is visible.
  const animating = !!beam && performance.now() - beam.at < 2600 || !!state?.activePass;
  useEffect(() => {
    if (!animating) return;
    const id = requestAnimationFrame(() => setFrame((n) => n + 1));
    return () => cancelAnimationFrame(id);
  }, [animating, frame]);

  useEffect(() => {
    const c = ref.current; if (!c) return;
    const g = c.getContext('2d')!; const W = c.width, H = c.height;
    const xy = (p: LatLon): [number, number] => [((p.lon + 180) / 360) * W, ((90 - p.lat) / 180) * H];
    const now = performance.now();
    g.fillStyle = '#BFD3EA'; g.fillRect(0, 0, W, H);
    if (img.current) g.drawImage(img.current, 0, 0, W, H);
    else {
      g.strokeStyle = 'rgba(12,0,120,.12)'; g.lineWidth = 1;
      for (let lon = -180; lon <= 180; lon += 30) { const [x] = xy({ lat: 0, lon }); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let lat = -60; lat <= 60; lat += 30) { const [, y] = xy({ lat, lon: 0 }); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    }
    let sat: [number, number] | null = null;
    if (scenario && design && state) {
      const alt = design.orbit.altitudeKm!;
      for (let t = 0; t <= state.deadlineMin; t += 1) {
        const [x, y] = xy(subSatellite(t, alt, scenario.lon0, scenario.phaseMin));
        g.fillStyle = t <= state.tMin ? 'rgba(12,0,120,.9)' : 'rgba(12,0,120,.22)';
        g.fillRect(x - 1, y - 1, 2.5, 2.5);
      }
      sat = xy(subSatellite(state.tMin, alt, scenario.lon0, scenario.phaseMin));
      // Coverage circle: the area that can hear the satellite right now.
      const rPx = (footprintRadiusKm(alt) / 111) * (W / 360);
      g.fillStyle = state.activePass ? 'rgba(30,158,90,.18)' : 'rgba(89,212,248,.16)';
      g.strokeStyle = state.activePass ? 'rgba(30,158,90,.9)' : 'rgba(12,0,120,.45)';
      g.lineWidth = 2; g.setLineDash([6, 5]);
      g.beginPath(); g.arc(sat[0], sat[1], rPx, 0, 7); g.fill(); g.stroke(); g.setLineDash([]);
    }
    const sites: Record<Site, LatLon | null> = { community, relief };
    // Live transmission beam: green when it lands, red when it fails.
    if (beam && sat && sites[beam.site] && now - beam.at < 2600) {
      const [x, y] = xy(sites[beam.site]!);
      const k = Math.min(1, (now - beam.at) / 700);
      const ex = x + (sat[0] - x) * (beam.ok ? k : Math.min(k, 0.55));
      const ey = y + (sat[1] - y) * (beam.ok ? k : Math.min(k, 0.55));
      g.strokeStyle = beam.ok ? '#1E9E5A' : '#EA373A'; g.lineWidth = 5; g.lineCap = 'round';
      g.setLineDash([12, 8]); g.lineDashOffset = -now / 25;
      g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
      if (!beam.ok && k >= 0.55) {
        g.lineWidth = 4; g.beginPath(); g.moveTo(ex - 9, ey - 9); g.lineTo(ex + 9, ey + 9); g.moveTo(ex + 9, ey - 9); g.lineTo(ex - 9, ey + 9); g.stroke();
      }
    }
    const pass = state?.activePass;
    const mark = (site: Site, col: string, label: string, dy: number) => {
      const p = sites[site]; if (!p) return; const [x, y] = xy(p);
      if (pass?.site === site) {
        const r = 12 + ((now / 18) % 22);
        g.strokeStyle = `rgba(30,158,90,${1 - (r - 12) / 22})`; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
      }
      g.fillStyle = col; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); g.stroke();
      g.font = '700 16px DM Sans, sans-serif'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = 'rgba(16,26,45,.85)';
      g.strokeText(label, x, y + dy); g.fillStyle = '#fff'; g.fillText(label, x, y + dy); g.textAlign = 'left';
    };
    mark('community', '#0C0078', 'Your town', -16);
    const flooded = state?.reliefOfflineUntilMin != null;
    mark('relief', flooded ? '#EA373A' : '#1E9E5A', flooded ? 'Relief (flooded!)' : 'Relief station', 30);
    if (sat) {
      g.fillStyle = '#fff'; g.strokeStyle = '#0C0078'; g.lineWidth = 3;
      g.fillRect(sat[0] - 18, sat[1] - 4, 10, 8); g.fillRect(sat[0] + 8, sat[1] - 4, 10, 8);
      g.strokeRect(sat[0] - 18, sat[1] - 4, 10, 8); g.strokeRect(sat[0] + 8, sat[1] - 4, 10, 8);
      g.beginPath(); g.arc(sat[0], sat[1], 7, 0, 7); g.fill(); g.stroke();
    }
  });
  return (
    <canvas ref={ref} width={1024} height={512} className="map" style={{ cursor: onPick ? 'crosshair' : 'default' }}
      aria-label="World map"
      onClick={(e) => {
        if (!onPick) return; const r = e.currentTarget.getBoundingClientRect();
        onPick({ lat: 90 - ((e.clientY - r.top) / r.height) * 180, lon: ((e.clientX - r.left) / r.width) * 360 - 180 });
      }} />
  );
}

// ---------------------------------------------------------------- satellite drawing

function Satellite({ parts, charge = 1 }: { parts: ComponentOption[]; charge?: number }) {
  const [tx, bat, orb] = parts;
  const antenna = 16 + (tx.txPowerW ?? 2) * 2;
  const cells = (bat.capacityWh ?? 40) / 40;
  const lift = ((orb.altitudeKm ?? 400) - 400) / 400; // 0..1
  const y = 120 - lift * 50;
  return (
    <svg className="satsvg" viewBox="0 0 320 240" role="img" aria-label={`Satellite: ${tx.name}, ${bat.name}, ${orb.name}`}>
      <ellipse cx="160" cy="300" rx="260" ry="110" fill="#C9E8F7" />
      <text x="160" y="232" textAnchor="middle" fontSize="12" fill="#5B6478">Earth</text>
      <line x1="160" y1={y + 30} x2="160" y2="200" stroke="#0C0078" strokeDasharray="3 5" />
      <text x="168" y={(y + 30 + 200) / 2} fontSize="12" fill="#0C0078">{orb.altitudeKm} km</text>
      <g transform={`translate(0 ${y - 120})`} className="sat-float">
        <rect x="40" y="100" width="70" height="36" rx="4" fill="#0C0078" />
        <rect x="210" y="100" width="70" height="36" rx="4" fill="#0C0078" />
        {[0, 1, 2].map((i) => <line key={i} x1={40 + 23 * (i + 1)} y1="100" x2={40 + 23 * (i + 1)} y2="136" stroke="#59D4F8" strokeWidth="1.5" />)}
        {[0, 1, 2].map((i) => <line key={`r${i}`} x1={210 + 23 * (i + 1)} y1="100" x2={210 + 23 * (i + 1)} y2="136" stroke="#59D4F8" strokeWidth="1.5" />)}
        <line x1="110" y1="118" x2="125" y2="118" stroke="#101A2D" strokeWidth="4" />
        <line x1="195" y1="118" x2="210" y2="118" stroke="#101A2D" strokeWidth="4" />
        <rect x="125" y="86" width="70" height="64" rx="10" fill="#fff" stroke="#101A2D" strokeWidth="4" />
        {Array.from({ length: cells }).map((_, i) => (
          <rect key={i} x={137 + i * 17} y="112" width="13" height="26" rx="3"
            fill={charge < 0.1 ? '#EA373A' : '#1E9E5A'} opacity={i < Math.ceil(charge * cells) ? 1 : 0.2} />
        ))}
        <line x1="160" y1="86" x2="160" y2={86 - antenna} stroke="#EA373A" strokeWidth="4" strokeLinecap="round" />
        <circle cx="160" cy={86 - antenna} r="6" fill="#EA373A" />
      </g>
    </svg>
  );
}

const Meter = ({ label, value, tone, note }: { label: string; value: number; tone: 'ok' | 'warn' | 'bad'; note: string }) => (
  <div className="meter">
    <div className="meter-top"><b>{label}</b><span className={tone}>{note}</span></div>
    <div className="meter-bar"><i className={tone} style={{ width: `${Math.max(4, Math.min(100, value * 100))}%` }} /></div>
  </div>
);

/** Kid-readable wait: "8h 27m" or "12:30". */
const wait = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m` : fmtMMSS(min));

const Logo = () => <img className="logo" src={logoUrl} alt="tether" />;

const Steps = ({ at }: { at: number }) => (
  <ol className="steps" aria-label="Progress">
    {['Place', 'Build', 'Fly', 'Debrief'].map((s, i) => <li key={s} className={i === at ? 'on' : i < at ? 'done' : ''}>{i < at ? '✓' : i + 1} {s}</li>)}
  </ol>
);

// ---------------------------------------------------------------- app

export default function App() {
  const [screen, setScreen] = useState<Screen>('briefing');
  const [community, setCommunity] = useState<LatLon | null>(null);
  const [pick, setPick] = useState<Record<Slot, string>>({ transmitter: 'tx10', battery: 'bat80', orbit: 'orb600' });
  const [design, setDesign] = useState<MissionDesign | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [state, setState] = useState<MissionState | null>(null);
  const [running, setRunning] = useState(false);
  const [fast, setFast] = useState(false);
  const [slow, setSlow] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [beam, setBeam] = useState<Beam | null>(null);
  const [message, setMessage] = useState('Flood has cut us off. 40 people, 3 injured. Send boats and medicine.');
  const [error, setError] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const acc = useRef(0);
  const seenLog = useRef(0);
  const wasInPass = useRef(false);

  const loc = community ? checkCommunity(community) : null;
  const parts = SLOTS.map((s) => byId(pick[s]));
  const cost = totalCostK(parts);
  const say = (tone: Flash['tone'], title: string, text: string) => setFlash({ tone, title, text, id: Date.now() });

  // Sim loop: 1 real second = 2 sim minutes.
  useEffect(() => {
    if (screen !== 'console' || !running || !design || state?.outcome !== 'running') return;
    let last = performance.now(); let raf = 0;
    const loop = (now: number) => {
      acc.current += ((now - last) / 1000) * SIM_MIN_PER_REAL_SEC * (fast ? 10 : slow ? 0.25 : 1); last = now;
      if (acc.current >= 1) {
        const n = Math.floor(acc.current); acc.current -= n;
        setState((s) => { let x = s!; for (let i = 0; i < n; i++) x = tick(x, design, 1); return x; });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [screen, running, design, state?.outcome, fast, slow]);

  // Real-time events: pass opens, pass missed, flood, battery low.
  useEffect(() => {
    if (!state || screen !== 'console') return;
    const inPass = !!state.activePass;
    const flooded = state.activePass?.site === 'relief' && state.reliefOfflineUntilMin !== null;
    if (inPass && !wasInPass.current && neededSite(state) === state.activePass!.site && !flooded) {
      setFast(false); setSlow(true);
      say('info', state.activePass!.site === 'community' ? 'Satellite over your town!' : 'Satellite over the relief station!', 'Tap TRANSMIT now.');
    }
    if (!inPass && wasInPass.current) setSlow(false);
    wasInPass.current = inPass;
    const fresh = state.log.slice(seenLog.current); seenLog.current = state.log.length;
    for (const e of fresh) {
      if (e.kind === 'pass_missed') say('fail', 'Pass missed!', 'The satellite flew by and nothing was sent.');
      if (e.kind === 'disruption') say('fail', 'Relief station flooded!', e.text);
      if (e.kind === 'battery_empty') say('fail', 'Battery too low!', 'The radio is locked until the sun recharges it.');
    }
  }, [state, screen]);

  useEffect(() => {
    if (state && state.outcome !== 'running' && screen === 'console') {
      const t = setTimeout(() => setScreen('receipt'), 3200); return () => clearTimeout(t);
    }
  }, [state?.outcome, screen]);

  useEffect(() => { if (flash) { const t = setTimeout(() => setFlash(null), 3600); return () => clearTimeout(t); } }, [flash]);

  const launch = () => {
    if (!community) return;
    const d: MissionDesign = { community, transmitter: parts[0], battery: parts[1], orbit: parts[2] };
    const sc = buildScenario(community, d.orbit.altitudeKm!);
    if (!sc) { setError('No usable passes here with this orbit. Try another orbit or place.'); return; }
    const s0 = createMission(d, sc);
    seenLog.current = s0.log.length; wasInPass.current = false;
    setError(null); setDesign(d); setScenario(sc); setState(s0); setBeam(null); setFlash(null);
    acc.current = 0; setRunning(false); setScreen('console');
  };

  const doTransmit = () => {
    if (!state || !design) return;
    const r = transmit(state, design);
    seenLog.current = r.state.log.length;
    setState(r.state);
    if (state.activePass) setBeam({ ok: r.ok, site: state.activePass.site, at: performance.now() });
    if (r.ok) say('ok', r.state.message === 'DELIVERED' ? 'Message delivered!' : 'Sent! Message is on the satellite', r.state.message === 'DELIVERED' ? 'The relief station has it.' : 'Now wait for the relief station pass.');
    else say(state.activePass ? 'fail' : 'info', state.activePass ? 'Transmission failed' : 'Not overhead yet', r.text);
  };

  const finish = (to: Screen) => {
    if (state && design) setHistory((h) => [...h, `${design.transmitter.name} · ${design.battery.name} · ${design.orbit.name}: ${state.outcome === 'won' ? '✓ delivered' : `✗ ${state.failure}`}`]);
    setScreen(to);
  };

  const margin = linkMargin({ community: community ?? { lat: 0, lon: 0 }, transmitter: parts[0], battery: parts[1], orbit: parts[2] });
  const perPassWh = ((parts[0].txDrawW ?? 0) * 6) / 60;
  const passesPerCharge = (parts[1].capacityWh ?? 0) * 0.9 / Math.max(0.1, perPassWh);

  return (
    <div className="app">
      <header>
        <Logo />
        <Steps at={{ briefing: 0, workbench: 1, console: 2, receipt: 3 }[screen]} />
        <button className="ghost small" onClick={() => setAbout(true)}>About</button>
      </header>

      {/* ------------------------------------------------ 1 · place + message */}
      {screen === 'briefing' && (
        <main className="brief">
          <section className="hero">
            <h1>Get the message <span className="hl">home</span>.</h1>
            <p className="lede">A flood cut your town off. Build a satellite and fly the call for help to a relief station.</p>
          </section>
          <div className="brief-grid">
            <div className="panel">
              <h2><span className="num">1</span> Pick your town</h2>
              <div className="chips">{CITIES.map((c) => (
                <button key={c.name} className={`chip ${community?.lat === c.lat && community?.lon === c.lon ? 'on' : ''}`} onClick={() => setCommunity({ lat: c.lat, lon: c.lon })}>{c.name}</button>
              ))}</div>
              <MapCanvas community={community} relief={community && loc?.ok ? reliefFor(community) : null} onPick={setCommunity} />
              <p className="hint">{community ? (loc?.ok ? '✓ Town set. The relief station is ~1,500 km east.' : '') : 'Or tap anywhere on the map.'}</p>
              {community && !loc?.ok && <p className="err">{(loc as { reason: string }).reason}</p>}
            </div>
            <div className="panel">
              <h2><span className="num">2</span> Write the message</h2>
              <div className="envelope"><Icon name="envelope" className="deep big" />
                <textarea aria-label="Emergency message" maxLength={160} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What does your town need?" />
              </div>
              <p className="hint">{message.trim().length}/160</p>
              {!message.trim() && <p className="err">Write a message first. That's what you're delivering.</p>}
              <button className="cta" disabled={!community || !loc?.ok || !message.trim()} onClick={() => setScreen('workbench')}>Build my satellite →</button>
              <p className="tiny">{SCENARIO_LABEL}</p>
            </div>
          </div>
        </main>
      )}

      {/* ------------------------------------------------ 2 · build */}
      {screen === 'workbench' && (
        <main className="build">
          <section className="stage">
            <h2>Your satellite</h2>
            <Satellite parts={parts} />
            <div className="meters">
              <Meter label="Signal" value={(margin + 8) / 16} tone={margin < 0 ? 'bad' : margin < 2 ? 'warn' : 'ok'} note={margin < 0 ? 'Too weak, can’t reach the ground' : margin < 2 ? 'Just enough' : 'Strong'} />
              <Meter label="Power" value={passesPerCharge / 15} tone={passesPerCharge < 4 ? 'bad' : passesPerCharge < 8 ? 'warn' : 'ok'} note={passesPerCharge < 4 ? 'Drains fast' : passesPerCharge < 8 ? 'Okay' : 'Lasts long'} />
              <Meter label="Budget" value={cost / BUDGET_K} tone={cost > BUDGET_K ? 'bad' : cost > 130 ? 'warn' : 'ok'} note={`$${cost}k of $${BUDGET_K}k`} />
            </div>
          </section>
          <aside className="parts">
            {SLOTS.map((slot) => {
              const ui = SLOT_UI[slot]; const sel = byId(pick[slot]);
              return (
                <section key={slot} className="part-group">
                  <h3><Icon name={ui.icon} className="deep" />{ui.title}</h3>
                  <div className="part-row">
                    {CATALOG.filter((c) => c.slot === slot).map((c) => (
                      <button key={c.id} className={`part ${pick[slot] === c.id ? 'on' : ''}`} onClick={() => setPick((p) => ({ ...p, [slot]: c.id }))} aria-pressed={pick[slot] === c.id}>
                        <b>{ui.stat(c)}</b><small>${c.costK}k</small>
                      </button>
                    ))}
                  </div>
                  <p className="part-hint">{sel.tradeoff}</p>
                </section>
              );
            })}
            <div className="launch-box">
              <p className={`verdict ${cost > BUDGET_K ? 'bad' : margin < 0 ? 'warn' : 'ok'}`}>
                {cost > BUDGET_K ? `Over budget by $${cost - BUDGET_K}k` : margin < 0 ? 'Warning: signal too weak' : 'Ready for launch'}
              </p>
              {error && <p className="err">{error}</p>}
              <button className="cta" disabled={cost > BUDGET_K} onClick={launch}>Launch 🚀</button>
              <button className="ghost small" onClick={() => setScreen('briefing')}>← Back</button>
            </div>
          </aside>
        </main>
      )}

      {/* ------------------------------------------------ 3 · fly */}
      {screen === 'console' && state && design && scenario && (() => {
        const want = neededSite(state); const np = nextPass(state, want);
        const pct = state.batteryWh / capacity(design);
        const pass = state.activePass; const useful = !!pass && pass.site === want && !(pass.site === 'relief' && state.reliefOfflineUntilMin !== null);
        return (
          <main className={`fly ${state.conserve ? 'dim' : ''}`}>
            <div className="hud">
              <span className="pill"><b>{fmtClock(state.tMin)}</b></span>
              <span className={`pill ${state.deadlineMin - state.tMin < 60 ? 'bad' : ''}`}>⏳ {fmtClock(state.deadlineMin - state.tMin).slice(2)} left</span>
              <span className={`pill batt ${pct < 0.15 ? 'bad' : ''}`}><Icon name="battery" className={pct < 0.15 ? 'red sm' : 'deep sm'} /><span className="mini-bar"><i style={{ width: `${pct * 100}%` }} /></span>{Math.round(pct * 100)}%</span>
              <span className="pill journey" aria-label={`Message: ${state.message}`}>
                <Icon name="envelope" className="deep sm" />
                <i className="on" /><i className={state.message !== 'AT_COMMUNITY' ? 'on' : ''} /><i className={state.message === 'DELIVERED' ? 'on' : ''} />
              </span>
              <button className="ghost small" onClick={() => setRunning(!running)}>{running ? '❚❚ Pause' : '▶ Play'}</button>
              <button className={`ghost small ${fast ? 'on' : ''}`} onClick={() => { setFast(!fast); setRunning(true); }} title="Skip ahead to the next pass">⏩ {fast ? 'Fast' : 'Skip ahead'}</button>
            </div>

            <div className="map-wrap">
              <MapCanvas community={scenario.community} relief={scenario.relief} scenario={scenario} design={design} state={state} beam={beam} />
              {!running && state.tMin === 0 && (
                <button className="start-overlay" onClick={() => setRunning(true)}>▶ Start mission</button>
              )}
              {state.outcome !== 'running' && (
                <div className={`end-overlay ${state.outcome}`}>{state.outcome === 'won' ? '✓ Delivered!' : '✗ Mission failed'}</div>
              )}
              {flash && <div key={flash.id} className={`flash ${flash.tone}`} role="status"><b>{flash.tone === 'ok' ? '✓ ' : flash.tone === 'fail' ? '✗ ' : ''}{flash.title}</b><span>{flash.text}</span></div>}
            </div>

            <div className="controls">
              <div className={`next ${useful ? 'live' : ''}`}>
                {useful
                  ? <><b>Overhead: {pass!.site === 'community' ? 'your town' : 'relief station'} · slow-motion</b><span>Window closes in {fmtMMSS(pass!.endMin - state.tMin)}</span></>
                  : <><b>{np ? `Next: ${np.site === 'community' ? 'your town' : 'relief station'}` : 'No passes left'}</b><span>{np ? `in ${wait(np.startMin - state.tMin)}` : 'before the deadline'}</span></>}
              </div>
              <button className={`tx ${useful ? 'live' : ''}`} onClick={doTransmit} disabled={state.outcome !== 'running'}>
                <Icon name="dish" className="white" /> TRANSMIT
              </button>
              <button className={`ghost small ${state.conserve ? 'on' : ''}`} onClick={() => setState(setConserve(state, !state.conserve))} title="Saves power, but the radio is off">
                {state.conserve ? '🌙 Saving power' : '🌙 Save power'}
              </button>
            </div>

            <div className="msg-strip"><Icon name="envelope" className="deep sm" /><span>“{message}”</span><em>{state.message === 'AT_COMMUNITY' ? 'in your town' : state.message === 'ON_SATELLITE' ? 'on the satellite' : 'delivered'}</em></div>

            <details className="logbox"><summary>Mission log ({state.log.length})</summary>
              <ol>{[...state.log].reverse().map((e, i) => <li key={i} className={e.kind}><b>{fmtClock(e.tMin)}</b> {e.text}</li>)}</ol>
            </details>
          </main>
        );
      })()}

      {/* ------------------------------------------------ 4 · debrief */}
      {screen === 'receipt' && state && design && (
        <main className="debrief">
          <div className={`verdict-card ${state.outcome}`}>
            <div className="big-icon">{state.outcome === 'won' ? '✓' : '✗'}</div>
            <h1>{state.outcome === 'won' ? `Delivered at ${fmtClock(state.tMin)}` : 'The message never made it'}</h1>
            <blockquote>“{message}”</blockquote>
            <p className="where">{state.outcome === 'won' ? 'Received by the relief station' : state.message === 'ON_SATELLITE' ? 'Stuck on the satellite' : 'Never left your town'}</p>
          </div>
          <div className="lesson"><b>Why?</b> {takeaway(state, design)}</div>
          <div className="actions">
            <button className="cta" onClick={() => finish('workbench')}>Redesign & retry</button>
            <button className="ghost" onClick={() => { finish('briefing'); setCommunity(null); }}>New town</button>
          </div>
          {history.length > 0 && <div className="history"><b>Earlier tries</b><ul>{history.map((h, i) => <li key={i}>{h}</li>)}</ul></div>}
          <details className="logbox"><summary>Full mission log</summary>
            <ol>{state.log.map((e, i) => <li key={i} className={e.kind}><b>{fmtClock(e.tMin)}</b> {e.text}</li>)}</ol>
          </details>
        </main>
      )}

      {about && (
        <div className="modal" onClick={() => setAbout(false)}><div className="panel" onClick={(e) => e.stopPropagation()}>
          <h2>About Tether</h2>
          <p>Build a satellite, fly it, and learn that engineering choices affect each other: a stronger radio drains the battery, a higher orbit weakens the signal, and a satellite can only talk when it’s overhead. The physics are simplified but real.</p>
          <p className="tiny">AI disclosure: built with help from AI coding tools; mechanics reviewed and tested by the team.</p>
          <button className="cta" onClick={() => setAbout(false)}>Close</button>
        </div></div>
      )}

      <footer className="credits">Basemap: NASA Blue Marble · Component ranges: NASA Small Spacecraft Technology report · Scenario is fictional</footer>
    </div>
  );
}
