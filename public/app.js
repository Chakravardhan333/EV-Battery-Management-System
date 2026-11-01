const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get("token") || "";
const headers = { "Content-Type": "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

let paused = false;
let startedAt = Date.now();
let latest = { sample: null, diagnosis: null, can: null, alerts: { history: [], active: [] } };
const series = { v: [], i: [], t: [], soc: [] };
const maxPoints = 300;

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
}

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, { headers, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function fmt(n, d = 1) {
  return n === null || n === undefined || Number.isNaN(n) ? "—" : Number(n).toFixed(d);
}

function pushPoint(arr, value) {
  arr.push(value);
  while (arr.length > maxPoints) arr.shift();
}

function chartOpts(color) {
  return {
    type: "line",
    data: {
      labels: [],
      datasets: [{ data: [], borderColor: color, backgroundColor: "transparent", borderWidth: 2, pointRadius: 0, tension: 0.25 }],
    },
    options: {
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { ticks: { color: "#7d93a0", font: { size: 10 } }, grid: { color: "#1d2d36" } },
      },
    },
  };
}

const charts = {};
function makeCharts() {
  charts.overview = new Chart($("overviewChart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "V", data: [], borderColor: "#3ddc97", borderWidth: 2, pointRadius: 0, tension: 0.25 },
        { label: "A", data: [], borderColor: "#58b9ee", borderWidth: 2, pointRadius: 0, tension: 0.25, yAxisID: "y1" },
      ],
    },
    options: {
      animation: false,
      plugins: { legend: { labels: { color: "#9aabb0", boxWidth: 8 } } },
      scales: {
        x: { display: false },
        y: { ticks: { color: "#7d93a0" }, grid: { color: "#1d2d36" } },
        y1: { position: "right", ticks: { color: "#7d93a0" }, grid: { drawOnChartArea: false } },
      },
    },
  });
  charts.v = new Chart($("chartV"), chartOpts("#3ddc97"));
  charts.i = new Chart($("chartI"), chartOpts("#58b9ee"));
  charts.t = new Chart($("chartT"), chartOpts("#ffb36a"));
  charts.soc = new Chart($("chartSoc"), chartOpts("#a78bfa"));
}

function updateCharts() {
  const n = Number($("rangeSelect").value);
  const slice = (arr) => arr.slice(-n);
  const labels = Array.from({ length: Math.min(n, series.v.length) }, (_, i) => String(i));
  charts.overview.data.labels = labels;
  charts.overview.data.datasets[0].data = slice(series.v);
  charts.overview.data.datasets[1].data = slice(series.i);
  charts.overview.update("none");
  ["v", "i", "t", "soc"].forEach((key) => {
    charts[key].data.labels = labels;
    charts[key].data.datasets[0].data = slice(series[key]);
    charts[key].update("none");
  });
}

function setView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("show"));
  const el = $(`view-${name}`);
  if (el) el.classList.add("show");
  document.querySelectorAll(".nav").forEach((n) => n.classList.toggle("active", n.dataset.view === name));
  const titles = {
    overview: "System overview",
    telemetry: "Live telemetry",
    can: "CAN bus",
    diagnostics: "Diagnostics",
    hil: "HIL test bench",
    lab: "Fault injection",
    alerts: "Alert center",
  };
  $("crumb").textContent = titles[name] || name;
}

