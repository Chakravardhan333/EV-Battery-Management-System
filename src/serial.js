const { EventEmitter } = require("events");
const { parseTelemetry } = require("./validate");

class SerialManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.port = null;
    this.reconnectTimer = null;
    this.status = {
      enabled: config.mode === "hardware",
      connected: false,
      path: config.serial.path,
      lastError: null,
      lastRxAt: null,
    };
  }

  async start() {
    if (this.config.mode !== "hardware") {
      this.status.enabled = false;
      return;
    }
    await this.open();
  }

  async open() {
    let SerialPort;
    let ReadlineParser;
    try {
      ({ SerialPort } = require("serialport"));
      ({ ReadlineParser } = require("@serialport/parser-readline"));
    } catch (err) {
      this.status.lastError = "serialport module not installed";
      this.emit("status", this.status);
      this.scheduleReconnect();
      return;
    }

    try {
      this.port = new SerialPort({
        path: this.config.serial.path,
        baudRate: this.config.serial.baudRate,
        autoOpen: false,
      });
      const parser = this.port.pipe(new ReadlineParser({ delimiter: "\n" }));
      parser.on("data", (line) => this.onLine(line));
      this.port.on("error", (err) => {
        this.status.connected = false;
        this.status.lastError = err.message;
        this.emit("status", { ...this.status });
        this.scheduleReconnect();
      });
      this.port.on("close", () => {
        this.status.connected = false;
        this.emit("status", { ...this.status });
        this.scheduleReconnect();
      });
      await new Promise((resolve, reject) => {
        this.port.open((err) => (err ? reject(err) : resolve()));
      });
      this.status.connected = true;
      this.status.lastError = null;
      this.emit("status", { ...this.status });
    } catch (err) {
      this.status.connected = false;
      this.status.lastError = err.message;
      this.emit("status", { ...this.status });
      this.scheduleReconnect();
    }
  }

  onLine(line) {
    const trimmed = String(line).trim();
    if (!trimmed) return;
    let json;
    try {
      json = JSON.parse(trimmed);
    } catch {
      this.emit("parse-error", trimmed.slice(0, 120));
      return;
    }
    const sample = parseTelemetry(json, "hardware");
    if (!sample) return;
    this.status.lastRxAt = Date.now();
    this.emit("telemetry", sample);
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.config.mode !== "hardware") return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.port) {
        try { this.port.close(); } catch { /* ignore */ }
        this.port = null;
      }
      await this.open();
    }, this.config.serial.reconnectMs);
  }

  async stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.port) {
      try { this.port.close(); } catch { /* ignore */ }
    }
  }
}

module.exports = { SerialManager };
