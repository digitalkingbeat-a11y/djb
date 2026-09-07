const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const analyzer = require('../audio_analyzer_ffmpeg');
const Judge = require('../judge_engine');

const defaultSampleRate = analyzer.DEFAULT_SAMPLE_RATE;

function addClick(samples, sampleRate, timeSec, amplitude = 0.92){
  const center = Math.round(timeSec * sampleRate);
  for(let offset = -2; offset <= 2; offset++){
    const index = center + offset;
    if(index >= 0 && index < samples.length) samples[index] = Math.max(samples[index], amplitude);
  }
}

function transitionFixture({
  bpm = 123,
  offsetMs = 0,
  durationSec = 8,
  driftEndBpm = null,
  eventBeats = null,
  abrupt = false,
  transitionBeat = 8,
  offsetForBeat = null,
  skipBeats = [],
  phraseLengthBeats = null,
  sampleRate = defaultSampleRate
} = {}){
  const samples = new Float32Array(Math.ceil(durationSec * sampleRate));
  const baseInterval = 60 / bpm;
  const transitionSec = transitionBeat * baseInterval;
  const skipped = new Set(skipBeats);

  for(let n = 0; n < samples.length; n++){
    const t = n / sampleRate;
    const after = t >= transitionSec;
    const amp = abrupt && after ? 0.42 : 0.08;
    const freq = abrupt && after ? 1320 : 440;
    samples[n] = Math.sin(2 * Math.PI * freq * t) * amp;
  }

  const idealBeats = [];
  for(let beat = 0; beat * baseInterval < durationSec; beat++) idealBeats.push(beat);

  let actualTime = offsetMs / 1000;
  const actualTimesByBeat = new Map();
  for(const beat of idealBeats){
    let clickTime;
    if(driftEndBpm){
      if(beat === 0){
        clickTime = actualTime;
      }else{
        const progress = beat / Math.max(1, idealBeats.length - 1);
        const currentBpm = bpm + (driftEndBpm - bpm) * progress;
        actualTime += 60 / currentBpm;
        clickTime = actualTime;
      }
    }else{
      clickTime = beat * baseInterval + offsetMs / 1000;
    }
    if(typeof offsetForBeat === 'function') clickTime += offsetForBeat(beat, baseInterval);
    actualTimesByBeat.set(beat, clickTime);
    if(!skipped.has(beat) && clickTime >= 0 && clickTime < durationSec){
      const accent = phraseLengthBeats && beat % phraseLengthBeats === 0;
      addClick(samples, sampleRate, clickTime, accent ? 0.98 : 0.62);
    }
  }

  const beatsForEvents = eventBeats || idealBeats.slice(1, Math.min(13, idealBeats.length));
  const events = beatsForEvents
    .map(beat => ({ label: `transition-${beat}`, idealSec: beat * baseInterval, actualSec: actualTimesByBeat.get(beat) }))
    .filter(event => event.idealSec < durationSec);
  return { samples, events, sampleRate };
}

function judgeFixture(options){
  const fixture = transitionFixture(options);
  const audioAnalysis = analyzer.analyzeDecodedAudio({
    samples: fixture.samples,
    sampleRate: fixture.sampleRate,
    events: fixture.events
  });
  const result = Judge.analyzePerformance(fixture.events, { audioAnalysis, analyzedAt: '2026-01-01T00:00:00.000Z' });
  return { audioAnalysis, result };
}

function numericComponents(result){
  return Object.values(result.components).filter(Number.isFinite);
}