function render(payload) {
  if (paused) {
    $("lastUpdate").textContent = "Stream paused";
    return;
  }
  const sample = payload.sample;
  const diag = payload.diagnosis;
  const can = payload.can;
  const alerts = payload.alerts;
  latest = payload;
  if (!sample) return;

  pushPoint(series.v, sample.voltage);
  pushPoint(series.i, sample.current);
  pushPoint(series.t, sample.temperature);
  pushPoint(series.soc, sample.soc);
  updateCharts();

  $("soc").textContent = fmt(sample.soc, 1);
  $("socBar").style.width = `${Math.max(0, Math.min(100, sample.soc || 0))}%`;
  $("voltage").textContent = sample.voltage == null ? "—" : `${fmt(sample.voltage, 1)} V`;
  $("temp").textContent = fmt(sample.temperature, 1);
  $("tempBar").style.width = `${Math.max(0, Math.min(100, (((sample.temperature || 0) + 20) / 80) * 100))}%`;
  $("current").textContent = fmt(sample.current, 1);
  $("chargeState").textContent = sample.chargeState || "unknown";
  $("latency").textContent = fmt(sample.delayMs, 0);
  $("delayClass").textContent = (sample.delayClass || "").toUpperCase();
  $("drops").textContent = String(sample.drops ?? "—");
  $("lastUpdate").textContent = new Date(sample.hostTs).toLocaleTimeString("en-GB", { hour12: false });
  $("dataClassTag").textContent = sample.dataClass === "measured" ? "MEASURED DATA" : "SIMULATED DATA";
  $("battHealth").textContent = diag?.health || "—";
  $("tempHint").textContent = sample.temperature == null ? "No sensor" : "Live";

  if (can) {
    $("canUp").textContent = can.connected ? "UP" : "DOWN";
    $("canHealth").textContent = can.health || "—";
    $("canId").textContent = can.canId || "—";
    $("rxRate").textContent = fmt(can.rxRateHz, 1);
    $("canDelayClass").textContent = can.delayClass || "—";
    $("canBody").innerHTML = (can.frames || []).map((f) =>
      `<tr><td>${f.timestamp ? new Date(f.timestamp).toLocaleTimeString("en-GB", { hour12: false }) : "—"}</td><td>${f.canId || "—"}</td><td>${f.seq ?? "—"}</td><td>${fmt(f.delayMs, 1)}</td><td>${f.delayClass || ""}</td><td>${f.drops ?? ""}</td></tr>`
    ).join("");
  }

  if (diag) {
    const sev = diag.severity;
    const badge = $("diagBadge");
    const strip = $("statusStrip");
    strip.classList.remove("warn", "crit");
    $("diagDot").className = "nav-dot";
    if (sev === "critical") {
      badge.className = "badge crit";
      badge.innerHTML = "<i></i> CRITICAL";
      strip.classList.add("crit");
      $("diagDot").classList.add("crit");
    } else if (sev === "warning" || diag.health !== "healthy") {
      badge.className = "badge warn";
      badge.innerHTML = "<i></i> WARNING";
      strip.classList.add("warn");
      $("diagDot").classList.add("warn");
    } else {
      badge.className = "badge success";
      badge.innerHTML = "<i></i> NOMINAL";
    }
    const top = diag.faults[0];
    $("systemStatus").textContent = top ? top.title : "All systems nominal";
    $("diagTitle").textContent = top ? top.title : "No active faults";
    $("diagDetail").textContent = top ? top.detail : "Physical and communication paths isolated";
    $("diagRing").textContent = top ? "!" : "✓";
    $("resV").textContent = diag.observer?.residualV == null ? "—" : `${fmt(diag.observer.residualV, 2)} V`;
    $("resT").textContent = diag.observer?.residualT == null ? "—" : `${fmt(diag.observer.residualT, 1)} °C`;
    $("resVState").textContent = diag.observer?.heldForDelay ? "Held" : "Live";
    $("resTState").textContent = diag.health === "healthy" ? "Normal" : "Check";
    $("delayHold").textContent = diag.observer?.heldForDelay ? "YES" : "No";
    $("isoLat").textContent = diag.isolation?.latencyMs == null ? "—" : `${fmt(diag.isolation.latencyMs, 0)} ms`;
    $("isoState").textContent = diag.isolation?.status || "Ready";
    $("isoNote").textContent = diag.isolation?.note || "";
    $("faultList").innerHTML = diag.faults.length
      ? diag.faults.map((f) => `<li><b>${f.title}</b> · ${f.domain} · ${f.severity}<br><small>${f.detail}</small></li>`).join("")
      : "<li>No faults</li>";
  }

  if (alerts?.history) renderAlerts(alerts);
}

function renderAlerts(alerts) {
  const rows = alerts.history.slice(0, 40);
  $("alertMark").hidden = !(alerts.active && alerts.active.length);
  $("eventsList").innerHTML = rows.map((a) => {
    const cls = a.severity === "critical" ? "red-event" : a.severity === "warning" ? "orange-event" : "green-event";
    const icon = a.severity === "critical" ? "!" : a.severity === "warning" ? "⚠" : "✓";
    const t = a.timestamp ? new Date(a.timestamp).toLocaleTimeString("en-GB", { hour12: false }) : "";
    return `<div class="event"><span class="event-icon ${cls}">${icon}</span><div><b>${a.title}</b><small>${a.detail || ""} · ${a.dataClass || ""}</small></div><time>${t}</time></div>`;
  }).join("") || "<p class='hint'>No alerts yet.</p>";
}

function renderHil(result) {
  if (!result) return;
  $("hilPass").textContent = String(result.stats.passed);
  $("hilFail").textContent = String(result.stats.failed);
  $("hilKind").textContent = (result.coverage?.kind || result.suite || "").toUpperCase();
  $("hilNote").textContent = result.coverage?.note || "";
  $("hilCases").innerHTML = result.results.map((c) =>
    `<div class="hil-case"><span>${c.title}</span><b>${c.skippedPhysical ? "UNMEASURED" : c.passed ? "PASS" : "FAIL"}</b></div>`
  ).join("");
  $("hilCov").innerHTML = `
    <div>Branch coverage <b style="float:right">${result.coverage.branchCoveragePct}%</b><div class="mini-meter"><i style="width:${Math.min(100, result.coverage.branchCoveragePct)}%"></i></div></div>
    <div>Fault-space coverage <b style="float:right">${result.coverage.faultSpaceCoveragePct}%</b><div class="mini-meter"><i style="width:${result.coverage.faultSpaceCoveragePct}%"></i></div></div>
    <p class="hint">Branches: ${(result.coverage.branchesHit || []).join(", ")}</p>`;
}

