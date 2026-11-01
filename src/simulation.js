const { parseTelemetry } = require("./validate");

class SimulationEngine {
  constructor() {
    this.soc = 78.4;
    this.voltage = 398.6;
    this.current = 12.5;
    this.temperature = 31.8;
    this.seq = 0;
    this.drops = 0;
    this.faults = {
      sensorDrift: false,
      highTemp: false,
      canDelay: false,
      packetDropout: false,
      commFailure: false,
      abnormalVoltage: false,
    };
    this.paused = false;
    this.deterministic = false;
    this.sessionStarted = Date.now();
  }

  setFault(type, enable, magnitude) {
    if (type === "normal") {
      for (const key of Object.keys(this.faults)) this.faults[key] = false;
      return this.faults;
    }
    if (!(type in this.faults)) return this.faults;
    this.faults[type] = enable;
    this.magnitude = magnitude;
    return this.faults;
  }

  tick() {
    if (this.paused) return null;
    this.seq += 1;

    if (this.faults.commFailure) {
      return parseTelemetry({
        voltage: null,
        current: null,
        temperature: null,
        soc: null,
        delayMs: null,
        delayClass: "simulated",
        seq: this.seq,
        canId: "0x101",
        drops: this.drops,
        canConnected: false,
        chargeState: "unknown",
        rxRateHz: 0,
      }, "simulation");
    }

    let dropThis = false;
    const dropChance = this.deterministic ? 1 : 0.35;
    if (this.faults.packetDropout && Math.random() < dropChance) {
      dropThis = true;
      this.drops += 4;
      this.seq += 4;
    }

    const chargeBias = this.current > 0 ? 0.008 : -0.012;
    this.soc = Math.min(95, Math.max(12, this.soc + chargeBias + (Math.random() - 0.5) * 0.02));
    this.current = 8 + Math.sin(Date.now() / 9000) * 10 + (Math.random() - 0.5) * 1.2;
    this.voltage = 360 + this.soc * 0.52 + this.current * 0.08 + (Math.random() - 0.5) * 0.25;
    this.temperature = 30.5 + Math.max(0, Math.abs(this.current) * 0.04) + (Math.random() - 0.5) * 0.2;

    if (this.faults.sensorDrift) this.voltage += this.magnitude ?? 14;
    if (this.faults.abnormalVoltage) this.voltage = this.magnitude ?? 455;
    if (this.faults.highTemp) this.temperature = this.magnitude ?? 58.5;

    let delayMs = 8 + Math.random() * 6;
    if (this.faults.canDelay) delayMs = this.magnitude ?? (90 + Math.random() * 80);

    const rxRate = dropThis ? 3.2 : 5.0;

    return parseTelemetry({
      voltage: round(this.voltage, 2),
      current: round(this.current, 2),
      temperature: round(this.temperature, 2),
      soc: round(this.soc, 2),
      delayMs: round(delayMs, 1),
      delayClass: "simulated",
      seq: this.seq,
      canId: "0x101",
      drops: this.drops,
      canConnected: true,
      chargeState: this.current > 0.4 ? "charging" : this.current < -0.4 ? "discharging" : "idle",
      rxRateHz: rxRate,
      interArrivalMs: dropThis ? 400 : 200,
      ts: Date.now(),
    }, "simulation");
  }
}

function round(n, d) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

module.exports = { SimulationEngine };
