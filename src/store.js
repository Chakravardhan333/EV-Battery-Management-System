class TelemetryStore {
  constructor(limit = 2000) {
    this.limit = limit;
    this.samples = [];
    this.frames = [];
    this.mongo = null;
  }

  async attachMongo(client, dbName) {
    this.mongo = client.db(dbName).collection("telemetry");
  }

  async push(sample, diagnosis) {
    const row = { ...sample, diagnosisHealth: diagnosis.health, diagnosisSeverity: diagnosis.severity };
    this.samples.push(row);
    if (this.samples.length > this.limit) this.samples.shift();

    this.frames.unshift({
      canId: sample.canId,
      seq: sample.seq,
      delayMs: sample.delayMs,
      delayClass: sample.delayClass,
      timestamp: sample.receivedAt,
      drops: sample.drops,
      connected: sample.canConnected,
      dataClass: sample.dataClass,
    });
    if (this.frames.length > 80) this.frames.pop();

    if (this.mongo) {
      try {
        await this.mongo.insertOne({ ...row, storedAt: new Date() });
      } catch {
        /* history is optional; in-memory remains source of live UI */
      }
    }
  }

  latest() {
    return this.samples[this.samples.length - 1] || null;
  }

  history(count = 300) {
    return this.samples.slice(-count);
  }

  canSnapshot() {
    const latest = this.latest();
    return {
      connected: latest ? latest.canConnected : false,
      canId: latest?.canId ?? null,
      delayMs: latest?.delayMs ?? null,
      delayClass: latest?.delayClass ?? null,
      timestamp: latest?.receivedAt ?? null,
      drops: latest?.drops ?? 0,
      rxRateHz: latest?.rxRateHz ?? null,
      seq: latest?.seq ?? null,
      health: latest?.canConnected ? "up" : "down",
      frames: this.frames.slice(0, 25),
    };
  }
}

module.exports = { TelemetryStore };
