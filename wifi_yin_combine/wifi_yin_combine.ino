#include <Arduino.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>

// ─── WiFi ────────────────────────────────────────────────────────
const char* ssid = "ZTE-SN4PTC";
const char* password = "hp65xc92nhd5";

// ─── WebSocket ───────────────────────────────────────────────────
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ─── Audio ───────────────────────────────────────────────────────
#define ADC_PIN 34
#define SAMPLE_RATE 8000
#define BUFFER_SIZE 1024
#define YIN_THRESHOLD 0.15f

// ─── Display ─────────────────────────────────────────────────────
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ─── Globálne buffery ─────────────────────────────────────────────
static int16_t audioBuffer[BUFFER_SIZE];
static float yinBuffer[BUFFER_SIZE / 2];

float lastFreq = 0;
float currentFreq = 0;
String currentNote = "";
int currentOctave = 0;
int currentCentsOff = 0;

const char* noteNames[] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};

// ─── frequencyToNote ─────────────────────────────────────────────
void frequencyToNote(float frequency) {
  float semitonesFromA4 = 12.0 * log2(frequency / 440.0);
  int semitones = round(semitonesFromA4);
  currentCentsOff = round((semitonesFromA4 - semitones) * 100);
  int noteIndex = ((semitones + 9) % 12 + 12) % 12;
  currentNote = noteNames[noteIndex];
  currentOctave = 4 + (int)floor((semitones + 9) / 12.0);
}

// ─── sampleAudio ─────────────────────────────────────────────────
void sampleAudio() {
  uint32_t period = 1000000 / SAMPLE_RATE;
  for (int i = 0; i < BUFFER_SIZE; i++) {
    uint32_t t = micros();
    audioBuffer[i] = (int16_t)(analogRead(ADC_PIN) - 2048);
    while (micros() - t < period);
  }
}

// ─── yinDetect ───────────────────────────────────────────────────
float yinDetect() {
  int halfSize = BUFFER_SIZE / 2;

  for (int tau = 0; tau < halfSize; tau++) {
    yinBuffer[tau] = 0;
    for (int i = 0; i < halfSize; i++) {
      float delta = (float)(audioBuffer[i] - audioBuffer[i + tau]);
      yinBuffer[tau] += delta * delta;
    }
  }

  yinBuffer[0] = 1.0f;
  float runningSum = 0;
  for (int tau = 1; tau < halfSize; tau++) {
    runningSum += yinBuffer[tau];
    yinBuffer[tau] *= (float)tau / runningSum;
  }

  int tau = 2;
  while (tau < halfSize) {
    if (yinBuffer[tau] < YIN_THRESHOLD) {
      while (tau + 1 < halfSize && yinBuffer[tau + 1] < yinBuffer[tau]) tau++;
      float better = tau;
      if (tau > 0 && tau < halfSize - 1) {
        float s0 = yinBuffer[tau - 1];
        float s1 = yinBuffer[tau];
        float s2 = yinBuffer[tau + 1];
        better = tau + (s2 - s0) / (2.0f * (2.0f * s1 - s2 - s0));
      }
      return (float)SAMPLE_RATE / better;
    }
    tau++;
  }
  return -1.0f;
}

// ─── updateDisplay ───────────────────────────────────────────────
void updateDisplay() {
  String line1 = currentNote + String(currentOctave) + "  " + String(currentFreq, 1) + "Hz";
  while (line1.length() < 16) line1 += " ";
  lcd.setCursor(0, 0);
  lcd.print(line1.substring(0, 16));

  String line2;
  if (abs(currentCentsOff) <= 10) {
    line2 = "  << NALADENE >>  ";
  } else if (currentCentsOff > 0) {
    line2 = "  povolit  >>>  ";
  } else {
    line2 = "  <<<  pritiahnut";
  }
  lcd.setCursor(0, 1);
  lcd.print(line2.substring(0, 16));
}

// ─── WebSocket event ─────────────────────────────────────────────
void onWebSocketEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                      AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) Serial.println("Client connected");
  else if (type == WS_EVT_DISCONNECT) Serial.println("Client disconnected");
}

// ─── Setup ───────────────────────────────────────────────────────
void setup() {
  btStop();
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("  Guitar Tuner  ");
  lcd.setCursor(0, 1);
  lcd.print("Connecting WiFi ");

  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    attempts++;
    if (attempts > 20) {
      lcd.setCursor(0, 1);
      lcd.print("  WiFi failed!  ");
      break;
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    String ip = WiFi.localIP().toString();
    lcd.setCursor(0, 1);
    while (ip.length() < 16) ip += " ";
    lcd.print(ip.substring(0, 16));
    Serial.println(WiFi.localIP());
    delay(2000);
  }

  lcd.clear();

  ws.onEvent(onWebSocketEvent);
  server.addHandler(&ws);
  server.begin();
}

// ─── Loop ────────────────────────────────────────────────────────
void loop() {
  ws.cleanupClients();

  sampleAudio();

  float rms = 0;
  for (int i = 0; i < BUFFER_SIZE; i++) {
    rms += (float)audioBuffer[i] * audioBuffer[i];
  }
  rms = sqrt(rms / BUFFER_SIZE);

  if (rms < 80) {
    lastFreq = 0;
    lcd.setCursor(0, 0);
    lcd.print("  Brnkni na     ");
    lcd.setCursor(0, 1);
    lcd.print("  strunu...     ");
    return;
  }

  float freq = yinDetect();

  if (freq > 70 && freq < 1400) {
    if (lastFreq == 0 || freq > lastFreq * 0.4f) {
      lastFreq = freq;
      currentFreq = freq;
      frequencyToNote(freq);
      updateDisplay();

      String json = "{\"note\":\"" + currentNote +
                    "\",\"octave\":" + String(currentOctave) +
                    ",\"frequency\":" + String(currentFreq, 1) +
                    ",\"cents_off\":" + String(currentCentsOff) + "}";
      ws.textAll(json);

      Serial.print(currentNote);
      Serial.print(currentOctave);
      Serial.print(" | ");
      Serial.print(currentFreq, 1);
      Serial.print(" Hz | ");
      Serial.println(currentCentsOff);
    }
  } else {
    lastFreq = 0;
    lcd.setCursor(0, 0);
    lcd.print("                ");
    lcd.setCursor(0, 1);
    lcd.print("-- mimo rozsah--");
  }
}
