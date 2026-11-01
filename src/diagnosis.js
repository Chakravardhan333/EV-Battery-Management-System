/**
 * Delay-aware residual observer.
 *
 * Assumptions (documented for the capstone report):
 * - Physical residuals are updated only from fresh, in-time samples.
 * - A late CAN frame is classified as communication delay, not a sensor fault.
 * - Stale samples freeze the observer; they do not create a voltage residual spike.
 * - SoC, when present, is treated as an estimate unless the firmware marks it measured.
 * - Default voltage limits target the SIMULATED 400 V class pack. Hardware labs must
 *   retune voltageMin/voltageMax to the actual divider range before relying on them.
 * - Observer seed is OCV from SoC when available, so a biased first sample can still
 *   raise drift instead of being absorbed as the initial state.
 */

const DEFAULT_THRESHOLDS = {
  voltageMin: 320,
  voltageMax: 430,
  voltageDrift: 8,
  tempWarn: 45,
  tempCrit: 55,
  delayWarnMs: 80,
  delayCritMs: 200,
  dropoutWarn: 3,
  timeoutMs: 1000,
  observerAlpha: 0.15,
};

function defaultThresholds() {
  return { ...DEFAULT_THRESHOLDS };
}

function ocvFromSoc(soc) {
  if (soc === null || soc === undefined) return null;
  return 360 + soc * 0.52;
}

class DiagnosisEngine {
  constructor() {
    this.thresholds = defaultThresholds();
    this.vHat = null;
    this.lastFreshTs = null;
    this.lastSeq = null;
    this.isolationMs = null;
    this.branchesHit = new Set(["init"]);
  }

  setThresholds(next) {
    this.thresholds = { ...this.thresholds, ...next };
  }

  reset() {
    this.vHat = null;
    this.lastFreshTs = null;
    this.lastSeq = null;
    this.isolationMs = null;
  }

  evaluate(sample) {
    const t = this.thresholds;
    const faults = [];
    const now = sample.hostTs;
    const delayed = sample.delayMs !== null && sample.delayMs >= t.delayWarnMs;
    const commFailure = sample.canConnected === false;
    const timedOut = this.lastFreshTs !== null && (now - this.lastFreshTs) > t.timeoutMs;

    if (sample.drops >= t.dropoutWarn) {
      this.branchesHit.add("packet_dropout");
      faults.push(fault("packet_dropout", "warning", "Packet dropout",
        `Cumulative drops=${sample.drops} (threshold ${t.dropoutWarn})`, "communication"));
    } else if (sample.seq !== null && this.lastSeq !== null && sample.seq > this.lastSeq + 1) {
      const lost = sample.seq - this.lastSeq - 1;
      if (lost >= t.dropoutWarn) {
        this.branchesHit.add("packet_dropout");
        faults.push(fault("packet_dropout", "warning", "Packet dropout",
          `${lost} sequence gap(s)`, "communication"));
      }
    }

    if (commFailure) {
      this.branchesHit.add("comm_failure");
      faults.push(fault("comm_timeout", "critical", "Communication failure",
        "CAN or serial path reported disconnected", "communication"));
    } else if (timedOut) {
      this.branchesHit.add("comm_timeout");
      faults.push(fault("comm_timeout", "critical", "Communication timeout",
        `No fresh frame for more than ${t.timeoutMs} ms`, "communication"));
    }

    if (delayed) {
      const sev = sample.delayMs >= t.delayCritMs ? "critical" : "warning";
      this.branchesHit.add("can_delay");
      faults.push(fault("can_delay", sev, "CAN transmission delay",
        `${sample.delayMs.toFixed(1)} ms (${sample.delayClass}). Physical residuals held.`,
        "communication"));
    }

    const fresh = !delayed && !commFailure && sample.voltage !== null;
    let residualV = null;
    let residualT = null;
    const ocv = ocvFromSoc(sample.soc);

    if (fresh) {
      if (this.vHat === null) this.vHat = ocv !== null ? ocv : sample.voltage;
      else this.vHat = t.observerAlpha * sample.voltage + (1 - t.observerAlpha) * this.vHat;
      residualV = sample.voltage - this.vHat;
      this.lastFreshTs = now;
      if (sample.seq !== null) this.lastSeq = sample.seq;
      this.branchesHit.add("fresh_update");
    } else {
      this.branchesHit.add("hold_observer");
      if (this.vHat !== null && sample.voltage !== null) {
        residualV = sample.voltage - this.vHat;
      }
    }

    if (sample.temperature !== null) residualT = sample.temperature - 25;

    if (fresh && sample.voltage !== null) {
      if (sample.voltage < t.voltageMin || sample.voltage > t.voltageMax) {
        this.branchesHit.add("abnormal_voltage");
        faults.push(fault("abnormal_voltage", "critical", "Abnormal pack voltage",
          `${sample.voltage.toFixed(2)} V outside [${t.voltageMin}, ${t.voltageMax}] V`,
          "physical"));
      } else if (Math.abs(residualV) > t.voltageDrift) {
        this.branchesHit.add("sensor_drift");
        faults.push(fault("sensor_drift", "warning", "Sensor drift",
          `Voltage residual ${residualV.toFixed(2)} V exceeds ${t.voltageDrift} V`,
          "physical"));
      } else {
        this.branchesHit.add("voltage_nominal");
      }
    } else if (delayed) {
      this.branchesHit.add("delay_not_physical");
    }

    if (sample.temperature !== null && !commFailure) {
      if (sample.temperature >= t.tempCrit) {
        this.branchesHit.add("overtemperature_crit");
        faults.push(fault("overtemperature", delayed ? "warning" : "critical",
          delayed ? "Overtemperature (stale frame)" : "Overtemperature",
          `${sample.temperature.toFixed(1)} °C ≥ ${t.tempCrit} °C`,
          "physical"));
      } else if (sample.temperature >= t.tempWarn) {
        this.branchesHit.add("overtemperature_warn");
        faults.push(fault("overtemperature", "warning", "Temperature warning",
          `${sample.temperature.toFixed(1)} °C ≥ ${t.tempWarn} °C`, "physical"));
      }
    }

    if (faults.length === 0) this.branchesHit.add("nominal");

    const physical = faults.filter((f) => f.domain === "physical");
    const comm = faults.filter((f) => f.domain === "communication");
    const severity = worst(faults);
    if (physical.length && this.isolationMs === null) this.isolationMs = sample.delayMs ?? 0;
    if (!physical.length) this.isolationMs = null;

    const health = physical.length ? "fault" : comm.length ? "degraded" : "healthy";

    return {
      health,
      severity,
      dataClass: sample.dataClass,
      observer: {
        vHat: this.vHat,
        residualV,
        residualT,
        heldForDelay: delayed,
        lastFreshTs: this.lastFreshTs,
      },
      isolation: {
        status: physical.length ? "isolated" : comm.length ? "comm-path" : "ready",
        domain: physical.length ? "physical" : comm.length ? "communication" : "none",
        latencyMs: this.isolationMs,
        note: delayed
          ? "Delay present: physical observer on hold"
          : "Physical and communication faults classified separately",
      },
      faults,
      thresholds: { ...t },
      branchesHit: [...this.branchesHit],
    };
  }
}

function fault(code, severity, title, detail, domain) {
  return { code, severity, title, detail, domain };
}

function worst(faults) {
  if (faults.some((f) => f.severity === "critical")) return "critical";
  if (faults.some((f) => f.severity === "warning")) return "warning";
  return "info";
}

module.exports = { DiagnosisEngine, defaultThresholds, DEFAULT_THRESHOLDS };
