#include <WiFi.h>
#include <ESPAsyncWebServer.h>

const char* ssid = "ZTE-SN4PTC";
const char* password = "hp65xc92nhd5";

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

const char* noteNames[] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};

void frequencyToNote(float frequency, String &note, int &octave, int &centsOff) {
  // Step 1: how many semitones away from A4 (440Hz)
  float semitonesFromA4 = 12.0 * log2(frequency / 440.0);
  
  // Step 2: round to nearest semitone
  int semitones = round(semitonesFromA4);
  
  // Step 3: cents offset from that nearest semitone
  centsOff = round((semitonesFromA4 - semitones) * 100);
  
  // Step 4: note index (A4 is index 9 in the array, so offset by 9)
  int noteIndex = ((semitones + 9) % 12 + 12) % 12;
  note = noteNames[noteIndex];
  
  // Step 5: octave (A4 = octave 4, so offset accordingly)
  octave = 4 + (int)floor((semitones + 9) / 12.0);
}

void onWebSocketEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                      AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    Serial.println("Client connected");
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.println("Client disconnected");
  }
}

void setup() {
  btStop();

  Serial.begin(115200);
  delay(1000); // give Serial Monitor time to open

  Serial.println("Starting...");
  
  WiFi.begin(ssid, password);
  Serial.println("Connecting to WiFi...");
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    attempts++;
    if (attempts > 20) {
      Serial.println("\nFailed to connect. Check credentials.");
      return;
    }
  }

  Serial.println("\nConnected!");
  Serial.println(WiFi.localIP());
  // rest of setup...

  // Attach the WebSocket to the server
  server.addHandler(&ws);
  // Start the server
  server.begin();
}

void loop() {
  if (Serial.available()) {
    float frequency = Serial.parseFloat();
    if (frequency > 0) {
      String note;
      int octave, centsOff;
      frequencyToNote(frequency, note, octave, centsOff);
      
      String json = "{\"note\":\"" + note + "\",\"octave\":" + octave + ",\"cents_off\":" + centsOff + "}";
      ws.textAll(json);
      Serial.println("Sent: " + json);
    }
  }
}