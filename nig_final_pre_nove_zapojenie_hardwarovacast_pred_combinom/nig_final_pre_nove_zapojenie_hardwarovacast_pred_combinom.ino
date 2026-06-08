#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <esp_system.h>
#include <LittleFS.h>

// ─── WiFi ────────────────────────────────────────────────────────
const char* ssid     = "HUAWEI-M4ma-2G";
const char* password = "Ce2cvj3x";

// ─── WebSocket ───────────────────────────────────────────────────
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ─── Audio ───────────────────────────────────────────────────────
#define ADC_PIN       34
#define SAMPLE_RATE   8000
#define BUFFER_SIZE   1024
#define YIN_THRESHOLD 0.15f

// ─── Hardvér GPIO ────────────────────────────────────────────────
#define POT_PIN        35
#define FOOTSWITCH_PIN 32
#define ONOFF_PIN      33

// ─── Potenciometer ───────────────────────────────────────────────
unsigned long lastPotReadTime   = 0;
const unsigned long POT_READ_MS = 50;

int  potStableIndex    = 0;
int  potCandidateIndex = 0;
int  potCandidateCount = 0;
const int POT_CONFIRM  = 2;

unsigned long lastPotChangeTime = 0;
const unsigned long POT_IDLE_MS = 2000;
bool showingTuningSelector      = false;
int  potSelectedIndex           = 0;

// ─── ON/OFF switch ────────────────────────────────────────────────
bool lastSwitchState = true;
unsigned long lastSwitchTime = 0;
const unsigned long SWITCH_DEBOUNCE_MS = 80;

// ─── OLED ────────────────────────────────────────────────────────
#define SCREEN_WIDTH   128
#define SCREEN_HEIGHT   64
#define SCREEN_ADDRESS 0x3C
Adafruit_SH1106G display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// ─── Audio premenné ───────────────────────────────────────────────
static int16_t audioBuffer[BUFFER_SIZE];
static float   yinBuffer[BUFFER_SIZE / 2];

float  lastFreq         = 0;
float  currentFreq      = 0;
String currentNote      = "--";
int    currentOctave    = 0;
int    currentCentsOff  = 0;
int    currentStringNum = 0;

float  idleFreq         = 0;
String idleNote         = "--";
int    idleOctave       = 0;
int    idleCentsOff     = 0;
int    idleStringNum    = 0;

// ─── LADENIA ─────────────────────────────────────────────────────
struct Tuning {
  const char* name;
  float       frequencies[6];
  const char* noteNames[6];
};

const Tuning STANDARD_E = {
  "Standard",
  {82.4f, 110.0f, 146.8f, 196.0f, 246.9f, 329.6f},
  {"E", "A", "D", "G", "B", "e"}
};

const int POT_TUNING_COUNT = 5;
const Tuning potTunings[POT_TUNING_COUNT] = {
  {"Eb Standard", {77.8f, 103.8f, 138.6f, 185.0f, 233.1f, 311.1f}, {"Eb","Ab","Db","Gb","Bb","eb"}},
  {"Drop D",      {73.4f, 110.0f, 146.8f, 196.0f, 246.9f, 329.6f}, {"D", "A", "D", "G", "B", "e" }},
  {"D Standard",  {73.4f,  97.9f, 130.8f, 174.6f, 220.0f, 293.7f}, {"D", "G", "C", "F", "A", "d" }},
  {"Db Standard", {69.3f,  92.5f, 123.5f, 164.8f, 207.7f, 277.2f}, {"Db","Gb","B", "E", "Ab","db"}},
  {"Drop C",      {65.4f,  97.9f, 130.8f, 174.6f, 220.0f, 293.7f}, {"C", "G", "C", "F", "A", "d" }}
};

const Tuning* activeTuning = &STANDARD_E;

