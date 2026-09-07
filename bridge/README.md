DJ Battle Bridge — Electron Companion

Run locally to connect your DJ software/hardware to the DJ Battle Platform.

Quick start (dev):

1. Install dependencies

```bash
cd bridge
npm install
```

2. Run the Bridge

```bash
npm start
```

What it does:
- Detects connected MIDI and audio devices
- Runs a short signal test against selected audio input
- Connects to the platform WebSocket (`/bridge`) and sends telemetry/status messages

Next steps:
- Implement adapters (Serato, rekordbox, Traktor) that use vendor SDKs to emit `telemetry` payloads to the server.
- Add persistent authentication and secure pairing with the platform account.
