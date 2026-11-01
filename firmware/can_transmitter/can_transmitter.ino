/*
  VoltScope CAN transmitter — Arduino UNO 1 + MCP2515

  Documented hardware (from the capstone architecture; no extra sensor ICs
  were present in the repository):
    MCP2515 CS  -> D10
    MCP2515 SI  -> D11
    MCP2515 SO  -> D12
    MCP2515 SCK -> D13
    MCP2515 INT -> D2
    MCP2515 GND -> GND
    MCP2515 VCC -> 5V
    8 MHz or 16 MHz crystal: set MCP_CLOCK below to match YOUR module.

  Analog front-end (calibrate; do not treat defaults as a 400 V traction pack):
    A0 pack voltage divider (default assumes ~1:11 into 5 V ADC, ~0–55 V range)
    A1 optional current shunt/Hall analog output (set CURRENT_SENSOR 0 if unused)
    A2 optional LM35-style 10 mV/°C temperature (set TEMP_SENSOR 0 if unused)

  Library: "CAN_BUS_SHIELD" / mcp_can by coryjfowler.
  Install via Arduino Library Manager: mcp_can.

  This node never commands contactors, chargers, or disconnects.
*/

#include <SPI.h>
#include <mcp_can.h>

static const int CAN_CS = 10;
static const uint8_t MCP_CLOCK = MCP_8MHZ; /* change to MCP_16MHZ if needed */
static const int PIN_V = A0;
static const int PIN_I = A1;
static const int PIN_T = A2;

#define CURRENT_SENSOR 1
#define TEMP_SENSOR 1

/* ADC 5 V, 10-bit. V_PACK = adc * (5/1023) * DIVIDER */
static const float V_DIVIDER = 11.0f;
static const float I_ZERO_ADC = 512.0f;   /* ACS712-style mid-rail; unused if CURRENT_SENSOR 0 */
static const float I_MV_PER_A = 185.0f; /* 5 A ACS712; ignored if CURRENT_SENSOR 0 */
static const float SOC_V_EMPTY = 12.0f; /* OCV estimate bounds for a small lab pack */
static const float SOC_V_FULL = 16.8f;

MCP_CAN CAN(CAN_CS);
uint16_t seq = 0;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_V, INPUT);
  pinMode(PIN_I, INPUT);
  pinMode(PIN_T, INPUT);

  while (CAN.begin(MCP_ANY, CAN_500KBPS, MCP_CLOCK) != CAN_OK) {
    Serial.println(F("{\"error\":\"can_init\"}"));
    delay(500);
  }
  CAN.setMode(MCP_NORMAL);
}

static int analogMedian(int pin) {
  int a = analogRead(pin);
  int b = analogRead(pin);
  int c = analogRead(pin);
  if (a > b) { int t = a; a = b; b = t; }
  if (b > c) { int t = b; b = c; c = t; }
  if (a > b) { int t = a; a = b; b = t; }
  return b;
}

void loop() {
  seq++;
  int adcV = analogMedian(PIN_V);
  float vSense = adcV * (5.0f / 1023.0f);
  float voltage = vSense * V_DIVIDER;

  float current = 0;
#if CURRENT_SENSOR
  int adcI = analogMedian(PIN_I);
  float vI = adcI * (5.0f / 1023.0f);
  current = ((vI * 1000.0f) - (I_ZERO_ADC * (5000.0f / 1023.0f))) / I_MV_PER_A;
#else
  (void)PIN_I;
#endif

  float tempC = 0;
#if TEMP_SENSOR
  int adcT = analogMedian(PIN_T);
  tempC = (adcT * (5.0f / 1023.0f)) * 100.0f; /* LM35 10 mV/°C */
#else
  (void)PIN_T;
#endif

  float soc = 0;
  if (voltage <= SOC_V_EMPTY) soc = 0;
  else if (voltage >= SOC_V_FULL) soc = 100;
  else soc = (voltage - SOC_V_EMPTY) * 100.0f / (SOC_V_FULL - SOC_V_EMPTY);

  /* Frame 0x101 telemetry: seq, V*100, I*100, temp+40, soc */
  byte d0[8];
  uint16_t cV = (uint16_t)constrain((int)(voltage * 100.0f), 0, 65535);
  int16_t cA = (int16_t)constrain((int)(current * 100.0f), -32768, 32767);
  d0[0] = highByte(seq);
  d0[1] = lowByte(seq);
  d0[2] = highByte(cV);
  d0[3] = lowByte(cV);
  d0[4] = highByte((uint16_t)cA);
  d0[5] = lowByte((uint16_t)cA);
  d0[6] = (byte)constrain((int)(tempC + 40), 0, 255);
  d0[7] = (byte)constrain((int)soc, 0, 100);
  CAN.sendMsgBuf(0x101, 0, 8, d0);

  /* Frame 0x102 timing: seq + local millis (receiver uses inter-arrival, not this clock). */
  unsigned long ms = millis();
  byte d1[8] = { 0 };
  d1[0] = highByte(seq);
  d1[1] = lowByte(seq);
  d1[2] = (byte)(ms >> 24);
  d1[3] = (byte)(ms >> 16);
  d1[4] = (byte)(ms >> 8);
  d1[5] = (byte)ms;
  CAN.sendMsgBuf(0x102, 0, 8, d1);

  delay(200);
}
