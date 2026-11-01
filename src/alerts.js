const { EventEmitter } = require("events");

class AlertService extends EventEmitter {
  constructor() {
    super();
    this.history = [];
    this.active = new Map();
    this.maxHistory = 200;
  }

  raise({ severity, code, title, detail, dataClass = "simulated" }) {
    const key = code;
    const prev = this.active.get(key);
    if (prev && prev.severity === severity && prev.detail === detail) return prev;

    const alert = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      severity,
      code,
      title,
      detail,
      dataClass,
      timestamp: new Date().toISOString(),
      active: true,
    };
    this.active.set(key, alert);
    this.history.unshift(alert);
    if (this.history.length > this.maxHistory) this.history.pop();
    this.emit("alert", alert);
    return alert;
  }

  clear(code, note) {
    const prev = this.active.get(code);
    if (!prev) return null;
    this.active.delete(code);
    const cleared = {
      ...prev,
      active: false,
      clearedAt: new Date().toISOString(),
      detail: note || prev.detail,
    };
    this.history.unshift({
      ...cleared,
      id: `${cleared.id}-clr`,
      title: `${prev.title} cleared`,
      severity: "info",
    });
    this.emit("alert", this.history[0]);
    return cleared;
  }

  syncFromDiagnosis(diagnosis) {
    const present = new Set(diagnosis.faults.map((f) => f.code));
    for (const fault of diagnosis.faults) {
      this.raise({
        severity: fault.severity,
        code: fault.code,
        title: fault.title,
        detail: fault.detail,
        dataClass: diagnosis.dataClass,
      });
    }
    for (const code of [...this.active.keys()]) {
      if (!present.has(code)) this.clear(code);
    }
    if (diagnosis.faults.length === 0 && this.active.size === 0) {
      /* stay quiet while healthy */
    }
  }

  snapshot() {
    return {
      active: [...this.active.values()],
      history: this.history.slice(0, 50),
    };
  }
}

module.exports = { AlertService };
