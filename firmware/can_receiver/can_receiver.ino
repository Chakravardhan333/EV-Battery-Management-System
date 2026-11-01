/*
  VoltScope CAN receiver / USB gateway — Arduino UNO 2 + MCP2515

  Same MCP2515 SPI pinout as the transmitter (CS D10, INT D2).
  USB serial: 115200 baud, newline-delimited JSON to the Node.js backend.

  Delay metric (honest):
    delayMs is the inter-arrival time of 0x101 frames on THIS receiver clock
    minus the expected 200 ms period (clamped >= 0). That is a measured
    scheduling/path delay on one crystal. It is NOT synchronized one-way
    CAN latency, because the two UNOs do not share a clock.

  Dropout metric:
    gaps in the 16-bit sequence field of 0x101.

  Missing analog sensors on the transmitter are still forwarded; the backend
  must not invent replacements. SoC is an OCV estimate computed on the TX node.
*/

#include <SPI.h>
#include <mcp_can.h>

static const int CAN_CS = 10;
static const uint8_t MCP_CLOCK = MCP_8MHZ;
static const unsigned long EXPECTED_PERIOD_US = 200000UL;

MCP_CAN CAN(CAN_CS);

uint16_t lastSeq = 0;
bool haveSeq = false;
uint32_t drops = 0;
unsigned long lastRxUs = 0;
bool haveRx = false;
float lastV = NAN, lastI = NAN, lastT = NAN, lastSoc = NAN;
unsigned long last101Ms = 0;
float rxRate = 0;

void setup() {
  Serial.begin(115200);
  while (CAN.begin(MCP_ANY, CAN_500KBPS, MCP_CLOCK) != CAN_OK) {
    Serial.println(F("{\"canConnected\":false,\"error\":\"can_init\"}"));
    delay(500);
  }
  CAN.setMode(MCP_NORMAL);
}

void loop() {
  unsigned long nowMs = millis();
  if (CAN_MSGAVAIL == CAN.checkReceive()) {
    unsigned long id = 0;
    byte len = 0;
    byte buf[8];
    CAN.readMsgBuf(&id, &len, buf);
    if ((id & 0x7FF) == 0x101 && len >= 8) {
      handle101(buf);
    }
  }

  if (nowMs - last101Ms > 1000) {
    Serial.println(F("{\"canConnected\":false,\"error\":\"can_timeout\"}"));
    last101Ms = nowMs;
  }
}

void handle101(byte *buf) {
  unsigned long nowUs = micros();
  uint16_t seq = (uint16_t)((buf[0] << 8) | buf[1]);
  uint16_t cV = (uint16_t)((buf[2] << 8) | buf[3]);
  int16_t cA = (int16_t)((buf[4] << 8) | buf[5]);
  float tempC = (float)buf[6] - 40.0f;
  float soc = (float)buf[7];
  float voltage = cV / 100.0f;
  float current = cA / 100.0f;

  if (haveSeq) {
    uint16_t expect = lastSeq + 1;
    if (seq != expect) {
      uint16_t gap = (uint16_t)(seq - expect);
      drops += gap;
    }
  }
  lastSeq = seq;
  haveSeq = true;

  long inter = 0;
  float delayMs = 0;
  if (haveRx) {
    inter = (long)(nowUs - lastRxUs);
    if (inter < 0) inter = 0;
    long extra = inter - (long)EXPECTED_PERIOD_US;
    if (extra < 0) extra = 0;
    delayMs = extra / 1000.0f;
    if (inter > 0) rxRate = 1000000.0f / (float)inter;
  }
  lastRxUs = nowUs;
  haveRx = true;
  last101Ms = millis();
  lastV = voltage;
  lastI = current;
  lastT = tempC;
  lastSoc = soc;

  Serial.print(F("{\"canConnected\":true,\"canId\":\"0x101\",\"seq\":"));
  Serial.print(seq);
  Serial.print(F(",\"voltage\":")); Serial.print(voltage, 2);
  Serial.print(F(",\"current\":")); Serial.print(current, 2);
  Serial.print(F(",\"temperature\":")); Serial.print(tempC, 1);
  Serial.print(F(",\"soc\":")); Serial.print(soc, 1);
  Serial.print(F(",\"delayMs\":")); Serial.print(delayMs, 1);
  Serial.print(F(",\"delayClass\":\"measured\""));
  Serial.print(F(",\"drops\":")); Serial.print(drops);
  Serial.print(F(",\"rxRateHz\":")); Serial.print(rxRate, 2);
  Serial.print(F(",\"interArrivalMs\":")); Serial.print(inter / 1000.0f, 1);
  Serial.print(F(",\"ts\":")); Serial.print(millis());
  Serial.print(F(",\"chargeState\":\""));
  if (current > 0.4f) Serial.print(F("charging"));
  else if (current < -0.4f) Serial.print(F("discharging"));
  else Serial.print(F("idle"));
  Serial.println(F("\"}"));
}
