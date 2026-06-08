//its working not perfectly but it is - gemini code - treba revizius claudom

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>

// ─── WiFi ────────────────────────────────────────────────────────
const char* ssid = "iPhone";
const char* password = "jarosynek";

// ─── WebSocket ───────────────────────────────────────────────────
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ─── Audio ───────────────────────────────────────────────────────
#define ADC_PIN 34
#define SAMPLE_RATE 8000
#define BUFFER_SIZE 1024
#define YIN_THRESHOLD 0.15f

// ─── Hardware Pushbutton ─────────────────────────────────────────
#define BUTTON_PIN 12      
unsigned long lastDebounceTime = 0;
const unsigned long debounceDelay = 250; 

// ─── OLED Displej (SSD1306, 128x64 px) ───────────────────────────
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1 // Zdieľaný reset pin (nepoužíva sa)
#define SCREEN_ADDRESS 0x3C // Štandardná I2C adresa pre tieto OLEDy

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ─── Globálne buffery a premenné ─────────────────────────────────
static int16_t audioBuffer[BUFFER_SIZE];
static float yinBuffer[BUFFER_SIZE / 2];

float lastFreq = 0;
float currentFreq = 0;
String currentNote = "";
int currentOctave = 0;
int currentCentsOff = 0;
int currentStringNum = 0;

// ─── ŠTRUKTÚRA LADENÍ ─────────────────────────────────────────────
struct Tuning {
  const char* name;
  float frequencies[6]; 
  const char* noteNames[6];
};

int currentTuningIndex = 0; 
const int TOTAL_TUNINGS = 6;

const Tuning tunings[TOTAL_TUNINGS] = {
  {"Standard E", {82.4f, 110.0f, 146.8f, 196.0f, 246.9f, 329.6f}, {"E", "A", "D", "G", "B", "e"}},
  {"Eb Standard", {77.8f, 103.8f, 138.6f, 185.0f, 233.1f, 311.1f}, {"D#", "G#", "C#", "F#", "A#", "d#"}},
  {"Drop D", {73.4f, 110.0f, 146.8f, 196.0f, 246.9f, 329.6f}, {"D", "A", "D", "G", "B", "e"}},
  {"D Standard", {73.4f, 97.9f, 130.8f, 174.6f, 220.0f, 293.7f}, {"D", "G", "C", "F", "A", "d"}},
  {"Dimebag", {75.6f, 100.9f, 134.7f, 179.6f, 226.4f, 302.0f}, {"D", "G", "C", "F", "A", "d"}},
  {"SOAD Drop C", {65.4f, 97.9f, 130.8f, 174.6f, 220.0f, 293.7f}, {"C", "G", "C", "F", "A", "d"}}
};

// ─── Funkcia na zmenu ladenia a informovanie okolia (Sync) ───────
void changeTuning(int newIndex) {
  if (newIndex >= 0 && newIndex < TOTAL_TUNINGS) {
    currentTuningIndex = newIndex;
    
    // Zobrazenie zmeny na OLED
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 10);
    display.println("Ladenie zmenene na:");
    display.setTextSize(2);
    display.setCursor(0, 30);
    display.println(tunings[currentTuningIndex].name);
    display.display();
    
    // Odoslanie synchrónnej správy na WEB
    String syncJson = "{\"event\":\"tuning_changed\",\"tuning_index\":" + String(currentTuningIndex) + 
                      ",\"tuning_name\":\"" + String(tunings[currentTuningIndex].name) + "\"}";
    ws.textAll(syncJson);
    
    Serial.print("Ladenie synchronizovane na: ");
    Serial.println(tunings[currentTuningIndex].name);
    
    delay(1200); 
  }
}

