import { useState, useEffect, useRef, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const MODES = [
  { id: "feed",         label: "Feed me",       desc: "All bots rush you and eject mass" },
  { id: "farm",         label: "Farm first",    desc: "Eat pellets to grow, then feed — much more mass" },
  { id: "feedEveryone", label: "Feed everyone", desc: "Bots die into whoever is nearest" },
  { id: "freeze",       label: "Freeze",        desc: "Hold position, stop moving" },
  { id: "idle",         label: "Idle",          desc: "Stay connected, do nothing" },
];

const REGIONS = [
  { id: "auto",            label: "Automatic" },
  { id: "us-east-1",       label: "US East 1" },
  { id: "us-east-2",       label: "US East 2" },
  { id: "us-west-1",       label: "US West 1" },
  { id: "eu-west-1",       label: "EU West 1" },
  { id: "eu-west-3",       label: "EU West 3" },
  { id: "eu-central-1",    label: "EU Central 1" },
  { id: "ap-northeast-1",  label: "AP Northeast 1" },
  { id: "ap-southeast-1",  label: "AP Southeast 1" },
  { id: "ap-south-1",      label: "AP South 1" },
  { id: "sa-east-1",       label: "SA East 1" },
];

const NICKS = [
  { id: "varied",  label: "Varied" },
  { id: "uniform", label: "All same" },
  { id: "blank",   label: "Blank" },
];

function Stat({ label, value, tone }) {
  const colors = { good: "#22c55e", warn: "#f59e0b", accent: "#3b82f6", dim: "#6b7280" };
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={{ color: colors[tone] || "var(--text)" }}>{value}</span>
    </div>
  );
}

