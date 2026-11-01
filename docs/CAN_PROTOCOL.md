# CAN communication protocol

Bitrate: **500 kbit/s**, standard 11-bit identifiers. DLC = 8.

## 0x101 Telemetry

| Bytes | Type | Scale |
|-------|------|--------|
| 0–1 | uint16 BE | sequence |
| 2–3 | uint16 BE | voltage × 100 (centivolts) |
| 4–5 | int16 BE | current × 100 (centiamperes, signed) |
| 6 | uint8 | temperature °C + 40 |
| 7 | uint8 | SoC percent 0–100 (OCV estimate on TX) |

## 0x102 Timing (optional companion)

| Bytes | Type | Meaning |
|-------|------|---------|
| 0–1 | uint16 BE | same sequence as 0x101 |
| 2–5 | uint32 BE | TX `millis()` |

Receivers **must not** subtract this timestamp from a different Arduino clock and call it measured one-way delay.

## USB JSON (receiver → Node.js)

Newline-delimited object, 115200 baud. Example:

```json
{"canConnected":true,"canId":"0x101","seq":12,"voltage":16.21,"current":1.04,"temperature":27.5,"soc":88.0,"delayMs":4.2,"delayClass":"measured","drops":0,"rxRateHz":5.01,"interArrivalMs":199.4,"ts":45210,"chargeState":"charging"}
```

`delayClass` is `measured` for receiver inter-arrival excess, `simulated` for the Node simulator, `estimated` only if a future host derives theoretical frame time.