// ─── readPotIndex ────────────────────────────────────────────────
int readPotIndex() {
  int raw = analogRead(POT_PIN);
  int idx = (int)((raw / 4096.0f) * POT_TUNING_COUNT);
  if (idx >= POT_TUNING_COUNT) idx = POT_TUNING_COUNT - 1;
  return idx;
}

// ─── frequencyToNote ─────────────────────────────────────────────
void frequencyToNote(float frequency) {
  int bestIndex = 0;

  if      (frequency <  90.0f) bestIndex = 0;
  else if (frequency < 120.0f) bestIndex = 1;
  else if (frequency < 160.0f) bestIndex = 2;
  else if (frequency < 215.0f) bestIndex = 3;
  else if (frequency < 280.0f) bestIndex = 4;
  else                         bestIndex = 5;

  currentStringNum = 6 - bestIndex;
  currentNote      = activeTuning->noteNames[bestIndex];
  float targetFreq = activeTuning->frequencies[bestIndex];

  currentCentsOff  = (int)roundf(1200.0f * log2f(frequency / targetFreq));

  if (currentCentsOff >  50) currentCentsOff =  50;
  if (currentCentsOff < -50) currentCentsOff = -50;

  if      (bestIndex <= 1) currentOctave = 2;
  else if (bestIndex <= 4) currentOctave = 3;
  else                     currentOctave = 4;

  idleFreq      = frequency;
  idleNote      = currentNote;
  idleOctave    = currentOctave;
  idleCentsOff  = currentCentsOff;
  idleStringNum = currentStringNum;
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
      float better = (float)tau;
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

// ─── drawMainInterface ───────────────────────────────────────────
void drawMainInterface(bool isLive) {
  String note   = isLive ? currentNote      : idleNote;
  float  freq   = isLive ? currentFreq      : idleFreq;
  int    cents  = isLive ? currentCentsOff  : idleCentsOff;
  int    strNum = isLive ? currentStringNum : idleStringNum;

  display.clearDisplay();
  display.setTextColor(SH110X_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(activeTuning->name);
  bool isActive = (digitalRead(FOOTSWITCH_PIN) == LOW);
  display.setCursor(104, 0);
  display.print(isActive ? "ACT" : "STD");
  display.drawFastHLine(0, 10, 128, SH110X_WHITE);

  display.setTextSize(3);
  display.setCursor(4, 13);
  display.print(String(strNum) + "." + note);

  display.setTextSize(1);
  display.setCursor(84, 16);
  if (freq > 0) {
    display.print(String(freq, 1) + "Hz");
  } else {
    display.print("--.-Hz");
  }

  const char* statusStr = "";
  if (freq > 0) {
    if      (abs(cents) <= 5) statusStr = "NALADENE";
    else if (cents > 0)       statusStr = "POVOL";
    else                      statusStr = "PRITIAHNUT";
  }
  int statusX = (128 - (int)(strlen(statusStr) * 6)) / 2;
  display.setCursor(statusX, 44);
  display.print(statusStr);

  int centerX = 64;
  int gaugeY  = 61;
  display.drawFastVLine(centerX,      gaugeY - 4, 5, SH110X_WHITE);
  display.drawFastVLine(centerX - 50, gaugeY - 2, 3, SH110X_WHITE);
  display.drawFastVLine(centerX + 50, gaugeY - 2, 3, SH110X_WHITE);
  display.drawFastHLine(centerX - 50, gaugeY, 100,   SH110X_WHITE);

  if (freq > 0) {
    int px = centerX + cents;
    if (abs(cents) <= 5) {
      display.fillRect(px - 3, gaugeY - 5, 7, 7, SH110X_WHITE);
    } else {
      display.fillRect(px - 1, gaugeY - 5, 3, 6, SH110X_WHITE);
    }
  }

  display.display();
}

// ─── drawTuningSelector ──────────────────────────────────────────
void drawTuningSelector() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);
  display.print("Vybrat ladenie:");
  display.drawFastHLine(0, 10, 128, SH110X_WHITE);

  for (int i = 0; i < POT_TUNING_COUNT; i++) {
    int y = 13 + i * 10;
    if (i == potSelectedIndex) {
      display.fillRect(0, y, 128, 10, SH110X_WHITE);
      display.setTextColor(SH110X_BLACK);
      display.setCursor(4, y + 1);
      display.print(potTunings[i].name);
      display.setTextColor(SH110X_WHITE);
    } else {
      display.setCursor(4, y + 1);
      display.print(potTunings[i].name);
    }
  }

  display.display();
}