describe('deterministic real-audio judge integration', () => {
  it('scores timing offsets monotonically from measured onset evidence', () => {
    const offsets = [0, 20, 50, 100, 250];
    const measured = offsets.map(offsetMs => {
      const judged = judgeFixture({ offsetMs });
      return {
        offsetMs,
        measuredAvgOffset: judged.result.componentDetails.timing.measurements.averageAbsOffsetMs,
        score: judged.result.components.timing,
        recommendation: judged.result.recommendations.join(' ')
      };
    });

    expect(measured.map(item => item.measuredAvgOffset)).to.deep.equal([0, 20, 50, 100, 250]);
    for(let i = 1; i < measured.length; i++){
      expect(measured[i].score).to.be.at.most(measured[i - 1].score);
    }
    expect(measured[0].score).to.equal(100);
    expect(measured[4].score).to.equal(0);
    expect(measured[4].recommendation).to.include('Timing needs work');
  });

  it('penalizes constant phase offsets with shared reference alignment', () => {
    const offsets = [0, 20, 50, 100, 250];
    const measured = offsets.map(offsetMs => {
      const judged = judgeFixture({ offsetMs });
      return {
        offsetMs,
        initialPhaseOffsetMs: judged.audioAnalysis.session.alignment.initialPhaseOffsetMs,
        accumulatedDriftMs: judged.audioAnalysis.session.alignment.accumulatedDriftMs,
        localDeviationMs: judged.audioAnalysis.session.alignment.averageAbsLocalDeviationMs,
        score: judged.result.components.beat_alignment
      };
    });

    expect(measured.map(item => item.initialPhaseOffsetMs)).to.deep.equal([0, 20, 50, 100, 250]);
    measured.forEach(item => {
      expect(item.accumulatedDriftMs).to.equal(0);
      expect(item.localDeviationMs).to.equal(0);
    });
    for(let i = 1; i < measured.length; i++){
      expect(measured[i].score).to.be.at.most(measured[i - 1].score);
    }
    expect(measured[0].score).to.equal(100);
    expect(measured[4].score).to.be.lessThan(70);
  });

  it('separates progressive drift from local beat deviation', () => {
    const stable = judgeFixture({ offsetMs: 0 });
    const drifting = judgeFixture({ offsetMs: 0, driftEndBpm: 140 });

    expect(stable.audioAnalysis.session.alignment.accumulatedDriftMs).to.equal(0);
    expect(Math.abs(drifting.audioAnalysis.session.alignment.accumulatedDriftMs)).to.be.greaterThan(250);
    expect(drifting.audioAnalysis.session.alignment.averageAbsLocalDeviationMs).to.be.lessThan(Math.abs(drifting.audioAnalysis.session.alignment.accumulatedDriftMs));
    expect(stable.result.components.beat_alignment).to.be.greaterThan(drifting.result.components.beat_alignment);
    expect(drifting.result.recommendations.join(' ')).to.include('Beatmatching needs work');
  });

  it('detects sudden slips, dropped or extra beats, and timestamped defect ranges', () => {
    const slipped = judgeFixture({
      durationSec: 12,
      eventBeats: [4, 8, 12, 16, 20],
      offsetForBeat: (beat, beatInterval) => (beat >= 8 ? beatInterval : 0)
    });

    const alignment = slipped.audioAnalysis.session.alignment;
    expect(alignment.droppedBeats).to.be.greaterThan(0);
    expect(alignment.defectRanges[0].type).to.equal('dropped_or_extra_beat');
    expect(alignment.defectRanges[0].startSec).to.be.a('number');
    expect(slipped.result.componentDetails.beat_alignment.feedback).to.match(/\d+\.\d{3}s-\d+\.\d{3}s/);
    expect(slipped.result.recommendations.join(' ')).to.include('Beatmatching needs work');
  });

  it('scores corrected transitions above unrecovered temporary loss of sync', () => {
    const persistentSlip = judgeFixture({
      durationSec: 12,
      eventBeats: [4, 8, 12, 16, 20],
      offsetForBeat: beat => (beat >= 8 ? 0.18 : 0)
    });
    const corrected = judgeFixture({
      durationSec: 12,
      eventBeats: [4, 8, 12, 16, 20],
      offsetForBeat: beat => (beat >= 8 && beat <= 12 ? 0.18 : 0)
    });

    expect(persistentSlip.audioAnalysis.session.alignment.recovered).to.equal(false);
    expect(corrected.audioAnalysis.session.alignment.recovered).to.equal(true);
    expect(corrected.result.components.beat_alignment).to.be.greaterThan(persistentSlip.result.components.beat_alignment);
    expect(corrected.result.componentDetails.beat_alignment.feedback).to.include('recovered');
  });

  it('infers 4, 8, 16, and 32 bar phrase boundaries from onset energy accents', () => {
    [16, 32, 64, 128].forEach(phraseLengthBeats => {
      const bpm = 174;
      const beatInterval = 60 / bpm;
      const phraseFixture = judgeFixture({
        bpm,
        sampleRate: 8000,
        durationSec: (phraseLengthBeats * 2 + 4) * beatInterval,
        phraseLengthBeats,
        eventBeats: [phraseLengthBeats, phraseLengthBeats * 2]
      });

      expect(phraseFixture.audioAnalysis.session.phrase.available).to.equal(true);
      expect(phraseFixture.audioAnalysis.session.phrase.phraseLengthBeats).to.equal(phraseLengthBeats);
      expect(phraseFixture.result.components.phrasing).to.equal(100);
    });
  });

  it('uses documented 4-bar phrase fallback when accent evidence is insufficient', () => {
    const aligned = judgeFixture({ durationSec: 18, eventBeats: [16, 32] });
    const misaligned = judgeFixture({ durationSec: 18, eventBeats: [8, 24] });

    expect(aligned.audioAnalysis.session.phrase.fallback).to.equal(true);
    expect(aligned.audioAnalysis.session.phrase.phraseLengthBeats).to.equal(16);
    expect(aligned.result.componentDetails.phrasing.measurements.phraseEvidence).to.equal('fallback_4_bar');
    expect(aligned.result.components.phrasing).to.be.greaterThan(misaligned.result.components.phrasing);
    expect(misaligned.result.components.phrasing).to.equal(0);
  });

  it('calibrates transition sharpness from energy-envelope and spectral-change evidence', () => {
    const clean = judgeFixture({ eventBeats: [8], abrupt: false });
    const abrupt = judgeFixture({ eventBeats: [8], abrupt: true });

    expect(clean.result.componentDetails.transition_quality.measurements.averageAbruptness).to.be.lessThan(0.1);
    expect(abrupt.result.componentDetails.transition_quality.measurements.averageAbruptness).to.be.greaterThan(0.3);
    expect(abrupt.result.componentDetails.transition_quality.measurements.averageSpectralChange).to.be.greaterThan(clean.result.componentDetails.transition_quality.measurements.averageSpectralChange);
    expect(clean.result.components.transition_quality).to.be.greaterThan(abrupt.result.components.transition_quality);
    expect(abrupt.result.componentDetails.transition_quality.feedback).to.match(/\d+\.\d{3}s-\d+\.\d{3}s/);
  });

  it('returns bounded and reproducible scoring output', () => {
    const first = judgeFixture({ offsetMs: 50, durationSec: 18, eventBeats: [16, 32] });
    const second = judgeFixture({ offsetMs: 50, durationSec: 18, eventBeats: [16, 32] });

    expect(first.result.components).to.deep.equal(second.result.components);
    expect(first.result.componentDetails).to.deep.equal(second.result.componentDetails);
    expect(first.result.timeline).to.deep.equal(second.result.timeline);
    numericComponents(first.result).forEach(score => expect(score).to.be.within(0, 100));
    expect(first.result.overallScore).to.be.within(0, 100);
  });

  it('marks scores unavailable when measured evidence is missing', () => {
    const result = Judge.analyzePerformance([{ label: 'transition' }], { analyzedAt: '2026-01-01T00:00:00.000Z' });
    expect(result.overallScore).to.equal(null);
    expect(result.components.timing).to.equal(null);
    expect(result.componentDetails.timing.reason).to.equal('insufficient_timing_evidence');
    expect(result.recommendations.join(' ')).to.include('Timing score unavailable');
  });

  it('does not use random, filename-derived, or fallback fabricated judge scoring', () => {
    const judgeSource = fs.readFileSync(path.join(__dirname, '..', 'judge_engine.js'), 'utf8');
    const fallbackSource = fs.readFileSync(path.join(__dirname, '..', 'audio_analyzer.js'), 'utf8');
    expect(judgeSource).to.not.include('Math.random');
    expect(judgeSource).to.not.include('return 75');
    expect(fallbackSource).to.not.include('pseudoRandomFromString');
    expect(fallbackSource).to.include('ffmpeg_required_for_real_audio_analysis');
  });
});
