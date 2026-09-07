const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const analyzer = require('../audio_analyzer_ffmpeg');
const Judge = require('../judge_engine');

const sampleRate = 22050;
const durationSec = 8;

const profiles = {
  balanced: [[110, 0.35], [900, 0.45], [6500, 0.2]],
  hollow: [[110, 0.55], [7000, 0.45]],
  harsh: [[6000, 0.55], [9000, 0.45]],
  low: [[90, 1]],
  mid: [[1000, 1]]
};

function profileSample(timeSec, profileName){
  return (profiles[profileName] || profiles.balanced)
    .reduce((sum, [freq, weight]) => sum + Math.sin(2 * Math.PI * freq * timeSec) * weight, 0);
}

function makeFixture({
  amp = 0.22,
  profile = 'balanced',
  limiter = false,
  clip = false,
  jump = false,
  dropout = false,
  transition = null
} = {}){
  const samples = new Float32Array(durationSec * sampleRate);
  for(let n = 0; n < samples.length; n++){
    const timeSec = n / sampleRate;
    let value;
    if(transition){
      const before = 'low';
      const after = transition === 'bassOverlap' ? 'low' : 'mid';
      const fade = Math.min(1, Math.max(0, (timeSec - 3.85) / 0.3));
      const beforeGain = timeSec < 4.15 ? 1 - fade : 0;
      const afterGain = timeSec > 3.85 ? fade : 0;
      value = profileSample(timeSec, before) * beforeGain + profileSample(timeSec, after) * afterGain;
    }else{
      value = profileSample(timeSec, profile);
    }

    let gain = amp;
    if(jump && timeSec >= 4) gain *= 4;
    if(dropout && timeSec >= 2.4 && timeSec < 3.5) gain = 0;

    value *= gain;
    if(limiter) value = Math.tanh(value * 7) * 0.96;
    if(clip) value = Math.max(-1, Math.min(1, value * 5));
    samples[n] = value;
  }

  const events = transition ? [{ label: 'transition', idealSec: 4, actualSec: 4 }] : [];
  const audioAnalysis = analyzer.analyzeDecodedAudio({ samples, sampleRate, events });
  const result = Judge.analyzePerformance(events, { audioAnalysis, analyzedAt: '2026-01-01T00:00:00.000Z' });
  return { audioAnalysis, result };
}

function componentScores(result){
  return [
    result.components.gain_consistency,
    result.components.clipping,
    result.components.eq_control,
    result.components.freq_overlap,
    result.components.bass_clash
  ].filter(Number.isFinite);
}

