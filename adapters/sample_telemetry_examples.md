Sample Telemetry Shapes — DJ Bridge Adapters

This document provides example payloads/structures that adapters should emit to the DJ Battle Bridge for Mode 1 scoring and high-accuracy judge analysis.

1) Serato-style (software-rich telemetry)
{
  type: 'telemetry',
  userId: 'user-uuid',
  sessionId: 'session-uuid',
  battleId: 'battle-123',
  events: [
    { event: 'deck_load', deck: 'A', trackId: 'abc', timestamp: 1692100000000 },
    { event: 'play', deck: 'A', timestamp: 1692100005000 },
    { event: 'hotcue', deck: 'A', index:2, timestamp: 1692100012000 },
    { event: 'beat', deck:'A', bpm:128, beatIndex:64, timestamp:1692100012345 },
    { event: 'transition_start', deckFrom:'A', deckTo:'B', idealMs:1692100020000, timestamp:1692100020100 }
  ]
}

2) MIDI/controller events (controller moves)
{
  type: 'telemetry', userId:'user', sessionId:'s', events:[
    { event:'fader_move', controller:'X1', channel:1, value:0.34, timestamp:1692100100000 },
    { event:'fx_button', controller:'X1', fx:'filter', state:'on', timestamp:1692100101200 }
  ]
}

3) Audio-only detection (Bridge/Audio adapter detects beats/transitions)
{
  type:'telemetry', userId:'u', sessionId:'s', events:[
    { event:'detected_beat', bpm:127.9, confidence:0.86, timestamp:1692100200000 },
    { event:'detected_transition', idealMs:1692100210000, actualMs:1692100210333, durationMs:450, bpm:128, timestamp:1692100210333 }
  ]
}

Guidelines
- Use ISO ms timestamps (Unix epoch ms) in `timestamp`, `idealMs`, `actualMs` where possible.
- Include `bpm` where known.
- `event` should be one of: deck_load, play, pause, cue, hotcue, loop, loop_exit, beat, beatgrid, transition_start, transition_end, fader_move, xfader_move, eq_move, effect, detected_transition, detected_drop, detected_bpm, detected_phrase
- Keep payload sizes reasonable; bulk-send arrays of events periodically if offline.

Adapters should gracefully degrade: when full SDK telemetry isn't available, send controller/MIDI events and audio-detected events. The server-side processor will aggregate and analyze accordingly.
