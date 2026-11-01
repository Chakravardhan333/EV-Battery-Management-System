function asNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Accept newline-delimited JSON from the Arduino receiver or simulation.
 * Unknown fields are ignored. Missing sensors become null, never fabricated.
 */
function parseTelemetry(raw, origin) {
  if (!raw || typeof raw !== "object") return null;

  const voltage = finiteOrNull(raw.voltage ?? raw.v);
  const current = finiteOrNull(raw.current ?? raw.i);
  const temperature = finiteOrNull(raw.temperature ?? raw.temp ?? raw.t);
  const soc = finiteOrNull(raw.soc);
  const delayMs = finiteOrNull(raw.delayMs ?? raw.delay_ms);
  const seq = finiteOrNull(raw.seq);
  const canId = raw.canId ?? raw.can_id ?? raw.id;
  const drops = finiteOrNull(raw.drops ?? raw.dropCount);
  const rxRate = finiteOrNull(raw.rxRateHz ?? raw.rx_rate_hz);
  const interArrivalMs = finiteOrNull(raw.interArrivalMs ?? raw.dt_ms);

  const chargeState = normalizeChargeState(raw.chargeState ?? raw.state, current);
  const hostTs = Date.now();
  const deviceTs = finiteOrNull(raw.ts ?? raw.rxMillis);

  return {
    origin,
    dataClass: origin === "hardware" ? "measured" : "simulated",
    voltage,
    current,
    temperature,
    soc,
    delayMs,
    delayClass: classifyDelay(raw.delayClass, origin, delayMs),
    seq: seq === null ? null : Math.trunc(seq),
    canId: canId === undefined || canId === null ? null : String(canId),
    drops: drops === null ? 0 : Math.max(0, Math.trunc(drops)),
    rxRateHz: rxRate,
    interArrivalMs,
    chargeState,
    canConnected: raw.canConnected !== false && raw.can_ok !== false,
    missingFields: ["voltage", "current", "temperature", "soc"].filter((k) => {
      const map = { voltage, current, temperature, soc };
      return map[k] === null;
    }),
    deviceTs,
    hostTs,
    receivedAt: new Date(hostTs).toISOString(),
  };
}

function classifyDelay(explicit, origin, delayMs) {
  if (explicit === "measured" || explicit === "estimated" || explicit === "simulated") {
    return explicit;
  }
  if (origin === "hardware" && delayMs !== null) return "measured";
  if (origin === "simulation") return "simulated";
  return "estimated";
}

function normalizeChargeState(value, current) {
  const v = String(value || "").toLowerCase();
  if (v === "charging" || v === "discharging" || v === "idle" || v === "unknown") return v;
  if (current === null) return "unknown";
  if (current > 0.4) return "charging";
  if (current < -0.4) return "discharging";
  return "idle";
}

function parseThresholds(body, current) {
  if (!body || typeof body !== "object") return current;
  const next = { ...current };
  const keys = [
    "voltageMin", "voltageMax", "voltageDrift",
    "tempWarn", "tempCrit",
    "delayWarnMs", "delayCritMs",
    "dropoutWarn", "timeoutMs",
    "observerAlpha",
  ];
  for (const key of keys) {
    if (body[key] === undefined) continue;
    const n = asNumber(body[key], null);
    if (n === null) continue;
    next[key] = n;
  }
  next.observerAlpha = clamp(next.observerAlpha, 0.01, 0.99);
  return next;
}

function parseFaultRequest(body) {
  const allowed = new Set([
    "sensorDrift",
    "highTemp",
    "canDelay",
    "packetDropout",
    "commFailure",
    "abnormalVoltage",
    "normal",
  ]);
  const type = String(body?.type || "");
  if (!allowed.has(type)) {
    const err = new Error("Unknown fault type");
    err.status = 400;
    throw err;
  }
  return {
    type,
    enable: body.enable !== false && type !== "normal",
    magnitude: asNumber(body.magnitude, null),
  };
}

module.exports = {
  asNumber,
  clamp,
  finiteOrNull,
  parseTelemetry,
  parseThresholds,
  parseFaultRequest,
};