describe('deterministic loudness, clipping, silence, and frequency-balance judge', () => {
  it('scores clean gain above quiet, over-limited, sudden-jump, and dropout fixtures', () => {
    const clean = makeFixture();
    const quiet = makeFixture({ amp: 0.025 });
    const overLimited = makeFixture({ amp: 0.55, limiter: true });
    const jump = makeFixture({ jump: true });
    const dropout = makeFixture({ dropout: true });

    expect(clean.audioAnalysis.session.loudnessMetrics.integratedLoudnessDb).to.be.closeTo(-20.54, 0.1);
    expect(quiet.audioAnalysis.session.loudnessMetrics.quiet).to.equal(true);
    expect(overLimited.audioAnalysis.session.loudnessMetrics.overLimited).to.equal(true);
    expect(jump.audioAnalysis.session.loudnessMetrics.gainJumps.count).to.be.greaterThan(0);
    expect(dropout.audioAnalysis.session.loudnessMetrics.silence.maxDurationSec).to.be.greaterThan(1);

    expect(clean.result.components.gain_consistency).to.be.greaterThan(jump.result.components.gain_consistency);
    expect(jump.result.components.gain_consistency).to.be.greaterThan(quiet.result.components.gain_consistency);
    expect(quiet.result.components.gain_consistency).to.be.greaterThan(dropout.result.components.gain_consistency);
    expect(dropout.result.components.gain_consistency).to.be.greaterThan(overLimited.result.components.gain_consistency);
    expect(dropout.result.componentDetails.gain_consistency.feedback).to.match(/\d+\.\d{3}s-\d+\.\d{3}s/);
  });

  it('penalizes clipping by measured sample count, duration, peak level, and timestamp range', () => {
    const clean = makeFixture();
    const clipped = makeFixture({ amp: 0.28, clip: true });

    expect(clean.audioAnalysis.session.loudnessMetrics.clipping.sampleCount).to.equal(0);
    expect(clipped.audioAnalysis.session.loudnessMetrics.clipping.sampleCount).to.be.greaterThan(10000);
    expect(clipped.audioAnalysis.session.loudnessMetrics.clipping.durationSec).to.be.greaterThan(7);
    expect(clean.result.components.clipping).to.equal(100);
    expect(clipped.result.components.clipping).to.equal(0);
    expect(clipped.result.componentDetails.clipping.feedback).to.match(/0\.\d{3}s-7\.\d{3}s/);
  });

  it('scores balanced EQ above hollow mids and harsh high-frequency imbalance', () => {
    const clean = makeFixture();
    const hollow = makeFixture({ profile: 'hollow' });
    const harsh = makeFixture({ profile: 'harsh' });

    expect(clean.audioAnalysis.session.frequencyBalance.midShare).to.be.greaterThan(0.5);
    expect(hollow.audioAnalysis.session.frequencyBalance.hollowMidPenalty).to.be.greaterThan(0.9);
    expect(harsh.audioAnalysis.session.frequencyBalance.harshHighPenalty).to.equal(1);
    expect(clean.result.components.eq_control).to.equal(100);
    expect(hollow.result.components.eq_control).to.be.lessThan(clean.result.components.eq_control);
    expect(harsh.result.components.eq_control).to.be.lessThan(hollow.result.components.eq_control);
    expect(harsh.result.componentDetails.eq_control.feedback).to.include('harsh highs');
  });

  it('scores excessive bass overlap and transition masking below clean frequency handoff', () => {
    const cleanTransition = makeFixture({ transition: 'clean' });
    const bassOverlap = makeFixture({ transition: 'bassOverlap' });

    expect(cleanTransition.audioAnalysis.perEvent[0].transition.frequency.frequencyMasking).to.be.lessThan(0.25);
    expect(bassOverlap.audioAnalysis.perEvent[0].transition.frequency.frequencyMasking).to.be.greaterThan(0.9);
    expect(cleanTransition.audioAnalysis.perEvent[0].transition.frequency.bassOverlap).to.be.lessThan(0.5);
    expect(bassOverlap.audioAnalysis.perEvent[0].transition.frequency.bassOverlap).to.equal(1);
    expect(cleanTransition.result.components.freq_overlap).to.be.greaterThan(bassOverlap.result.components.freq_overlap);
    expect(cleanTransition.result.components.bass_clash).to.be.greaterThan(bassOverlap.result.components.bass_clash);
    expect(bassOverlap.result.componentDetails.bass_clash.feedback).to.match(/\d+\.\d{3}s-\d+\.\d{3}s/);
    expect(bassOverlap.result.componentDetails.freq_overlap.feedback).to.match(/\d+\.\d{3}s-\d+\.\d{3}s/);
  });

  it('returns bounded and reproducible loudness and EQ scores', () => {
    const first = makeFixture({ transition: 'bassOverlap' });
    const second = makeFixture({ transition: 'bassOverlap' });

    expect(first.audioAnalysis.session.loudnessMetrics).to.deep.equal(second.audioAnalysis.session.loudnessMetrics);
    expect(first.audioAnalysis.session.frequencyBalance).to.deep.equal(second.audioAnalysis.session.frequencyBalance);
    expect(first.result.components).to.deep.equal(second.result.components);
    expect(first.result.componentDetails.gain_consistency).to.deep.equal(second.result.componentDetails.gain_consistency);
    componentScores(first.result).forEach(score => expect(score).to.be.within(0, 100));
  });

  it('marks loudness and frequency scores unavailable without measured audio evidence', () => {
    const result = Judge.analyzePerformance([{ label: 'no-audio' }], { analyzedAt: '2026-01-01T00:00:00.000Z' });

    expect(result.components.gain_consistency).to.equal(null);
    expect(result.components.clipping).to.equal(null);
    expect(result.components.eq_control).to.equal(null);
    expect(result.components.freq_overlap).to.equal(null);
    expect(result.components.bass_clash).to.equal(null);
    expect(result.componentDetails.gain_consistency.reason).to.equal('insufficient_gain_evidence');
    expect(result.componentDetails.eq_control.reason).to.equal('insufficient_eq_evidence');
  });

  it('does not use random, filename-derived, hard-coded-success, or fabricated audio-health scoring', () => {
    const judgeSource = fs.readFileSync(path.join(__dirname, '..', 'judge_engine.js'), 'utf8');
    const analyzerSource = fs.readFileSync(path.join(__dirname, '..', 'audio_analyzer_ffmpeg.js'), 'utf8');
    const fallbackSource = fs.readFileSync(path.join(__dirname, '..', 'audio_analyzer.js'), 'utf8');

    expect(judgeSource).to.not.include('Math.random');
    expect(analyzerSource).to.not.include('Math.random');
    expect(fallbackSource).to.not.include('pseudoRandomFromString');
    expect(fallbackSource).to.include('ffmpeg_required_for_real_audio_analysis');
    expect(judgeSource).to.not.include('hard-coded-success');
  });
});
