# REST and Socket.IO API

Base URL: `http://127.0.0.1:3000/api`

If `BMS_API_TOKEN` is set, send `Authorization: Bearer <token>`.

## REST

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | liveness |
| GET | `/status` | mode, serial, safety flags |
| GET | `/telemetry/latest` | last sample + diagnosis |
| GET | `/telemetry/history?count=300` | ring buffer |
| GET | `/can` | bus snapshot + frame history |
| GET | `/alerts` | active + history |
| GET | `/diagnosis` | last observer output |
| GET | `/config/thresholds` | thresholds + assumptions |
| PUT | `/config/thresholds` | update numeric thresholds |
| POST | `/stream/pause` | `{ "paused": true }` simulation pause |
| POST | `/faults` | `{ "type": "sensorDrift", "enable": true }` simulation only |
| GET | `/hil/cases` | case list |
| POST | `/hil/run` | `{ "suite": "software" \| "physical" }` |
| GET | `/hil/last` | last suite result |
| POST | `/serial/reconnect` | hardware mode |

Fault `type` values: `normal`, `sensorDrift`, `highTemp`, `canDelay`, `packetDropout`, `commFailure`, `abnormalVoltage`.

## Socket.IO

Events from server:

- `hello` — mode and serial status
- `telemetry` — `{ sample, diagnosis, can, alerts }`
- `serial` — hardware port status
- `hil:progress` / `hil:complete`

Connect with `io({ auth: { token } })` when a token is configured.
