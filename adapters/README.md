DJ Battle Platform — Adapter / Plugin Architecture

Purpose
-------
Provide a vendor-neutral, extensible adapter system so integrations for Serato, VirtualDJ, rekordbox, Traktor, djay, Engine/Denon, Pioneer, MIDI controllers, CDJs, DVS and future platforms can be added without changing the core Judge engine.

Layout
------
- adapters/
  - template_adapter.js  (adapter interface example)
  - serato/              (vendor-specific adapter implementations)
  - virtualdj/
  - rekordbox/
  - traktor/
  - midi/
  - audio/

Adapter contract (interface)
----------------------------
Each adapter must export an object with the following minimal methods:

- `init(options)` — initialize and attempt to detect/connect to the vendor APIs/hardware.
- `detect()` — return a promise resolving to `{ available: boolean, telemetry: 'full'|'limited'|'audio-only', devices: {...} }`.
- `onTelemetry(callback)` — register a callback that receives normalized telemetry objects.
- `start()` / `stop()` — begin and end active telemetry streaming.
- `calibrate()` — optional latency calibration routine that returns measured offsets.

Telemetry payloads
------------------
Adapters should emit normalized telemetry objects using this shape:

{
  type: 'telemetry',
  source: 'serato'|'virtualdj'|'midi'|'audio',
  timestamp: 1670000000000, // ms since epoch
  raceId: 'optional-battle-or-session-id',
  deck: 'A'|'B'|'C'|'D'|null,
  event: 'deck_load'|'play'|'pause'|'cue'|'hotcue'|'fader'|'fx'|'loop'|'track_change'|'beat'|'beatgrid'|'key',
  payload: { /* event-specific data */ }
}

Fallbacks
---------
If vendor SDKs do not expose desired data, adapters should gracefully downgrade to MIDI+Audio or Audio Only modes.

Adding new adapters
-------------------
Create a new folder under `adapters/` and implement the interface. Keep adapter logic isolated; communicate with the Bridge and server using the normalized telemetry payloads above.

Data flow
---------
Adapter -> DJ Battle Bridge (local) -> Secure WebSocket -> Server -> Judge Engine -> Battle Timeline

This README provides the minimal contract. See `template_adapter.js` for a simple starting point.

Sample telemetry shapes and examples are available in `adapters/sample_telemetry_examples.md`. Adapters should follow those guidelines for Mode 1 telemetry so the Bridge and server can persist high-fidelity events for the Judge.
