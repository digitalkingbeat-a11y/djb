const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const analyzer = require('../audio_analyzer_ffmpeg');
const Judge = require('../judge_engine');

const sampleRate = 22050;
const durationSec = 4;
const pitchNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function frequencyForPitchClass(pc, octave = 4){
  const midi = 60 + pc + (octave - 4) * 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function chordValue(timeSec, rootPc, mode){
  const degrees = mode === 'major' ? [0, 4, 7] : [0, 3, 7];
  let value = 0;
  degrees.forEach(degree => {
    const pc = (rootPc + degree) % 12;
    value += Math.sin(2 * Math.PI * frequencyForPitchClass(pc, 4) * timeSec) * 0.33;
    value += Math.sin(2 * Math.PI * frequencyForPitchClass(pc, 5) * timeSec) * 0.12;
  });
  return value;
}

function makeKeySamples(rootPc, mode, duration = durationSec){
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  for(let n = 0; n < samples.length; n++){
    const timeSec = n / sampleRate;
    samples[n] = chordValue(timeSec, rootPc, mode) * 0.35;
  }
  return samples;
}

function makeTransitionSamples(outRoot, outMode, inRoot, inMode){
  const samples = new Float32Array(8 * sampleRate);
  for(let n = 0; n < samples.length; n++){
    const timeSec = n / sampleRate;
    const fade = Math.min(1, Math.max(0, (timeSec - 3.7) / 0.6));
    const outgoing = timeSec < 4.3 ? 1 - fade : 0;
    const incoming = timeSec > 3.7 ? fade : 0;
    samples[n] = (chordValue(timeSec, outRoot, outMode) * outgoing + chordValue(timeSec, inRoot, inMode) * incoming) * 0.35;
  }
  return samples;
}

function judgeTransition(outRoot, outMode, inRoot, inMode){
  const events = [{ label: 'transition', idealSec: 4, actualSec: 4 }];
  const audioAnalysis = analyzer.analyzeDecodedAudio({
    samples: makeTransitionSamples(outRoot, outMode, inRoot, inMode),
    sampleRate,
    events
  });
  const result = Judge.analyzePerformance(events, { audioAnalysis, analyzedAt: '2026-01-01T00:00:00.000Z' });
  return { audioAnalysis, result };
}

function makeOpenFifth(){
  const samples = new Float32Array(durationSec * sampleRate);
  for(let n = 0; n < samples.length; n++){
    const timeSec = n / sampleRate;
    samples[n] = (
      Math.sin(2 * Math.PI * frequencyForPitchClass(0, 4) * timeSec) +
      Math.sin(2 * Math.PI * frequencyForPitchClass(7, 4) * timeSec)
    ) * 0.2;
  }
  return samples;
}

function makePercussionOnly(){
  const samples = new Float32Array(durationSec * sampleRate);
  for(let beat = 0; beat < durationSec; beat += 0.5){
    const center = Math.round(beat * sampleRate);
    for(let i = 0; i < 80 && center + i < samples.length; i++){
      samples[center + i] = (i % 2 ? 1 : -1) * 0.4 * (1 - i / 80);
    }
  }
  return samples;
}

function makeNoise(){
  const samples = new Float32Array(durationSec * sampleRate);
  let seed = 1;
  function next(){
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 * 2 - 1;
  }
  for(let i = 0; i < samples.length; i++) samples[i] = next() * 0.15;
  return samples;
}

function makeKeyChange(){
  const samples = new Float32Array(8 * sampleRate);
  for(let n = 0; n < samples.length; n++){
    const timeSec = n / sampleRate;
    samples[n] = chordValue(timeSec, timeSec < 4 ? 0 : 2, 'major') * 0.35;
  }
  return samples;
}

describe('deterministic musical-key and harmonic-mixing analysis', () => {
  it('detects all 12 pitch classes in major and minor modes with confidence', () => {
    ['major', 'minor'].forEach(mode => {
      for(let rootPc = 0; rootPc < 12; rootPc++){
        const key = analyzer.estimateKeyForSegment(makeKeySamples(rootPc, mode), sampleRate, 0, durationSec);
        expect(key.available, `${pitchNames[rootPc]} ${mode}`).to.equal(true);
        expect(key.rootPc, `${pitchNames[rootPc]} ${mode}`).to.equal(rootPc);
        expect(key.mode, `${pitchNames[rootPc]} ${mode}`).to.equal(mode);
        expect(key.name).to.equal(`${pitchNames[rootPc]} ${mode}`);
        expect(key.confidence).to.be.at.least(0.8);
        expect(key.camelot).to.match(/^\d{1,2}[AB]$/);
      }
    });
  });

  it('scores same-key, relative-key, neighboring-key, and semitone-clash transitions monotonically', () => {
    const same = judgeTransition(0, 'major', 0, 'major');
    const relative = judgeTransition(0, 'major', 9, 'minor');
    const neighbor = judgeTransition(0, 'major', 7, 'major');
    const semitone = judgeTransition(0, 'major', 1, 'major');

    expect(same.audioAnalysis.perEvent[0].transition.harmonic.camelot.relationship).to.equal('same_key');
    expect(relative.audioAnalysis.perEvent[0].transition.harmonic.camelot.relationship).to.equal('relative_major_minor');
    expect(neighbor.audioAnalysis.perEvent[0].transition.harmonic.camelot.relationship).to.equal('neighboring_harmonic_key');
    expect(semitone.audioAnalysis.perEvent[0].transition.harmonic.camelot.relationship).to.equal('incompatible');
    expect(same.result.components.harmonic_compatibility).to.equal(100);
    expect(relative.result.components.harmonic_compatibility).to.be.lessThan(same.result.components.harmonic_compatibility);
    expect(neighbor.result.components.harmonic_compatibility).to.be.lessThan(relative.result.components.harmonic_compatibility);
    expect(semitone.result.components.harmonic_compatibility).to.be.lessThan(60);
    expect(semitone.result.componentDetails.harmonic_compatibility.feedback).to.match(/3\.700s-4\.300s/);
  });

  it('measures consonance, dissonance, and key clash during overlap', () => {
    const same = judgeTransition(0, 'major', 0, 'major');
    const semitone = judgeTransition(0, 'major', 1, 'major');
    const sameHarmonic = same.audioAnalysis.perEvent[0].transition.harmonic;
    const clashHarmonic = semitone.audioAnalysis.perEvent[0].transition.harmonic;

    expect(sameHarmonic.consonance).to.be.greaterThan(0.95);
    expect(sameHarmonic.keyClash).to.be.lessThan(0.05);
    expect(clashHarmonic.dissonance).to.be.greaterThan(sameHarmonic.dissonance);
    expect(clashHarmonic.keyClash).to.be.greaterThan(0.7);
  });

  it('identifies stable and changing key regions', () => {
    const stable = analyzer.analyzeDecodedAudio({ samples: makeKeySamples(0, 'major', 8), sampleRate, events: [] });
    const changing = analyzer.analyzeDecodedAudio({ samples: makeKeyChange(), sampleRate, events: [] });

    expect(stable.session.harmonic.available).to.equal(true);
    expect(stable.session.harmonic.stable).to.equal(true);
    expect(stable.session.harmonic.changing).to.equal(false);
    expect(changing.session.harmonic.available).to.equal(true);
    expect(changing.session.harmonic.stable).to.equal(false);
    expect(changing.session.harmonic.changing).to.equal(true);
    expect(changing.session.harmonic.regions.some(region => region.name === 'C major')).to.equal(true);
    expect(changing.session.harmonic.regions.some(region => region.name === 'D major')).to.equal(true);
    expect(changing.session.harmonic.changes[0]).to.include({ from: 'C major', to: 'D major' });
  });

  it('returns insufficient evidence for ambiguous, percussion-only, noisy, and silent audio', () => {
    const ambiguous = analyzer.analyzeDecodedAudio({ samples: makeOpenFifth(), sampleRate, events: [] });
    const percussion = analyzer.analyzeDecodedAudio({ samples: makePercussionOnly(), sampleRate, events: [] });
    const noise = analyzer.analyzeDecodedAudio({ samples: makeNoise(), sampleRate, events: [] });
    const silence = analyzer.analyzeDecodedAudio({ samples: new Float32Array(durationSec * sampleRate), sampleRate, events: [] });

    expect(ambiguous.session.harmonic.available).to.equal(false);
    expect(ambiguous.session.harmonic.reason).to.equal('low_confidence_key');
    expect(ambiguous.session.harmonic.confidence).to.be.below(0.5);
    expect(percussion.session.harmonic.available).to.equal(false);
    expect(percussion.session.harmonic.reason).to.equal('noisy_or_percussive_audio');
    expect(noise.session.harmonic.available).to.equal(false);
    expect(noise.session.harmonic.reason).to.equal('noisy_or_percussive_audio');
    expect(silence.session.harmonic.available).to.equal(false);
    expect(silence.session.harmonic.reason).to.equal('silent_or_too_quiet');
  });

  it('marks harmonic score unavailable when transition key evidence is missing', () => {
    const events = [{ label: 'transition', idealSec: 2, actualSec: 2 }];
    const audioAnalysis = analyzer.analyzeDecodedAudio({ samples: makePercussionOnly(), sampleRate, events });
    const result = Judge.analyzePerformance(events, { audioAnalysis, analyzedAt: '2026-01-01T00:00:00.000Z' });

    expect(audioAnalysis.perEvent[0].transition.harmonic.available).to.equal(false);
    expect(result.components.harmonic_compatibility).to.equal(null);
    expect(result.componentDetails.harmonic_compatibility.reason).to.equal('insufficient_transition_key_evidence');
  });

  it('returns bounded and reproducible harmonic output', () => {
    const first = judgeTransition(0, 'major', 7, 'major');
    const second = judgeTransition(0, 'major', 7, 'major');

    expect(first.audioAnalysis.session.harmonic).to.deep.equal(second.audioAnalysis.session.harmonic);
    expect(first.audioAnalysis.perEvent[0].transition.harmonic).to.deep.equal(second.audioAnalysis.perEvent[0].transition.harmonic);
    expect(first.result.components.harmonic_compatibility).to.equal(second.result.components.harmonic_compatibility);
    expect(first.result.components.harmonic_compatibility).to.be.within(0, 100);
  });

  it('does not use random, filename-derived, metadata-derived, or hard-coded-success harmonic scoring', () => {
    const judgeSource = fs.readFileSync(path.join(__dirname, '..', 'judge_engine.js'), 'utf8');
    const analyzerSource = fs.readFileSync(path.join(__dirname, '..', 'audio_analyzer_ffmpeg.js'), 'utf8');
    const fallbackSource = fs.readFileSync(path.join(__dirname, '..', 'audio_analyzer.js'), 'utf8');

    expect(judgeSource).to.not.include('Math.random');
    expect(analyzerSource).to.not.include('Math.random');
    expect(analyzerSource).to.not.include('filename');
    expect(judgeSource).to.not.include('metadataDerived');
    expect(fallbackSource).to.not.include('pseudoRandomFromString');
    expect(fallbackSource).to.include('ffmpeg_required_for_real_audio_analysis');
  });
});
