const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const analyzer = require('../audio_analyzer_ffmpeg');
const Judge = require('../judge_engine');
const { getFFmpegCapability, publicFFmpegCapabilityStatus } = require('../ffmpeg_capability');

const integrationEnabled = process.env.RUN_FFMPEG_INTEGRATION === '1';
const describeIntegration = integrationEnabled ? describe : describe.skip;

function writeClickWav(filePath, bpm = 128, durationSec = 8, sampleRate = 44100, options = {}){
  const beatSecs = 60 / bpm;
  const offsetSec = Number(options.offsetMs || 0) / 1000;
  const transitionSec = Number(options.transitionBeat || 8) * beatSecs;
  const samples = durationSec * sampleRate;
  const buffer = Buffer.alloc(samples * 2);

  for(let n = 0; n < samples; n++){
    const t = n / sampleRate;
    const shifted = t - offsetSec;
    const near = shifted >= 0 ? Math.abs((shifted / beatSecs) - Math.round(shifted / beatSecs)) : Infinity;
    let val = 0;
    if(near < (1 / sampleRate) * 3 / beatSecs) val = 30000;
    const abrupt = options.abrupt && t >= transitionSec;
    const sine = Math.round(Math.sin(2 * Math.PI * (abrupt ? 880 : 440) * t) * (abrupt ? 12000 : 800));
    const out = Math.max(-32767, Math.min(32767, val + sine));
    buffer.writeInt16LE(out, n * 2);
  }

  const header = Buffer.alloc(44 + buffer.length);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + buffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(buffer.length, 40);
  buffer.copy(header, 44);
  fs.writeFileSync(filePath, header);
}