// ─── frequencyToNote ─────────────────────────────────────────────
void frequencyToNote(float frequency) {
  Tuning activeTuning = tunings[currentTuningIndex];
  int bestStringIndex = 0;
  float minDifference = 9999.0f;

  for (int i = 0; i < 6; i++) {
    float diff = abs(frequency - activeTuning.frequencies[i]);
    if (diff < minDifference) {
      minDifference = diff;
      bestStringIndex = i;
    }
  }

  currentStringNum = 6 - bestStringIndex; 
  currentNote = activeTuning.noteNames[bestStringIndex];
  
  float targetFreq = activeTuning.frequencies[bestStringIndex];
  currentCentsOff = round(1200.0f * log2(frequency / targetFreq));

  // Obmedzíme rozsah centov na -50 až +50 pre vykresľovanie na stupnici
  if (currentCentsOff > 50) currentCentsOff = 50;
  if (currentCentsOff < -50) currentCentsOff = -50;

  if (bestStringIndex <= 1) currentOctave = 2;
  else if (bestStringIndex <= 4) currentOctave = 3;
  else currentOctave = 4;
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

// ─── updateDisplay (NOVÁ GRAFICKÁ VERZIA PRE OLED) ────────────────
void updateDisplay() {
  display.clearDisplay();

  // 1. Horný riadok: Aktuálne ladenie
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print(tunings[currentTuningIndex].name);
  
  // Frekvencia vpravo hore
  display.setCursor(85, 0);
  display.print(String(currentFreq, 1) + "Hz");

  // Čiara pod horným menu
  display.drawFastHLine(0, 11, 128, SSD1306_WHITE);

  // 2. Stredná časť: Veľká struna a tón
  display.setTextSize(3);
  display.setCursor(15, 20);
  display.print(String(currentStringNum) + "." + currentNote);

  // Stav ladenia textovo slovne
  display.setTextSize(1);
  display.setCursor(80, 26);
  if (abs(currentCentsOff) <= 5) {
    display.print("OK");
  } else if (currentCentsOff > 0) {
    display.print("POVOL");
  } else {
    display.print("PRITIAH");
  }

  // 3. Spodná časť: Grafická ladiaca ručička (Stupnica od -50 do +50 centov)
  // Stred stupnice je na pixeli 64. Rozsah stupnice bude široký 100 pixelov (od 14 do 114)
  int centerX = 64;
  int gaugeY = 56;
  
  // Vykreslenie rysiek stupnice (ľavá, stredná, pravá)
  display.drawFastVLine(centerX, gaugeY - 4, 5, SSD1306_WHITE);      // Stred
  display.drawFastVLine(centerX - 50, gaugeY - 2, 3, SSD1306_WHITE); // -50 centov
  display.drawFastVLine(centerX + 50, gaugeY - 2, 3, SSD1306_WHITE); // +50 centov
  display.drawFastHLine(centerX - 50, gaugeY, 100, SSD1306_WHITE);   // Hlavná horizontálna os

  // Výpočet pozície "ručičky" na základe odchýlky (1 cent = 1 pixel smerom od stredu)
  int pointerX = centerX + currentCentsOff;
  
  // Ak je naladené, nakreslíme hrubší stredový štvorček, ak nie, tak len čiarku (ručičku)
  if (abs(currentCentsOff) <= 5) {
    display.fillRect(pointerX - 2, gaugeY - 5, 5, 6, SSD1306_WHITE);
  } else {
    display.fillRect(pointerX, gaugeY - 5, 2, 6, SSD1306_WHITE);
  }

  display.display();
}

// ─── WebSocket event ─────────────────────────────────────────────
void onWebSocketEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                      AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    Serial.println("Client connected");
    String initJson = "{\"event\":\"tuning_changed\",\"tuning_index\":" + String(currentTuningIndex) + 
                      ",\"tuning_name\":\"" + String(tunings[currentTuningIndex].name) + "\"}";
    client->text(initJson);
  }
  else if (type == WS_EVT_DISCONNECT) {
    Serial.println("Client disconnected");
  }
  else if (type == WS_EVT_DATA) {
    AwsFrameInfo *info = (AwsFrameInfo*)arg;
    if (info->opcode == WS_TEXT) {
      data[len] = 0;
      String msg = (char*)data;
      if (msg.startsWith("SET_TUNING:")) {
        int newTuning = msg.substring(11).toInt();
        changeTuning(newTuning); 
      }
    }
  }
}

// ─── Setup ───────────────────────────────────────────────────────
void setup() {
  btStop();
  Serial.begin(115200);
  
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  // Inicializácia I2C a OLED Displeja
  if(!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println(F("SSD1306 allocation failed"));
    for(;;); // Ak nenašlo displej, zastav program
  }
  
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(10, 15);
  display.println("  GUITAR TUNER  ");
  display.setCursor(10, 35);
  display.println("Connecting WiFi...");
  display.display();

  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    attempts++;
    if (attempts > 20) {
      display.setCursor(10, 50);
      display.println("WiFi FAILED!");
      display.display();
      break;
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    display.clearDisplay();
    display.setCursor(10, 20);
    display.println("WiFi Connected!");
    display.setCursor(10, 40);
    display.println(WiFi.localIP().toString());
    display.display();
    Serial.println(WiFi.localIP());
    delay(2000);
  }

  display.clearDisplay();
  ws.onEvent(onWebSocketEvent);
  server.addHandler(&ws);
  server.begin();
}

// ─── Loop ────────────────────────────────────────────────────────
void loop() {
  ws.cleanupClients();

  // 1. KONTROLA HARDVÉROVÉHO TLAČIDLA
  if (digitalRead(BUTTON_PIN) == LOW) {
    if ((millis() - lastDebounceTime) > debounceDelay) {
      int nextTuning = (currentTuningIndex + 1) % TOTAL_TUNINGS;
      lastDebounceTime = millis();
      changeTuning(nextTuning); 
    }
  }

  // 2. MERANIE A ANALÝZA ZVUKU
  sampleAudio();

  float rms = 0;
  for (int i = 0; i < BUFFER_SIZE; i++) {
    rms += (float)audioBuffer[i] * audioBuffer[i];
  }
  rms = sqrt(rms / BUFFER_SIZE);

  if (rms < 80) {
    lastFreq = 0;
    
    // Obrazovka v tichu: Zobrazuje názov aktuálneho vybraného ladenia a pokyn
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.print("Rezim: " + String(tunings[currentTuningIndex].name));
    display.drawFastHLine(0, 11, 128, SSD1306_WHITE);
    
    display.setTextSize(1.5);
    display.setCursor(16, 32);
    display.print("Brnkni na strunu");
    display.display();
    return;
  }

  float freq = yinDetect();

  if (freq > 60 && freq < 1400) {
    if (lastFreq == 0 || freq > lastFreq * 0.4f) {
      lastFreq = freq;
      currentFreq = freq;
      frequencyToNote(freq);
      updateDisplay(); // Volá novú grafickú funkciu

      String json = "{\"event\":\"tuning_data\",\"tuning_name\":\"" + String(tunings[currentTuningIndex].name) +
                    "\",\"string_num\":" + String(currentStringNum) +
                    ",\"note\":\"" + currentNote +
                    "\",\"octave\":" + String(currentOctave) +
                    ",\"frequency\":" + String(currentFreq, 1) +
                    ",\"cents_off\":" + String(currentCentsOff) + "}";
      ws.textAll(json);
    }
  } else {
    lastFreq = 0;
    display.clearDisplay();
    display.setCursor(15, 30);
    display.setTextSize(1);
    display.print("- mimo rozsah -");
    display.display();
  }
}