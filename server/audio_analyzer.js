/*
 * Non-FFmpeg analyzer compatibility shim.
 * Real audio analysis requires audio_analyzer_ffmpeg.js. This module intentionally
 * does not synthesize filename-derived or random metrics.
 */

async function analyzeSessionAudio(){
  return {
    unavailable: true,
    reason: 'ffmpeg_required_for_real_audio_analysis',
    perEvent: [],
    session: {
      durationSec: null,
      bpm: null,
      onsets: [],
      beatTimes: [],
      drift: { available: false },
      transitions: []
    }
  };
}

module.exports = { analyzeSessionAudio };