// ─── drawWaitScreen ──────────────────────────────────────────────
void drawWaitScreen() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(28, 20);
  display.print("Guitar Tuner");
  display.setCursor(10, 38);
  display.print("Switch ON to start");
  display.display();
}

// ─── WebSocket event ─────────────────────────────────────────────
void onWebSocketEvent(AsyncWebSocket* srv, AsyncWebSocketClient* client,
                      AwsEventType type, void* arg, uint8_t* data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    bool isActive = (digitalRead(FOOTSWITCH_PIN) == LOW);
    String initJson = "{\"event\":\"init\",\"tuning_name\":\"" + String(activeTuning->name) +
                      "\",\"active_mode\":" + (isActive ? "true" : "false") + "}";
    client->text(initJson);
  }
  else if (type == WS_EVT_DATA) {
    AwsFrameInfo* info = (AwsFrameInfo*)arg;
    if (info->opcode == WS_TEXT) {
      data[len] = 0;
      String msg = (char*)data;
      if (msg.startsWith("SET_POT_TUNING:")) {
        int idx = msg.substring(15).toInt();
        if (idx >= 0 && idx < POT_TUNING_COUNT) {
          potSelectedIndex = idx;
          potStableIndex   = idx;
          if (digitalRead(FOOTSWITCH_PIN) == LOW)
            activeTuning = &potTunings[potSelectedIndex];
        }
      }
    }
  }
}

// ─── broadcastState ──────────────────────────────────────────────
void broadcastState() {
  bool isActive = (digitalRead(FOOTSWITCH_PIN) == LOW);
  String json = "{\"event\":\"tuning_data\""
                ",\"tuning_name\":\""  + String(activeTuning->name) + "\""
                ",\"active_mode\":"    + (isActive ? "true" : "false") +
                ",\"string_num\":"     + String(currentStringNum) +
                ",\"note\":\""         + currentNote + "\""
                ",\"octave\":"         + String(currentOctave) +
                ",\"frequency\":"      + String(currentFreq, 1) +
                ",\"cents_off\":"      + String(currentCentsOff) + "}";
  ws.textAll(json);
}

// ─── Setup ───────────────────────────────────────────────────────
void setup() {
  btStop();
  Serial.begin(115200);

  pinMode(FOOTSWITCH_PIN, INPUT_PULLUP);
  pinMode(ONOFF_PIN,      INPUT_PULLUP);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  display.begin(SCREEN_ADDRESS, true);

  if (digitalRead(ONOFF_PIN) == HIGH) {
    drawWaitScreen();
    while (digitalRead(ONOFF_PIN) == HIGH) {
      delay(50);
    }
    delay(80);
  }

  lastSwitchState = true;

  display.clearDisplay();
  display.setTextColor(SH110X_WHITE);
  display.setTextSize(1);
  display.setCursor(28, 20);
  display.print("Guitar Tuner");
  display.setCursor(10, 38);
  display.print("Connecting WiFi...");
  display.display();

  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    String ip = WiFi.localIP().toString();
    Serial.println("Connected! IP: " + ip);
    display.clearDisplay();
    display.setCursor(22, 22);
    display.print("WiFi Connected");
    int ipX = (128 - (int)(ip.length() * 6)) / 2;
    if (ipX < 0) ipX = 0;
    display.setCursor(ipX, 38);
    display.print(ip);
    display.display();
    delay(2000);
  } else {
    Serial.println("WiFi Not Connected");
    display.clearDisplay();
    display.setCursor(10, 32);
    display.print("WiFi Not Connected");
    display.display();
    delay(1500);
  }

  // ─── LittleFS ────────────────────────────────────────────────
  if (!LittleFS.begin(false)) {
    Serial.println("LittleFS mount failed");
    return;
  }

  // ─── Routes ──────────────────────────────────────────────────
  server.serveStatic("/", LittleFS, "/").setDefaultFile("gauge.html");

  server.onNotFound([](AsyncWebServerRequest *request){
    request->send(404, "text/plain", "Not found");
  });

  ws.onEvent(onWebSocketEvent);
  server.addHandler(&ws);
  server.begin();

  potStableIndex    = readPotIndex();
  potCandidateIndex = potStableIndex;
  potCandidateCount = POT_CONFIRM;
  potSelectedIndex  = potStableIndex;

  activeTuning = (digitalRead(FOOTSWITCH_PIN) == LOW)
                 ? &potTunings[potSelectedIndex]
                 : &STANDARD_E;

  drawMainInterface(false);
}