async function runHil(suite) {
  $("runBtn").disabled = true;
  $("runPhysicalBtn").disabled = true;
  toast(suite === "physical" ? "Physical HIL started" : "Software HIL started");
  try {
    const result = await api("/hil/run", { method: "POST", body: JSON.stringify({ suite }) });
    renderHil(result);
    $("hilProgress").textContent = "Complete";
    $("hilBar").style.width = "100%";
    toast(`HIL complete · ${result.stats.passed} passed`);
  } catch (err) {
    toast(err.message);
  } finally {
    $("runBtn").disabled = false;
    $("runPhysicalBtn").disabled = false;
  }
}

function tickClock() {
  $("clock").textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  $("uptime").textContent = `${h}h ${m}m ${sec}s`;
}

function fillThresholds(t) {
  const form = $("thForm");
  Object.entries(t).forEach(([k, v]) => {
    if (form[k]) form[k].value = v;
  });
}

async function init() {
  makeCharts();
  setInterval(tickClock, 1000);
  tickClock();

  document.querySelectorAll(".nav, [data-view].text-button").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      if (link.dataset.view) setView(link.dataset.view);
    });
  });
  $("alertBell").addEventListener("click", () => setView("alerts"));
  $("rangeSelect").addEventListener("change", updateCharts);

  $("pauseBtn").addEventListener("click", async () => {
    paused = !paused;
    document.body.classList.toggle("paused", paused);
    $("pauseBtn").innerHTML = paused ? "▶ <span>Resume stream</span>" : "Ⅱ <span>Pause stream</span>";
    try {
      await api("/stream/pause", { method: "POST", body: JSON.stringify({ paused }) });
    } catch {
      /* local pause still works */
    }
    toast(paused ? "Telemetry stream paused" : "Telemetry stream resumed");
  });

  $("exportBtn").addEventListener("click", () => {
    const s = latest.sample || {};
    const d = latest.diagnosis || {};
    const report = `VoltScope BMS HIL Monitor
Generated: ${new Date().toISOString()}
Mode / class: ${s.dataClass || "unknown"}

SoC: ${s.soc}
Voltage: ${s.voltage} V
Current: ${s.current} A
Temperature: ${s.temperature} C
Delay: ${s.delayMs} ms (${s.delayClass})
Drops: ${s.drops}
Health: ${d.health}
Faults: ${(d.faults || []).map((f) => f.code).join(", ") || "none"}

This prototype does not control contactors or charge hardware.
`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([report], { type: "text/plain" }));
    link.download = "voltscope-hil-report.txt";
    link.click();
    URL.revokeObjectURL(link.href);
    toast("Report exported");
  });

  $("runBtn").addEventListener("click", () => runHil("software"));
  $("runPhysicalBtn").addEventListener("click", () => runHil("physical"));

  document.querySelectorAll(".lab-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".lab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      try {
        await api("/faults", { method: "POST", body: JSON.stringify({ type: btn.dataset.fault, enable: btn.dataset.fault !== "normal" }) });
        $("labStatus").textContent = `Active: ${btn.dataset.fault} · simulation injector`;
        toast(`Fault lab: ${btn.dataset.fault}`);
      } catch (err) {
        toast(err.message);
      }
    });
  });

  $("thForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {};
    new FormData($("thForm")).forEach((v, k) => { body[k] = Number(v); });
    const res = await api("/config/thresholds", { method: "PUT", body: JSON.stringify(body) });
    toast("Thresholds saved");
    fillThresholds(res.thresholds);
  });

  const status = await api("/status");
  startedAt = Date.now() - (status.uptimeSec || 0) * 1000;
  $("modeLabel").textContent = status.mode.toUpperCase();
  $("modeBadge").innerHTML = `<i></i> ${status.mode === "hardware" ? "HARDWARE MODE" : "LIVE SIMULATION"}`;
  $("deviceLink").textContent = status.mode === "hardware" ? "HARDWARE · SERIAL" : "SIMULATION · CAN 0";
  $("footNote").textContent = status.mode === "hardware"
    ? "HARDWARE MODE · VALUES COME FROM THE RECEIVER"
    : "SIMULATION MODE · DATA IS DEMONSTRATION ONLY";

  const th = await api("/config/thresholds");
  fillThresholds(th.thresholds);

  const hist = await api("/telemetry/history?count=150");
  (hist.samples || []).forEach((s) => {
    pushPoint(series.v, s.voltage);
    pushPoint(series.i, s.current);
    pushPoint(series.t, s.temperature);
    pushPoint(series.soc, s.soc);
  });
  updateCharts();

  const lastHil = await api("/hil/last");
  if (lastHil.result) renderHil(lastHil.result);

  const socket = io({ auth: { token } });
  socket.on("telemetry", render);
  socket.on("hil:progress", (p) => {
    $("hilProgress").textContent = `${p.current} (${p.percent}%)`;
    $("hilBar").style.width = `${p.percent}%`;
  });
  socket.on("hil:complete", renderHil);
  socket.on("hello", (h) => {
    $("modeLabel").textContent = h.mode.toUpperCase();
  });
}

init().catch((err) => toast(err.message));