describeIntegration('FFmpeg integration probe', function(){
  const dir = path.join(__dirname, '..', 'tmp');
  const fixtureBpms = [80, 100, 123, 128, 140, 174];
  const fixturePaths = fixtureBpms.map(bpm => path.join(dir, `ffmpeg_click_${bpm}.wav`));
  const judgeOffsets = [0, 20, 50, 100, 250];
  const judgePaths = judgeOffsets.map(offset => path.join(dir, `ffmpeg_offset_${offset}.wav`));
  let capability;

  before(function(){
    capability = getFFmpegCapability();
    if(!capability.available){
      console.warn('FFmpeg integration skipped', publicFFmpegCapabilityStatus(capability));
      this.skip();
    }
    fs.mkdirSync(dir, { recursive: true });
  });

  after(function(){
    for(const wav of fixturePaths.concat(judgePaths)){
      try{
        if(fs.existsSync(wav)) fs.unlinkSync(wav);
      }catch(err){
        // Best-effort cleanup for the opt-in integration probe.
      }
    }
  });

  it('decodes click-track WAV fixtures and reports analyzer metrics', async function(){
    this.timeout(60000);
    const duration = 8;
    const metrics = [];
    const failures = [];

    for(const bpm of fixtureBpms){
      const wav = path.join(dir, `ffmpeg_click_${bpm}.wav`);
      const start = Date.now();
      try{
        writeClickWav(wav, bpm, duration);
        const events = [];
        for(let i = 0; i < Math.floor(duration * bpm / 60); i++){
          events.push({ actualSec: i * (60 / bpm) });
        }

        const res = await analyzer.analyzeSessionAudio({ audioPath: wav, events });
        const elapsedMs = Date.now() - start;
        const metric = {
          expectedBpm: bpm,
          measuredBpm: res.session.bpm,
          onsetCount: res.session.onsets.length,
          firstOnsets: res.session.onsets.slice(0, 5),
          integratedLoudnessDb: res.session.loudnessMetrics && res.session.loudnessMetrics.integratedLoudnessDb,
          peakLevelDb: res.session.loudnessMetrics && res.session.loudnessMetrics.peakLevelDb,
          clippingSamples: res.session.loudnessMetrics && res.session.loudnessMetrics.clipping.sampleCount,
          lowMidHigh: res.session.frequencyBalance && {
            low: res.session.frequencyBalance.lowShare,
            mid: res.session.frequencyBalance.midShare,
            high: res.session.frequencyBalance.highShare
          },
          harmonic: res.session.harmonic && {
            available: res.session.harmonic.available,
            key: res.session.harmonic.key && res.session.harmonic.key.name,
            confidence: res.session.harmonic.confidence,
            reason: res.session.harmonic.reason
          },
          avgFreqOverlap: res.session.avgFreqOverlap,
          clipRatio: res.session.clipRatio,
          elapsedMs
        };
        metrics.push(metric);

        if(res.perEvent.length !== events.length) failures.push(`${bpm}: expected ${events.length} per-event rows, got ${res.perEvent.length}`);
        if(!res.session.bpm || Math.abs(res.session.bpm - bpm) > 3) failures.push(`${bpm}: measured ${res.session.bpm}`);
        if(elapsedMs > 10000) failures.push(`${bpm}: elapsed ${elapsedMs}ms`);
      }finally{
        try{
          if(fs.existsSync(wav)) fs.unlinkSync(wav);
        }catch(err){
          failures.push(`${bpm}: cleanup failed`);
        }
      }
    }

    console.log(JSON.stringify({
      capability: publicFFmpegCapabilityStatus(capability),
      fixtures: metrics
    }, null, 2));

    const leftovers = fixturePaths.filter(filePath => fs.existsSync(filePath));
    expect(leftovers).to.deep.equal([]);
    expect(failures).to.deep.equal([]);
  });

  it('feeds decoded timing offsets into deterministic judge metrics', async function(){
    this.timeout(60000);
    const bpm = 123;
    const duration = 8;
    const beatSec = 60 / bpm;
    const metrics = [];
    const failures = [];

    for(const offsetMs of judgeOffsets){
      const wav = path.join(dir, `ffmpeg_offset_${offsetMs}.wav`);
      const start = Date.now();
      try{
        writeClickWav(wav, bpm, duration, 44100, { offsetMs });
        const events = [];
        for(let beat = 1; beat < Math.floor(duration / beatSec); beat++){
          const idealSec = beat * beatSec;
          events.push({ label: `beat-${beat}`, idealSec, actualSec: idealSec + offsetMs / 1000 });
        }
        const audioAnalysis = await analyzer.analyzeSessionAudio({ audioPath: wav, events });
        const result = Judge.analyzePerformance(events, { audioAnalysis, analyzedAt: '2026-01-01T00:00:00.000Z' });
        const elapsedMs = Date.now() - start;
        metrics.push({
          offsetMs,
          measuredBpm: audioAnalysis.session.bpm,
          onsetCount: audioAnalysis.session.onsets.length,
          averageAbsOffsetMs: result.componentDetails.timing.measurements.averageAbsOffsetMs,
          initialPhaseOffsetMs: result.componentDetails.beat_alignment.measurements.initialPhaseOffsetMs,
          accumulatedDriftMs: result.componentDetails.beat_alignment.measurements.accumulatedDriftMs,
          averageAbsLocalDeviationMs: result.componentDetails.beat_alignment.measurements.averageAbsLocalDeviationMs,
          timingScore: result.components.timing,
          beatAlignmentScore: result.components.beat_alignment,
          gainScore: result.components.gain_consistency,
          clippingScore: result.components.clipping,
          eqScore: result.components.eq_control,
          harmonicScore: result.components.harmonic_compatibility,
          harmonicReason: result.componentDetails.harmonic_compatibility.reason,
          elapsedMs
        });
        if(Math.abs(result.componentDetails.timing.measurements.averageAbsOffsetMs - offsetMs) > 3) failures.push(`${offsetMs}: measured offset ${result.componentDetails.timing.measurements.averageAbsOffsetMs}`);
        if(Math.abs(result.componentDetails.beat_alignment.measurements.initialPhaseOffsetMs - offsetMs) > 3) failures.push(`${offsetMs}: measured phase ${result.componentDetails.beat_alignment.measurements.initialPhaseOffsetMs}`);
        if(elapsedMs > 10000) failures.push(`${offsetMs}: elapsed ${elapsedMs}ms`);
      }finally{
        try{
          if(fs.existsSync(wav)) fs.unlinkSync(wav);
        }catch(err){
          failures.push(`${offsetMs}: cleanup failed`);
        }
      }
    }

    for(let i = 1; i < metrics.length; i++){
      if(metrics[i].timingScore > metrics[i - 1].timingScore) failures.push(`${metrics[i].offsetMs}: non-monotonic timing score`);
      if(metrics[i].beatAlignmentScore > metrics[i - 1].beatAlignmentScore) failures.push(`${metrics[i].offsetMs}: non-monotonic beat alignment score`);
    }

    console.log(JSON.stringify({
      capability: publicFFmpegCapabilityStatus(capability),
      judgeFixtures: metrics
    }, null, 2));

    const leftovers = judgePaths.filter(filePath => fs.existsSync(filePath));
    expect(leftovers).to.deep.equal([]);
    expect(failures).to.deep.equal([]);
  });
});