// ─── Loop ────────────────────────────────────────────────────────
void loop() {
  ws.cleanupClients();

  bool swReading = (digitalRead(ONOFF_PIN) == LOW);
  if (!swReading && lastSwitchState) {
    if ((millis() - lastSwitchTime) > SWITCH_DEBOUNCE_MS) {
      lastSwitchTime  = millis();
      lastSwitchState = false;
      display.clearDisplay();
      display.display();
      delay(100);
      esp_restart();
    }
  } else if (swReading) {
    lastSwitchState = true;
    lastSwitchTime  = millis();
  }

  if ((millis() - lastPotReadTime) >= POT_READ_MS) {
    lastPotReadTime = millis();
    int newIdx = readPotIndex();

    if (newIdx == potCandidateIndex) {
      potCandidateCount++;
    } else {
      potCandidateIndex = newIdx;
      potCandidateCount = 1;
    }

    if (potCandidateCount >= POT_CONFIRM && newIdx != potStableIndex) {
      potStableIndex    = newIdx;
      potSelectedIndex  = newIdx;
      lastPotChangeTime = millis();
      showingTuningSelector = true;

      if (digitalRead(FOOTSWITCH_PIN) == LOW) {
        activeTuning = &potTunings[potSelectedIndex];
        ws.textAll("{\"event\":\"tuning_changed\",\"tuning_name\":\"" +
                   String(activeTuning->name) + "\"}");
      }
    }
  }

  if (showingTuningSelector && (millis() - lastPotChangeTime > POT_IDLE_MS)) {
    showingTuningSelector = false;
  }

  bool footActive = (digitalRead(FOOTSWITCH_PIN) == LOW);
  const Tuning* desired = footActive ? &potTunings[potSelectedIndex] : &STANDARD_E;
  if (desired != activeTuning) {
    activeTuning = desired;
    ws.textAll("{\"event\":\"tuning_changed\",\"tuning_name\":\"" +
               String(activeTuning->name) + "\"}");
  }

  if (showingTuningSelector) {
    drawTuningSelector();
    return;
  }

  sampleAudio();

  float rms = 0;
  for (int i = 0; i < BUFFER_SIZE; i++)
    rms += (float)audioBuffer[i] * audioBuffer[i];
  rms = sqrtf(rms / BUFFER_SIZE);

  if (rms < 80) {
    lastFreq = 0;
    drawMainInterface(false);
    return;
  }

  float freq = yinDetect();

  if (freq > 60.0f && freq < 1400.0f) {
    if (lastFreq == 0 || freq > lastFreq * 0.4f) {
      lastFreq    = freq;
      currentFreq = freq;
      frequencyToNote(freq);
      drawMainInterface(true);
      broadcastState();
    }
  } else {
    lastFreq = 0;
    drawMainInterface(false);
  }
}