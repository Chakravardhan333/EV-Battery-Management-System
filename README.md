# VoltScope EV BMS HIL Dashboard

Delay-aware fault diagnosis and hardware-in-the-loop validation of a web-monitored CAN electric vehicle battery system (ECE capstone).

This repository is a **monitoring prototype**. It does not command contactors, chargers, or emergency disconnects.

## What is implemented

- Dark professional dashboard (HTML/CSS/JS, Chart.js, Socket.IO)
- Node.js + Express REST API and live telemetry
- Simulation mode with labelled simulated data
- Hardware mode: newline-delimited JSON from the CAN receiver over USB serial
- Delay-aware residual observer that will not treat a late CAN frame as a sensor fault
- Software HIL suite with pass/fail and classifier branch / fault-space coverage
- Fault injection lab (simulation only)
- Arduino UNO + MCP2515 transmitter and receiver firmware
- Optional MongoDB history if `MONGO_URI` is set

## Folder structure

```
ev-bms-dashboard/
  server.js                 # HTTP + Socket.IO entry
  src/                      # backend modules
  public/                   # dashboard UI
  firmware/can_transmitter/ # Arduino UNO 1
  firmware/can_receiver/    # Arduino UNO 2 (USB JSON)
  tests/                    # diagnostic unit tests
  docs/                     # protocol and API
```

## Install and run

Requires Node.js 18+.

```bash
cd ev-bms-dashboard
copy .env.example .env
npm install
npm test
npm start
```

Open `http://127.0.0.1:3000` on this machine only. The server binds to `127.0.0.1` by default so the unauthenticated prototype is not published on the LAN.

If you set `BMS_API_TOKEN` in `.env`, send `Authorization: Bearer <token>` on REST calls and `auth: { token }` on Socket.IO.

## Operating modes

Set in `.env`:

| `BMS_MODE`   | Behaviour |
|--------------|-----------|
| `simulation` | Backend generates telemetry. UI shows **SIMULATED DATA**. |
| `hardware`   | Backend reads `SERIAL_PORT` (for example `COM3`) at `SERIAL_BAUD`. Values come from the receiver. Missing fields stay empty. |

Switching modes is an environment change; restart the process after editing `.env`.

## Hardware connections

Architecture: Arduino UNO 1 (CAN TX) → MCP2515 ↔ CANH/CANL ↔ MCP2515 → Arduino UNO 2 (CAN RX) → USB serial → PC.

MCP2515 on each UNO (5 V modules):

| MCP2515 | UNO |
|---------|-----|
| VCC     | 5V  |
| GND     | GND |
| CS      | D10 |
| SI      | D11 |
| SO      | D12 |
| SCK     | D13 |
| INT     | D2  |

Tie CANH to CANH, CANL to CANL. Use 120 Ω termination at both ends if the modules do not already include it. Set `MCP_CLOCK` in firmware to `MCP_8MHZ` or `MCP_16MHZ` to match the crystal on **your** module.

### Sensors

The repo did not include sensor datasheets. Firmware therefore uses **documented analog pins and scale constants** you must calibrate:

| Pin | Default assumption | Disable |
|-----|--------------------|---------|
| A0  | Voltage divider, `V_DIVIDER = 11` (~0–55 V at 5 V ADC) | leave unconnected only after you understand ADC noise |
| A1  | Optional ACS712-style current, mid-rail zero | `#define CURRENT_SENSOR 0` |
| A2  | Optional LM35 10 mV/°C | `#define TEMP_SENSOR 0` |

This lab front-end is **not** a 400 V traction pack measurement. The simulated dashboard pack (~400 V) is for UI/HIL demonstration. Hardware JSON voltages will be whatever your divider actually produces. Recalibrate diagnostic `voltageMin` / `voltageMax` before treating hardware diagnosis as valid.

SoC on the transmitter is an **OCV estimate** from voltage limits `SOC_V_EMPTY` / `SOC_V_FULL`, not coulomb counting.

## Arduino firmware

1. Install Arduino IDE and the **mcp_can** library (coryjfowler).
2. Flash `firmware/can_transmitter/can_transmitter.ino` to UNO 1.
3. Flash `firmware/can_receiver/can_receiver.ino` to UNO 2.
4. Connect UNO 2 USB to the PC. Note the COM port.
5. Set `BMS_MODE=hardware` and `SERIAL_PORT=COMx`, then restart Node.

Receiver serial format: one JSON object per line, 115200 baud. See [docs/CAN_PROTOCOL.md](docs/CAN_PROTOCOL.md).

### Delay measurement (important)

The two UNOs do **not** share a synchronized clock, so TX `millis()` minus RX `millis()` is not one-way CAN delay.

`delayMs` in hardware JSON is **measured inter-arrival excess** on the receiver crystal versus a 200 ms expected period. Packet drops use the 16-bit sequence field. Simulation delay is labelled `simulated`.

## Fault diagnosis assumptions

- Fresh, in-time samples update the voltage residual observer.
- Frames with `delayMs` ≥ `delayWarnMs` **hold** the observer and raise a communication fault. They are not auto-classified as sensor drift.
- Default voltage window `[320, 430] V` matches the **simulated** pack.
- Thresholds are editable in Diagnostics and via `PUT /api/config/thresholds`.

## HIL testing

- **Run software tests** exercises the Node classifier with simulated cases (normal, delay, dropout, drift, overtemp, overvoltage, comm fail). Coverage is software-classifier coverage, not MCU instruction coverage.
- **Physical suite** does not claim coverage unless hardware frames were actually received. Cases without measured data are marked `UNMEASURED`.

## Fault injection lab

Simulation only. The API returns 403 in hardware mode. Injected faults update charts, diagnosis, and the alert center with timestamps.

## API

See [docs/API.md](docs/API.md).

## Safety

- Bind remains loopback unless you change `HOST` (do not expose this prototype publicly).
- No outputs drive contactors, MSDs, or charge enables.
- Treat lab batteries with standard electrical safety practice; this software will not isolate a pack for you.