export default function App() {
  const [key, setKey] = useState(localStorage.getItem("k") || "");
  const [authed, setAuthed] = useState(!!localStorage.getItem("k"));
  const [pwErr, setPwErr] = useState("");

  const [party, setParty] = useState(localStorage.getItem("party") || "");
  const [uid, setUid] = useState(localStorage.getItem("uid") || "");
  const [count, setCount] = useState(100);
  const [mode, setMode] = useState("feed");
  const [nickMode, setNickMode] = useState("varied");
  const [region, setRegion] = useState(localStorage.getItem("region") || "eu-west-3");

  const [st, setSt] = useState({ running: false, alive: 0, dead: 0, connecting: 0, offline: 0, totalFed: 0, botMass: 0, total: 0, uptime: 0, logs: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const logRef = useRef(null);

  const post = useCallback(async (path, body) => {
    const r = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-engine-key": key },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }, [key]);

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`${API}/status`);
      if (r.ok) setSt(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (!authed) return;
    poll();
    const t = setInterval(poll, 1000);
    return () => clearInterval(t);
  }, [authed, poll]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [st.logs]);

  const login = async () => {
    try {
      await post("/command", { cmd: "respawn", scope: "none" });
      localStorage.setItem("k", key);
      setAuthed(true); setPwErr("");
    } catch (e) {
      if (String(e.message).includes("password")) setPwErr("Wrong password");
      else { localStorage.setItem("k", key); setAuthed(true); }
    }
  };

  const start = async () => {
    setErr(""); setBusy(true);
    try {
      localStorage.setItem("party", party);
      localStorage.setItem("uid", uid);
      localStorage.setItem("region", region);
      await post("/start", { partyKey: party, uid, botCount: count, mode, nickMode, region });
      poll();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true);
    try { await post("/stop"); poll(); } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const switchMode = async (m) => {
    setMode(m);
    if (st.running) { try { await post("/mode", { mode: m }); } catch (e) { setErr(e.message); } }
  };

  const cmd = async (c, scope = "all") => {
    try { await post("/command", { cmd: c, scope }); } catch (e) { setErr(e.message); }
  };

  const rescale = async (n) => {
    setCount(n);
    if (st.running) { try { await post("/scale", { botCount: n }); } catch {} }
  };

  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  if (!authed) return (
    <div className="gate">
      <div className="gate-box">
        <div className="brand"><span className="dot-logo" /> BotEngine</div>
        <input type="password" placeholder="Password" value={key}
          onChange={(e) => { setKey(e.target.value); setPwErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && login()} />
        {pwErr && <div className="err">{pwErr}</div>}
        <button className="primary" onClick={login}>Enter</button>
      </div>
    </div>
  );

  return (
    <div className="app">
      <header>
        <div className="brand"><span className="dot-logo" /> BotEngine</div>
        <div className="head-right">
          {st.running && <span className="uptime">{fmtTime(st.uptime)}</span>}
          <span className={`pill ${st.running ? "on" : ""}`}>
            <i /> {st.running ? "Running" : "Idle"}
          </span>
        </div>
      </header>

      <main>
        <section className="col">
          <div className="card">
            <h3>Session</h3>
            <label>Region — must match your game</label>
            <select value={region} onChange={(e) => setRegion(e.target.value)} disabled={st.running}>
              {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>

            <label>Your UID</label>

            <input className="mono" value={uid} onChange={(e) => setUid(e.target.value)}
              placeholder="275ed4c0-dc5d-4c..." disabled={st.running} />

            <label>Party link or server IP <span className="opt">optional</span></label>
            <input value={party} onChange={(e) => setParty(e.target.value)}
              placeholder="?party=SJPCXC  or  34.87.12.44:443" disabled={st.running} />

            <div className="row-between">
              <label>Bots</label><span className="num">{count}</span>
            </div>
            <input type="range" min={1} max={450} value={count}
              onChange={(e) => rescale(+e.target.value)} />
            <div className="ticks"><span>1</span><span>150</span><span>450</span></div>

            <label>Nicknames</label>
            <div className="seg">
              {NICKS.map((n) => (
                <button key={n.id} className={nickMode === n.id ? "on" : ""}
                  onClick={() => !st.running && setNickMode(n.id)}>{n.label}</button>
              ))}
            </div>

            {err && <div className="err">{err}</div>}

            <button className={st.running ? "danger" : "primary"} disabled={busy}
              onClick={st.running ? stop : start}>
              {busy ? "…" : st.running ? "Stop all bots" : "Start bots"}
            </button>
          </div>

          <div className="card">
            <h3>Mode</h3>
            <div className="modes">
              {MODES.map((m) => (
                <button key={m.id} className={`mode ${mode === m.id ? "on" : ""}`}
                  onClick={() => switchMode(m.id)}>
                  <b>{m.label}</b><span>{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>Actions</h3>
            <div className="acts">
              <button onClick={() => cmd("split")} disabled={!st.running}>Split all</button>
              <button onClick={() => cmd("split", "half")} disabled={!st.running}>Split half</button>
              <button onClick={() => cmd("eject")} disabled={!st.running}>Eject once</button>
              <button onClick={() => cmd("respawn")} disabled={!st.running}>Force respawn</button>
            </div>
          </div>
        </section>

        <section className="col">
          <div className="stats">
            <Stat label="Alive" value={st.alive} tone="good" />
            <Stat label="Respawning" value={st.dead} tone="warn" />
            <Stat label="Connecting" value={st.connecting} tone="dim" />
            <Stat label="Offline" value={st.offline} tone="dim" />
            <Stat label="Mass fed" value={st.totalFed.toLocaleString()} tone="accent" />
            <Stat label="Bot mass" value={st.botMass.toLocaleString()} tone="accent" />
          </div>

          {st.server && (
            <div className="card thin">
              <span className="k">Server</span><span className="v mono">{st.server}</span>
            </div>
          )}

          <div className="card grow">
            <h3>Log</h3>
            <div className="log" ref={logRef}>
              {st.logs?.length ? st.logs.map((l, i) => (
                <div key={i} className={`ln ${l.level}`}>
                  <span className="ts">{new Date(l.t).toLocaleTimeString()}</span>{l.msg}
                </div>
              )) : <div className="ln">Waiting for engine…</div>}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
