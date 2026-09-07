const { spawn } = require('child_process');
const {
  getFFmpegCapability,
  publicFFmpegCapabilityStatus,
  requireFFmpegCapability
} = require('./ffmpeg_capability');

const DEFAULT_SAMPLE_RATE = 44100;
const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_KEY_PROFILE = [1, 0.03, 0.28, 0.04, 0.78, 0.24, 0.04, 0.9, 0.05, 0.25, 0.04, 0.32];
const MINOR_KEY_PROFILE = [1, 0.03, 0.22, 0.78, 0.04, 0.28, 0.04, 0.9, 0.32, 0.04, 0.35, 0.04];
const MAJOR_CAMELOT = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const MINOR_CAMELOT = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

function isPowerOfTwo(value){
  return value > 0 && (value & (value - 1)) === 0;
}

function fftMagnitudes(frame){
  const N = frame.length;
  if(!isPowerOfTwo(N)) throw new Error('FFT frame length must be a power of two');

  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  real.set(frame);

  let j = 0;
  for(let i = 1; i < N; i++){
    let bit = N >> 1;
    while(j & bit){ j ^= bit; bit >>= 1; }
    j ^= bit;
    if(i < j){
      const tr = real[i]; real[i] = real[j]; real[j] = tr;
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
  }

  for(let len = 2; len <= N; len <<= 1){
    const angle = -2 * Math.PI / len;
    const wLenReal = Math.cos(angle);
    const wLenImag = Math.sin(angle);
    for(let i = 0; i < N; i += len){
      let wReal = 1;
      let wImag = 0;
      const half = len >> 1;
      for(let k = 0; k < half; k++){
        const even = i + k;
        const odd = even + half;
        const oddReal = real[odd] * wReal - imag[odd] * wImag;
        const oddImag = real[odd] * wImag + imag[odd] * wReal;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
        const nextReal = wReal * wLenReal - wImag * wLenImag;
        wImag = wReal * wLenImag + wImag * wLenReal;
        wReal = nextReal;
      }
    }
  }

  const bins = (N >> 1) + 1;
  const mags = new Float32Array(bins);
  for(let i = 0; i < bins; i++) mags[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  return mags;
}

function s16leToFloat32(buf){
  const out = new Float32Array(buf.length / 2);
  for(let i = 0; i < out.length; i++){
    const v = buf.readInt16LE(i * 2);
    out[i] = v / 32768;
  }
  return out;
}

function rms(samples){
  let sum = 0;
  for(let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function sliceSegment(samples, sampleRate, timeSec, windowSec = 1.0){
  const center = Math.max(0, Math.floor(timeSec * sampleRate));
  const half = Math.floor(windowSec * sampleRate / 2);
  const start = Math.max(0, center - half);
  const end = Math.min(samples.length, center + half);
  return samples.subarray(start, end);
}

async function extractPcmBuffer(audioPath, options = {}){
  let capability;
  try{
    capability = options.capability || requireFFmpegCapability(options);
  }catch(err){
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    const args = ['-i', audioPath, '-f', 's16le', '-ac', '1', '-ar', String(DEFAULT_SAMPLE_RATE), '-hide_banner', '-loglevel', 'error', '-'];
    const ff = spawn(capability.executablePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let stderrBytes = 0;
    ff.stdout.on('data', c => chunks.push(c));
    ff.stderr.on('data', c => { stderrBytes += c.length; });
    ff.on('error', () => reject(new Error('FFmpeg execution failed')));
    ff.on('close', code => {
      if(code !== 0 && chunks.length === 0) return reject(new Error(stderrBytes ? 'FFmpeg decode failed' : 'FFmpeg produced no audio output'));
      resolve(Buffer.concat(chunks));
    });
  });
}

function computeSpectrum(samples, sampleRate){
  const N = 2048;
  const frame = new Float32Array(N);
  for(let i = 0; i < N; i++) frame[i] = samples[i] || 0;
  const mags = fftMagnitudes(frame);
  return Array.from(mags, (mag, i) => ({ freq: i * sampleRate / N, mag }));
}

function percentile(values, pct){
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if(!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((pct / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function movingAverage(values, radius){
  const out = new Array(values.length);
  for(let i = 0; i < values.length; i++){
    let sum = 0;
    let count = 0;
    for(let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++){
      sum += values[j];
      count += 1;
    }
    out[i] = count ? sum / count : 0;
  }
  return out;
}

function roundTo(value, places = 3){
  if(!Number.isFinite(value)) return null;
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function roundMs(value){
  return Number.isFinite(value) ? Math.round(value) : null;
}

function buildOnsetEnvelope(samples, sampleRate, options = {}){
  const frameSize = options.frameSize || 1024;
  const hop = options.hop || 256;
  if(!samples.length) return { envelope: [], frameSize, hop };

  const frames = Math.max(1, Math.floor(Math.max(0, samples.length - frameSize) / hop) + 1);
  const raw = new Array(frames);
  for(let f = 0; f < frames; f++){
    const start = f * hop;
    const end = Math.min(samples.length, start + frameSize);
    let peak = 0;
    let sumSq = 0;
    for(let i = start; i < end; i++){
      const abs = Math.abs(samples[i]);
      if(abs > peak) peak = abs;
      sumSq += samples[i] * samples[i];
    }
    const frameRms = Math.sqrt(sumSq / Math.max(1, end - start));
    raw[f] = peak * 0.8 + frameRms * 0.2;
  }
  return { envelope: movingAverage(raw, 1), frameSize, hop };
}

function refinePeakTime(samples, sampleRate, groupStartFrame, groupEndFrame, hop, frameSize){
  const searchStart = Math.max(0, groupStartFrame * hop);
  const searchEnd = Math.min(samples.length, groupEndFrame * hop + frameSize);
  let bestIndex = searchStart;
  let best = -1;
  for(let i = searchStart; i < searchEnd; i++){
    const abs = Math.abs(samples[i]);
    if(abs > best){
      best = abs;
      bestIndex = i;
    }
  }
  return bestIndex / sampleRate;
}

function detectOnsets(samples, sampleRate, options = {}){
  const { envelope, frameSize, hop } = buildOnsetEnvelope(samples, sampleRate, options);
  if(!envelope.length) return [];

  const median = percentile(envelope, 50);
  const p99 = percentile(envelope, 99);
  const threshold = median + Math.max(options.thresholdFloor || 0.03, (p99 - median) * (options.thresholdRatio || 0.35));
  const minPeakSpacingSec = options.minPeakSpacingSec || 0.24;
  const candidates = [];

  let i = 0;
  while(i < envelope.length){
    if(envelope[i] < threshold){ i += 1; continue; }
    const start = i;
    let end = i;
    let peakIndex = i;
    let peakValue = envelope[i];
    while(end + 1 < envelope.length && envelope[end + 1] >= threshold){
      end += 1;
      if(envelope[end] > peakValue){
        peakValue = envelope[end];
        peakIndex = end;
      }
    }
    candidates.push({
      time: refinePeakTime(samples, sampleRate, start, end, hop, frameSize),
      strength: peakValue,
      frame: peakIndex
    });
    i = end + 1;
  }

  const onsets = [];
  for(const candidate of candidates){
    const previous = onsets[onsets.length - 1];
    if(previous && candidate.time - previous.time < minPeakSpacingSec){
      if(candidate.strength > previous.strength) onsets[onsets.length - 1] = candidate;
    }else{
      onsets.push(candidate);
    }
  }
  return onsets.map(onset => Math.round(onset.time * 1000) / 1000);
}

function normalizeTempoCandidate(bpm, minBpm, maxBpm){
  if(!Number.isFinite(bpm) || bpm <= 0) return null;
  if(bpm >= minBpm && bpm <= maxBpm) return bpm;

  const candidates = [];
  for(const factor of [2, 3, 4]){
    const divided = bpm / factor;
    if(divided >= minBpm && divided <= maxBpm) candidates.push(divided);
    const multiplied = bpm * factor;
    if(multiplied >= minBpm && multiplied <= maxBpm) candidates.push(multiplied);
  }
  if(!candidates.length) return null;
  return candidates.sort((a, b) => Math.abs(a - 120) - Math.abs(b - 120))[0];
}

function estimateTempoBpm(onsets, options = {}){
  if(!Array.isArray(onsets) || onsets.length < 2) return null;
  const minBpm = options.minBpm || 70;
  const maxBpm = options.maxBpm || 190;
  const maxGap = options.maxGap || 4;
  const candidates = [];

  for(let gap = 1; gap <= maxGap; gap++){
    for(let i = 0; i + gap < onsets.length; i++){
      const dt = (onsets[i + gap] - onsets[i]) / gap;
      if(dt <= 0) continue;
      const rawBpm = 60 / dt;
      const bpm = normalizeTempoCandidate(rawBpm, minBpm, maxBpm);
      if(bpm) candidates.push({ bpm, weight: gap === 1 ? 1.4 : 1 });
    }
  }
  if(!candidates.length) return null;

  const bins = new Map();
  for(const candidate of candidates){
    const bin = Math.round(candidate.bpm);
    bins.set(bin, (bins.get(bin) || 0) + candidate.weight);
  }

  let bestBin = null;
  let bestWeight = -1;
  for(const [bin, weight] of bins.entries()){
    if(weight > bestWeight || (weight === bestWeight && Math.abs(bin - 120) < Math.abs(bestBin - 120))){
      bestBin = bin;
      bestWeight = weight;
    }
  }

  const close = candidates.filter(candidate => Math.abs(candidate.bpm - bestBin) <= 3);
  const weightSum = close.reduce((sum, candidate) => sum + candidate.weight, 0);
  const refined = close.reduce((sum, candidate) => sum + candidate.bpm * candidate.weight, 0) / Math.max(1, weightSum);
  return Math.round(refined);
}

function bandEnergy(freqs, lo, hi){
  let sum = 0;
  let total = 0;
  freqs.forEach(f => {
    total += f.mag;
    if(f.freq >= lo && f.freq <= hi) sum += f.mag;
  });
  return total > 0 ? sum / total : 0;
}

function detectTransitions(samples, sampleRate){
  const frameSize = 4096;
  const hop = 2048;
  const frames = Math.max(1, Math.floor(Math.max(0, samples.length - frameSize) / hop) + 1);
  const energy = new Array(frames);
  for(let f = 0; f < frames; f++){
    const start = f * hop;
    const end = Math.min(samples.length, start + frameSize);
    energy[f] = rms(samples.subarray(start, end));
  }

  const diffs = [];
  for(let i = 1; i < energy.length; i++) diffs.push(Math.abs(energy[i] - energy[i - 1]));
  if(!diffs.length) return [];
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / diffs.length;
  const threshold = mean + Math.sqrt(variance) * 2;
  const transitions = [];
  for(let i = 0; i < diffs.length; i++){
    const time = (i * hop) / sampleRate;
    if(diffs[i] > threshold && (!transitions.length || time - transitions[transitions.length - 1] >= 1)){
      transitions.push(Math.round(time * 1000) / 1000);
    }
  }
  return transitions;
}

function nearestValue(values, target, maxDistance){
  if(!Array.isArray(values) || !values.length || !Number.isFinite(target)) return null;
  let best = null;
  let bestDistance = Infinity;
  for(const value of values){
    const distance = Math.abs(value - target);
    if(distance < bestDistance){
      best = value;
      bestDistance = distance;
    }
  }
  return bestDistance <= maxDistance ? best : null;
}

function nearestGridOffsetSec(timeSec, anchorSec, intervalSec){
  if(!Number.isFinite(timeSec) || !Number.isFinite(anchorSec) || !Number.isFinite(intervalSec) || intervalSec <= 0) return null;
  const beatIndex = Math.round((timeSec - anchorSec) / intervalSec);
  const nearest = anchorSec + beatIndex * intervalSec;
  return timeSec - nearest;
}

function nearestPhraseOffsetBeats(timeSec, anchorSec, beatIntervalSec, phraseLengthBeats = 16){
  if(!Number.isFinite(timeSec) || !Number.isFinite(anchorSec) || !Number.isFinite(beatIntervalSec) || beatIntervalSec <= 0) return null;
  const beatsFromAnchor = (timeSec - anchorSec) / beatIntervalSec;
  const phraseIndex = Math.round(beatsFromAnchor / phraseLengthBeats);
  return beatsFromAnchor - phraseIndex * phraseLengthBeats;
}

function localPeakStrength(samples, sampleRate, timeSec, windowSec = 0.035){
  if(!Number.isFinite(timeSec)) return 0;
  const start = Math.max(0, Math.floor((timeSec - windowSec / 2) * sampleRate));
  const end = Math.min(samples.length, Math.ceil((timeSec + windowSec / 2) * sampleRate));
  let peak = 0;
  let sumSq = 0;
  for(let i = start; i < end; i++){
    const abs = Math.abs(samples[i]);
    if(abs > peak) peak = abs;
    sumSq += samples[i] * samples[i];
  }
  const localRms = Math.sqrt(sumSq / Math.max(1, end - start));
  return peak * 0.82 + localRms * 0.18;
}

function inferPhraseStructure(onsets, samples, sampleRate, bpm){
  const fallback = {
    available: false,
    fallback: true,
    phraseLengthBeats: 16,
    phraseLengthBars: 4,
    reason: 'insufficient_phrase_accent_evidence',
    anchorSec: Array.isArray(onsets) && onsets.length ? onsets[0] : 0,
    candidates: []
  };
  if(!Array.isArray(onsets) || onsets.length < 8 || !bpm) return fallback;

  const beatIntervalSec = 60 / bpm;
  const anchorSec = onsets[0];
  const beatRows = onsets.map(timeSec => ({
    timeSec,
    beatIndex: Math.round((timeSec - anchorSec) / beatIntervalSec),
    strength: localPeakStrength(samples, sampleRate, timeSec)
  })).filter(row => Number.isFinite(row.beatIndex) && Number.isFinite(row.strength));

  if(beatRows.length < 8) return fallback;
  const strengths = beatRows.map(row => row.strength);
  const baseline = percentile(strengths, 50) || 1e-6;
  const byBeat = new Map();
  beatRows.forEach(row => {
    const previous = byBeat.get(row.beatIndex);
    if(!previous || row.strength > previous.strength) byBeat.set(row.beatIndex, row);
  });
  const maxBeat = Math.max(...beatRows.map(row => row.beatIndex));
  const candidates = [16, 32, 64, 128].map(phraseLengthBeats => {
    const boundaryStrengths = [];
    const nonBoundaryStrengths = [];
    for(const row of beatRows){
      if(row.beatIndex % phraseLengthBeats === 0) boundaryStrengths.push(row.strength);
      else nonBoundaryStrengths.push(row.strength);
    }

    const expectedBoundaryBeats = [];
    for(let beat = 0; beat <= maxBeat; beat += phraseLengthBeats) expectedBoundaryBeats.push(beat);
    const observedBoundaryStrengths = expectedBoundaryBeats.map(beat => byBeat.get(beat)).filter(Boolean).map(row => row.strength);
    const boundaryAvg = boundaryStrengths.length ? boundaryStrengths.reduce((a, b) => a + b, 0) / boundaryStrengths.length : 0;
    const nonBoundaryAvg = nonBoundaryStrengths.length ? nonBoundaryStrengths.reduce((a, b) => a + b, 0) / nonBoundaryStrengths.length : baseline;
    const ratio = boundaryAvg / Math.max(nonBoundaryAvg, 1e-6);
    const coverage = expectedBoundaryBeats.length ? observedBoundaryStrengths.length / expectedBoundaryBeats.length : 0;
    const observedBoundaries = observedBoundaryStrengths.length;
    const score = ratio * Math.min(1, observedBoundaries / 3) * coverage;
    return {
      phraseLengthBeats,
      phraseLengthBars: phraseLengthBeats / 4,
      ratio: roundTo(ratio, 3),
      observedBoundaries,
      expectedBoundaries: expectedBoundaryBeats.length,
      score: roundTo(score, 3)
    };
  });

  const best = candidates
    .filter(candidate => candidate.observedBoundaries >= 2 && candidate.ratio >= 1.35)
    .sort((a, b) => b.score - a.score || b.phraseLengthBeats - a.phraseLengthBeats)[0];

  if(!best){
    return Object.assign({}, fallback, {
      anchorSec: roundTo(anchorSec, 3),
      candidates
    });
  }

  return {
    available: true,
    fallback: false,
    reason: null,
    phraseLengthBeats: best.phraseLengthBeats,
    phraseLengthBars: best.phraseLengthBars,
    anchorSec: roundTo(anchorSec, 3),
    confidence: best.score,
    candidates
  };
}

function zeroCrossingRate(samples){
  if(samples.length < 2) return 0;
  let crossings = 0;
  let prev = samples[0] >= 0 ? 1 : -1;
  for(let i = 1; i < samples.length; i++){
    const sign = samples[i] >= 0 ? 1 : -1;
    if(sign !== prev) crossings += 1;
    prev = sign;
  }
  return crossings / (samples.length - 1);
}

function spectralCentroid(samples, sampleRate){
  if(!samples.length) return null;
  const N = 2048;
  const frame = new Float32Array(N);
  for(let i = 0; i < N; i++){
    const sample = samples[i] || 0;
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    frame[i] = sample * window;
  }
  const mags = fftMagnitudes(frame);
  let weighted = 0;
  let total = 0;
  for(let i = 1; i < mags.length; i++){
    const freq = i * sampleRate / N;
    const power = mags[i] * mags[i];
    weighted += freq * power;
    total += power;
  }
  return total > 0 ? weighted / total : 0;
}

function windowSamples(samples, sampleRate, startSec, endSec){
  const start = Math.max(0, Math.floor(startSec * sampleRate));
  const end = Math.min(samples.length, Math.max(start, Math.floor(endSec * sampleRate)));
  return samples.subarray(start, end);
}

function dbfsFromAmplitude(value){
  const numeric = Math.max(Math.abs(Number(value) || 0), 1e-12);
  return 20 * Math.log10(numeric);
}

function frameStats(samples, sampleRate, windowSec = 0.4, hopSec = 0.1){
  const windowSize = Math.max(1, Math.round(windowSec * sampleRate));
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  if(!samples.length) return [];
  const frames = [];
  for(let start = 0; start < samples.length; start += hop){
    const end = Math.min(samples.length, start + windowSize);
    if(end <= start) break;
    const segment = samples.subarray(start, end);
    let peak = 0;
    let sumSq = 0;
    for(let i = 0; i < segment.length; i++){
      const abs = Math.abs(segment[i]);
      if(abs > peak) peak = abs;
      sumSq += segment[i] * segment[i];
    }
    const frameRms = Math.sqrt(sumSq / Math.max(1, segment.length));
    frames.push({
      startSec: start / sampleRate,
      endSec: end / sampleRate,
      rms: frameRms,
      peak,
      loudnessDb: dbfsFromAmplitude(frameRms)
    });
    if(end >= samples.length) break;
  }
  return frames;
}

function contiguousRangesFromSamples(samples, sampleRate, predicate, mergeGapSec = 0.005){
  const ranges = [];
  let start = null;
  for(let i = 0; i < samples.length; i++){
    if(predicate(samples[i])){
      if(start == null) start = i;
    }else if(start != null){
      ranges.push({ startSec: start / sampleRate, endSec: i / sampleRate });
      start = null;
    }
  }
  if(start != null) ranges.push({ startSec: start / sampleRate, endSec: samples.length / sampleRate });

  const merged = [];
  for(const range of ranges){
    const previous = merged[merged.length - 1];
    if(previous && range.startSec - previous.endSec <= mergeGapSec){
      previous.endSec = range.endSec;
    }else{
      merged.push(Object.assign({}, range));
    }
  }
  return merged.map(range => ({
    startSec: roundTo(range.startSec, 3),
    endSec: roundTo(range.endSec, 3),
    durationSec: roundTo(range.endSec - range.startSec, 3)
  }));
}

function contiguousRangesFromFrames(frames, predicate, minDurationSec = 0, mergeGapSec = 0.15){
  const ranges = [];
  let start = null;
  let end = null;
  for(const frame of frames){
    if(predicate(frame)){
      if(start == null) start = frame.startSec;
      end = frame.endSec;
    }else if(start != null){
      ranges.push({ startSec: start, endSec: end });
      start = null;
      end = null;
    }
  }
  if(start != null) ranges.push({ startSec: start, endSec: end });

  const merged = [];
  for(const range of ranges){
    const previous = merged[merged.length - 1];
    if(previous && range.startSec - previous.endSec <= mergeGapSec){
      previous.endSec = range.endSec;
    }else{
      merged.push(Object.assign({}, range));
    }
  }

  return merged
    .map(range => ({
      startSec: roundTo(range.startSec, 3),
      endSec: roundTo(range.endSec, 3),
      durationSec: roundTo(range.endSec - range.startSec, 3)
    }))
    .filter(range => range.durationSec >= minDurationSec);
}

function measureLoudnessDynamics(samples, sampleRate){
  if(!samples.length){
    return {
      available: false,
      reason: 'insufficient_audio_samples'
    };
  }

  let peak = 0;
  let sumSq = 0;
  let clippingSampleCount = 0;
  for(let i = 0; i < samples.length; i++){
    const abs = Math.abs(samples[i]);
    if(abs > peak) peak = abs;
    if(abs >= 0.99) clippingSampleCount += 1;
    sumSq += samples[i] * samples[i];
  }

  const integratedRms = Math.sqrt(sumSq / Math.max(1, samples.length));
  const integratedLoudnessDb = dbfsFromAmplitude(integratedRms);
  const peakLevelDb = dbfsFromAmplitude(peak);
  const crestFactorDb = peakLevelDb - integratedLoudnessDb;
  const shortTermFrames = frameStats(samples, sampleRate, 1.0, 0.25);
  const shortTermValues = shortTermFrames.map(frame => frame.loudnessDb).filter(Number.isFinite);
  const activeShortTermValues = shortTermValues.filter(value => value > -60);
  const shortTermAverageDb = finiteAverage(activeShortTermValues.length ? activeShortTermValues : shortTermValues);
  const shortTermMinDb = shortTermValues.length ? Math.min(...shortTermValues) : null;
  const shortTermMaxDb = shortTermValues.length ? Math.max(...shortTermValues) : null;
  const shortTermRangeDb = shortTermMinDb == null || shortTermMaxDb == null ? null : shortTermMaxDb - shortTermMinDb;

  const gainFrames = frameStats(samples, sampleRate, 0.25, 0.1);
  const gainJumps = [];
  for(let i = 1; i < gainFrames.length; i++){
    const previous = gainFrames[i - 1];
    const current = gainFrames[i];
    if(previous.loudnessDb <= -60 || current.loudnessDb <= -60) continue;
    const jumpDb = current.loudnessDb - previous.loudnessDb;
    if(Math.abs(jumpDb) >= 6){
      gainJumps.push({
        startSec: roundTo(previous.startSec, 3),
        endSec: roundTo(current.endSec, 3),
        jumpDb: roundTo(jumpDb, 2)
      });
    }
  }

  const silenceFrames = frameStats(samples, sampleRate, 0.2, 0.05);
  const silenceRanges = contiguousRangesFromFrames(silenceFrames, frame => frame.loudnessDb <= -50, 0.4, 0.1);
  const clippingRanges = contiguousRangesFromSamples(samples, sampleRate, sample => Math.abs(sample) >= 0.99, 0.003);
  const clippingDurationSec = clippingRanges.reduce((sum, range) => sum + range.durationSec, 0);
  const silenceDurationSec = silenceRanges.reduce((sum, range) => sum + range.durationSec, 0);
  const maxSilenceDurationSec = silenceRanges.length ? Math.max(...silenceRanges.map(range => range.durationSec)) : 0;
  const maxGainJumpDb = gainJumps.length ? Math.max(...gainJumps.map(range => Math.abs(range.jumpDb))) : 0;

  return {
    available: true,
    integratedLoudnessDb: roundTo(integratedLoudnessDb, 2),
    shortTermAverageDb: roundTo(shortTermAverageDb, 2),
    shortTermMinDb: roundTo(shortTermMinDb, 2),
    shortTermMaxDb: roundTo(shortTermMaxDb, 2),
    shortTermRangeDb: roundTo(shortTermRangeDb, 2),
    peakLevelDb: roundTo(peakLevelDb, 2),
    peakAmplitude: roundTo(peak, 4),
    crestFactorDb: roundTo(crestFactorDb, 2),
    clipping: {
      sampleCount: clippingSampleCount,
      durationSec: roundTo(clippingDurationSec, 3),
      ranges: clippingRanges.slice(0, 12)
    },
    gainJumps: {
      count: gainJumps.length,
      maxJumpDb: roundTo(maxGainJumpDb, 2),
      ranges: gainJumps.slice(0, 12)
    },
    silence: {
      totalDurationSec: roundTo(silenceDurationSec, 3),
      maxDurationSec: roundTo(maxSilenceDurationSec, 3),
      ranges: silenceRanges.slice(0, 12)
    },
    overLimited: integratedLoudnessDb >= -8 && crestFactorDb <= 6,
    quiet: integratedLoudnessDb <= -24
  };
}

function frequencyBandRatios(samples, sampleRate){
  if(!samples.length) return null;
  const freqs = computeSpectrum(samples, sampleRate);
  let low = 0;
  let mid = 0;
  let high = 0;
  let total = 0;
  freqs.forEach(bin => {
    const power = bin.mag * bin.mag;
    total += power;
    if(bin.freq >= 20 && bin.freq < 250) low += power;
    else if(bin.freq >= 250 && bin.freq < 4000) mid += power;
    else if(bin.freq >= 4000 && bin.freq <= 20000) high += power;
  });
  if(total <= 0) return { low: 0, mid: 0, high: 0 };
  return {
    low: low / total,
    mid: mid / total,
    high: high / total
  };
}

function rotateProfile(profile, rootPc){
  const out = new Array(12).fill(0);
  for(let i = 0; i < 12; i++) out[(i + rootPc) % 12] = profile[i];
  return out;
}

function normalizeVector(values){
  const sum = values.reduce((total, value) => total + Math.max(0, value), 0);
  return sum > 0 ? values.map(value => Math.max(0, value) / sum) : values.map(() => 0);
}

function cosineSimilarity(a, b){
  let dot = 0;
  let a2 = 0;
  let b2 = 0;
  for(let i = 0; i < a.length; i++){
    dot += a[i] * b[i];
    a2 += a[i] * a[i];
    b2 += b[i] * b[i];
  }
  return a2 > 0 && b2 > 0 ? dot / Math.sqrt(a2 * b2) : 0;
}

function midiPitchClassForFrequency(freq){
  if(!Number.isFinite(freq) || freq <= 0) return null;
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return ((midi % 12) + 12) % 12;
}

function chromaForSegment(samples, sampleRate, startSec = 0, endSec = samples.length / sampleRate){
  const start = Math.max(0, Math.floor(startSec * sampleRate));
  const end = Math.min(samples.length, Math.max(start, Math.floor(endSec * sampleRate)));
  const segment = samples.subarray(start, end);
  if(segment.length < 512){
    return {
      available: false,
      reason: 'insufficient_chroma_window',
      chroma: new Array(12).fill(0),
      totalEnergy: 0,
      spectralFlatness: null,
      peakShare: 0
    };
  }

  const N = 4096;
  const frame = new Float32Array(N);
  const frameStart = Math.max(0, Math.floor((segment.length - N) / 2));
  const copyLength = Math.min(N, segment.length);
  for(let i = 0; i < copyLength; i++){
    const window = copyLength > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (copyLength - 1)) : 1;
    frame[i] = segment[frameStart + i] * window;
  }

  const mags = fftMagnitudes(frame);
  const chroma = new Array(12).fill(0);
  let totalEnergy = 0;
  let logEnergy = 0;
  let bins = 0;
  for(let i = 1; i < mags.length; i++){
    const freq = i * sampleRate / N;
    if(freq < 55 || freq > 5000) continue;
    const power = mags[i] * mags[i];
    if(power <= 1e-12) continue;
    const pc = midiPitchClassForFrequency(freq);
    if(pc == null) continue;
    chroma[pc] += power;
    totalEnergy += power;
    logEnergy += Math.log(power);
    bins += 1;
  }

  const normalized = normalizeVector(chroma);
  const peakShare = normalized.length ? Math.max(...normalized) : 0;
  const arithmeticMean = bins ? totalEnergy / bins : 0;
  const geometricMean = bins ? Math.exp(logEnergy / bins) : 0;
  const spectralFlatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 1;
  return {
    available: totalEnergy > 1e-8,
    reason: totalEnergy > 1e-8 ? null : 'insufficient_tonal_energy',
    chroma: normalized.map(value => roundTo(value, 4)),
    totalEnergy,
    spectralFlatness: roundTo(spectralFlatness, 4),
    peakShare: roundTo(peakShare, 4)
  };
}

function keyForRootMode(rootPc, mode){
  return {
    rootPc,
    tonic: PITCH_CLASS_NAMES[rootPc],
    mode,
    name: `${PITCH_CLASS_NAMES[rootPc]} ${mode}`,
    camelot: mode === 'major' ? MAJOR_CAMELOT[rootPc] : MINOR_CAMELOT[rootPc]
  };
}

function estimateKeyFromChroma(chromaInput, options = {}){
  const chroma = Array.isArray(chromaInput) ? chromaInput.map(value => Number(value) || 0) : new Array(12).fill(0);
  const sum = chroma.reduce((total, value) => total + Math.max(0, value), 0);
  if(sum <= 0){
    return { available: false, reason: 'insufficient_tonal_energy', confidence: 0 };
  }
  const normalized = normalizeVector(chroma);
  const peakShare = Math.max(...normalized);
  const candidates = [];
  for(let rootPc = 0; rootPc < 12; rootPc++){
    candidates.push(Object.assign(keyForRootMode(rootPc, 'major'), {
      score: cosineSimilarity(normalized, rotateProfile(MAJOR_KEY_PROFILE, rootPc))
    }));
    candidates.push(Object.assign(keyForRootMode(rootPc, 'minor'), {
      score: cosineSimilarity(normalized, rotateProfile(MINOR_KEY_PROFILE, rootPc))
    }));
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const second = candidates[1];
  const oppositeMode = candidates.find(candidate => candidate.rootPc === top.rootPc && candidate.mode !== top.mode);
  const margin = top.score - (second ? second.score : 0);
  const modeMargin = oppositeMode ? top.score - oppositeMode.score : margin;
  const rawConfidence = Math.max(0, Math.min(1, margin * 4.2 + modeMargin * 2.4 + Math.max(0, peakShare - 0.16) * 0.9 + Math.max(0, top.score - 0.72) * 0.65));
  const confidence = Math.min(rawConfidence, Math.max(0, modeMargin / 0.1));
  const minConfidence = options.minConfidence == null ? 0.32 : options.minConfidence;
  const minModeMargin = options.minModeMargin == null ? 0.025 : options.minModeMargin;
  const minPeakShare = options.minPeakShare == null ? 0.18 : options.minPeakShare;
  const minScore = options.minScore == null ? 0.72 : options.minScore;

  if(top.score < minScore || peakShare < minPeakShare || confidence < minConfidence || modeMargin < minModeMargin){
    return {
      available: false,
      reason: 'low_confidence_key',
      confidence: roundTo(confidence, 3),
      bestCandidate: {
        name: top.name,
        camelot: top.camelot,
        score: roundTo(top.score, 3),
        margin: roundTo(margin, 3),
        modeMargin: roundTo(modeMargin, 3),
        peakShare: roundTo(peakShare, 3)
      },
      candidates: candidates.slice(0, 5).map(candidate => ({
        name: candidate.name,
        camelot: candidate.camelot,
        score: roundTo(candidate.score, 3)
      }))
    };
  }

  return Object.assign({}, keyForRootMode(top.rootPc, top.mode), {
    available: true,
    reason: null,
    confidence: roundTo(confidence, 3),
    score: roundTo(top.score, 3),
    margin: roundTo(margin, 3),
    modeMargin: roundTo(modeMargin, 3),
    peakShare: roundTo(peakShare, 3),
    chroma: normalized.map(value => roundTo(value, 4)),
    candidates: candidates.slice(0, 5).map(candidate => ({
      name: candidate.name,
      camelot: candidate.camelot,
      score: roundTo(candidate.score, 3)
    }))
  });
}

function estimateKeyForSegment(samples, sampleRate, startSec, endSec, options = {}){
  const segment = windowSamples(samples, sampleRate, startSec, endSec);
  const segmentRms = rms(segment);
  if(segment.length < 512 || segmentRms < (options.minRms || 0.004)){
    return {
      available: false,
      reason: segmentRms < (options.minRms || 0.004) ? 'silent_or_too_quiet' : 'insufficient_chroma_window',
      confidence: 0,
      range: { startSec: roundTo(startSec, 3), endSec: roundTo(endSec, 3) }
    };
  }
  const chroma = chromaForSegment(samples, sampleRate, startSec, endSec);
  if(!chroma.available){
    return Object.assign({}, chroma, {
      confidence: 0,
      range: { startSec: roundTo(startSec, 3), endSec: roundTo(endSec, 3) }
    });
  }
  if(chroma.spectralFlatness != null && chroma.spectralFlatness > (options.maxSpectralFlatness || 0.55)){
    return {
      available: false,
      reason: 'noisy_or_percussive_audio',
      confidence: 0,
      spectralFlatness: chroma.spectralFlatness,
      peakShare: chroma.peakShare,
      chroma: chroma.chroma,
      range: { startSec: roundTo(startSec, 3), endSec: roundTo(endSec, 3) }
    };
  }
  const key = estimateKeyFromChroma(chroma.chroma, options);
  return Object.assign({}, key, {
    spectralFlatness: chroma.spectralFlatness,
    peakShare: key.peakShare || chroma.peakShare,
    chroma: chroma.chroma,
    range: { startSec: roundTo(startSec, 3), endSec: roundTo(endSec, 3) }
  });
}

function camelotParts(camelot){
  const match = /^(\d{1,2})([AB])$/.exec(camelot || '');
  if(!match) return null;
  return { number: Number(match[1]), letter: match[2] };
}

function circularCamelotDistance(a, b){
  const direct = Math.abs(a - b);
  return Math.min(direct, 12 - direct);
}

function camelotRelationship(outgoing, incoming){
  if(!outgoing || !incoming || !outgoing.camelot || !incoming.camelot){
    return { available: false, reason: 'missing_camelot_key' };
  }
  const a = camelotParts(outgoing.camelot);
  const b = camelotParts(incoming.camelot);
  if(!a || !b) return { available: false, reason: 'invalid_camelot_key' };
  const distance = circularCamelotDistance(a.number, b.number);
  let relationship = 'incompatible';
  let compatibility = 0.15;
  if(distance === 0 && a.letter === b.letter){
    relationship = 'same_key';
    compatibility = 1;
  }else if(distance === 0 && a.letter !== b.letter){
    relationship = 'relative_major_minor';
    compatibility = 0.95;
  }else if(distance === 1 && a.letter === b.letter){
    relationship = 'neighboring_harmonic_key';
    compatibility = 0.9;
  }else if(distance === 1 && a.letter !== b.letter){
    relationship = 'neighboring_mode_shift';
    compatibility = 0.72;
  }else if(distance === 2 && a.letter === b.letter){
    relationship = 'distant_harmonic_key';
    compatibility = 0.55;
  }
  return {
    available: true,
    outgoing: outgoing.camelot,
    incoming: incoming.camelot,
    relationship,
    compatible: compatibility >= 0.72,
    distance,
    compatibility: roundTo(compatibility, 3)
  };
}

function chromaDissonance(chromaInput){
  const chroma = normalizeVector(Array.isArray(chromaInput) ? chromaInput : new Array(12).fill(0));
  const dissonantIntervals = new Set([1, 2, 6, 10, 11]);
  const consonantIntervals = new Set([0, 3, 4, 5, 7, 8, 9]);
  let dissonant = 0;
  let consonant = 0;
  for(let i = 0; i < 12; i++){
    for(let j = i; j < 12; j++){
      const interval = Math.min((j - i + 12) % 12, (i - j + 12) % 12);
      const product = chroma[i] * chroma[j] * (i === j ? 0.5 : 1);
      if(dissonantIntervals.has(interval)) dissonant += product;
      if(consonantIntervals.has(interval)) consonant += product;
    }
  }
  const total = dissonant + consonant;
  const dissonance = total > 0 ? dissonant / total : 0;
  const consonance = total > 0 ? consonant / total : 0;
  return {
    consonance: roundTo(consonance, 3),
    dissonance: roundTo(dissonance, 3)
  };
}

function harmonicRegionAnalysis(samples, sampleRate){
  const durationSec = samples.length / sampleRate;
  const regionSec = Math.max(1.5, Math.min(4, durationSec / 3));
  const stepSec = regionSec;
  const raw = [];
  for(let startSec = 0; startSec < durationSec - 0.5; startSec += stepSec){
    const endSec = Math.min(durationSec, startSec + regionSec);
    raw.push(estimateKeyForSegment(samples, sampleRate, startSec, endSec, { minConfidence: 0.3 }));
    if(endSec >= durationSec) break;
  }
  const available = raw.filter(region => region.available);
  const regions = [];
  for(const region of raw){
    const previous = regions[regions.length - 1];
    if(region.available && previous && previous.available && previous.name === region.name){
      previous.range.endSec = region.range.endSec;
      previous.confidence = roundTo((previous.confidence + region.confidence) / 2, 3);
    }else{
      regions.push(region.available ? {
        available: true,
        name: region.name,
        tonic: region.tonic,
        mode: region.mode,
        rootPc: region.rootPc,
        camelot: region.camelot,
        confidence: region.confidence,
        range: Object.assign({}, region.range)
      } : {
        available: false,
        reason: region.reason,
        confidence: region.confidence,
        range: Object.assign({}, region.range)
      });
    }
  }
  const unique = Array.from(new Set(available.map(region => region.name)));
  const changes = [];
  let lastAvailable = null;
  for(const region of regions){
    if(!region.available) continue;
    if(lastAvailable && lastAvailable.name !== region.name){
      changes.push({
        from: lastAvailable.name,
        to: region.name,
        startSec: lastAvailable.range.endSec,
        endSec: region.range.startSec
      });
    }
    lastAvailable = region;
  }
  return {
    regions,
    stable: available.length > 0 && unique.length <= 1,
    changing: unique.length > 1,
    changes,
    availableRegionCount: available.length
  };
}

function measureHarmonicAnalysis(samples, sampleRate){
  const durationSec = samples.length / sampleRate;
  const global = estimateKeyForSegment(samples, sampleRate, 0, durationSec);
  const regionAnalysis = harmonicRegionAnalysis(samples, sampleRate);
  if(!global.available && !regionAnalysis.availableRegionCount){
    return {
      available: false,
      reason: global.reason || 'insufficient_harmonic_evidence',
      key: null,
      confidence: global.confidence || 0,
      chroma: global.chroma || new Array(12).fill(0),
      regions: regionAnalysis.regions,
      stable: false,
      changing: false,
      changes: []
    };
  }

  const key = global.available ? global : regionAnalysis.regions.find(region => region.available);
  return {
    available: true,
    reason: null,
    key: {
      name: key.name,
      tonic: key.tonic,
      mode: key.mode,
      rootPc: key.rootPc,
      camelot: key.camelot
    },
    confidence: key.confidence,
    chroma: key.chroma || global.chroma || new Array(12).fill(0),
    spectralFlatness: key.spectralFlatness,
    regions: regionAnalysis.regions,
    stable: regionAnalysis.stable,
    changing: regionAnalysis.changing,
    changes: regionAnalysis.changes
  };
}

function transitionHarmonicMetrics(samples, sampleRate, timeSec){
  if(!Number.isFinite(timeSec)){
    return { available: false, reason: 'insufficient_transition_harmonic_evidence' };
  }
  const beforeStart = Math.max(0, timeSec - 1.4);
  const beforeEnd = Math.max(beforeStart, timeSec - 0.35);
  const centerStart = Math.max(0, timeSec - 0.3);
  const centerEnd = Math.min(samples.length / sampleRate, timeSec + 0.3);
  const afterStart = Math.min(samples.length / sampleRate, timeSec + 0.35);
  const afterEnd = Math.min(samples.length / sampleRate, timeSec + 1.4);
  const outgoing = estimateKeyForSegment(samples, sampleRate, beforeStart, beforeEnd, { minConfidence: 0.28 });
  const incoming = estimateKeyForSegment(samples, sampleRate, afterStart, afterEnd, { minConfidence: 0.28 });
  const overlapKey = estimateKeyForSegment(samples, sampleRate, centerStart, centerEnd, { minConfidence: 0.24, minModeMargin: 0.015 });
  if(!outgoing.available || !incoming.available){
    return {
      available: false,
      reason: 'insufficient_transition_key_evidence',
      outgoing,
      incoming,
      overlap: overlapKey,
      range: {
        startSec: roundTo(beforeStart, 3),
        endSec: roundTo(afterEnd, 3)
      }
    };
  }

  const relationship = camelotRelationship(outgoing, incoming);
  const overlapChroma = chromaForSegment(samples, sampleRate, centerStart, centerEnd);
  const dissonance = chromaDissonance(overlapChroma.chroma);
  const keyClash = Math.min(1, (1 - (relationship.compatibility || 0)) * 0.75 + dissonance.dissonance * 0.45);
  return {
    available: true,
    reason: null,
    range: {
      startSec: roundTo(beforeStart, 3),
      endSec: roundTo(afterEnd, 3)
    },
    overlapRange: {
      startSec: roundTo(centerStart, 3),
      endSec: roundTo(centerEnd, 3)
    },
    outgoing,
    incoming,
    overlap: overlapKey,
    camelot: relationship,
    consonance: dissonance.consonance,
    dissonance: dissonance.dissonance,
    keyClash: roundTo(keyClash, 3)
  };
}

function measureFrequencyBalance(samples, sampleRate){
  if(!samples.length){
    return {
      available: false,
      reason: 'insufficient_audio_samples'
    };
  }

  const durationSec = samples.length / sampleRate;
  const windows = [];
  const maxWindows = 80;
  const stepSec = Math.max(0.25, durationSec / maxWindows);
  for(let centerSec = 0.25; centerSec < durationSec; centerSec += stepSec){
    const segment = windowSamples(samples, sampleRate, centerSec - 0.125, centerSec + 0.125);
    if(segment.length < 512) continue;
    const ratios = frequencyBandRatios(segment, sampleRate);
    if(ratios) windows.push(ratios);
  }

  if(!windows.length){
    return {
      available: false,
      reason: 'insufficient_frequency_windows'
    };
  }

  const low = finiteAverage(windows.map(window => window.low));
  const mid = finiteAverage(windows.map(window => window.mid));
  const high = finiteAverage(windows.map(window => window.high));
  const lowMidRatioDb = 10 * Math.log10(Math.max(low, 1e-9) / Math.max(mid, 1e-9));
  const highMidRatioDb = 10 * Math.log10(Math.max(high, 1e-9) / Math.max(mid, 1e-9));
  const hollowMidPenalty = mid < 0.32 ? Math.min(1, (0.32 - mid) / 0.32) : 0;
  const harshHighPenalty = high > 0.34 ? Math.min(1, (high - 0.34) / 0.5) : 0;
  const bassHeavyPenalty = low > 0.46 ? Math.min(1, (low - 0.46) / 0.45) : 0;
  const balancePenalty = Math.min(1, hollowMidPenalty * 0.4 + harshHighPenalty * 0.3 + bassHeavyPenalty * 0.3);

  return {
    available: true,
    windowCount: windows.length,
    lowShare: roundTo(low, 3),
    midShare: roundTo(mid, 3),
    highShare: roundTo(high, 3),
    lowMidRatioDb: roundTo(lowMidRatioDb, 2),
    highMidRatioDb: roundTo(highMidRatioDb, 2),
    hollowMidPenalty: roundTo(hollowMidPenalty, 3),
    harshHighPenalty: roundTo(harshHighPenalty, 3),
    bassHeavyPenalty: roundTo(bassHeavyPenalty, 3),
    balancePenalty: roundTo(balancePenalty, 3)
  };
}

function transitionFrequencyMetrics(samples, sampleRate, timeSec){
  if(!Number.isFinite(timeSec)) return { available: false, reason: 'insufficient_transition_frequency_evidence' };
  const before = windowSamples(samples, sampleRate, timeSec - 0.55, timeSec - 0.05);
  const center = windowSamples(samples, sampleRate, timeSec - 0.15, timeSec + 0.15);
  const after = windowSamples(samples, sampleRate, timeSec + 0.05, timeSec + 0.55);
  if(before.length < sampleRate * 0.12 || after.length < sampleRate * 0.12 || center.length < sampleRate * 0.08){
    return { available: false, reason: 'insufficient_transition_frequency_evidence' };
  }
  const beforeBands = frequencyBandRatios(before, sampleRate);
  const centerBands = frequencyBandRatios(center, sampleRate);
  const afterBands = frequencyBandRatios(after, sampleRate);
  if(!beforeBands || !centerBands || !afterBands){
    return { available: false, reason: 'insufficient_transition_frequency_evidence' };
  }
  const spectralOverlap = Math.min(1, Math.min(beforeBands.low, afterBands.low) + Math.min(beforeBands.mid, afterBands.mid) + Math.min(beforeBands.high, afterBands.high));
  const bassOverlap = Math.min(1, Math.min(beforeBands.low, afterBands.low) * 1.35 + Math.max(0, centerBands.low - 0.45) * 0.8);
  const frequencyMasking = Math.min(1, spectralOverlap * 0.7 + bassOverlap * 0.3);
  return {
    available: true,
    range: {
      startSec: roundTo(Math.max(0, timeSec - 0.55), 3),
      endSec: roundTo(timeSec + 0.55, 3)
    },
    before: {
      low: roundTo(beforeBands.low, 3),
      mid: roundTo(beforeBands.mid, 3),
      high: roundTo(beforeBands.high, 3)
    },
    center: {
      low: roundTo(centerBands.low, 3),
      mid: roundTo(centerBands.mid, 3),
      high: roundTo(centerBands.high, 3)
    },
    after: {
      low: roundTo(afterBands.low, 3),
      mid: roundTo(afterBands.mid, 3),
      high: roundTo(afterBands.high, 3)
    },
    spectralOverlap: roundTo(spectralOverlap, 3),
    bassOverlap: roundTo(bassOverlap, 3),
    frequencyMasking: roundTo(frequencyMasking, 3)
  };
}

function localTransitionMetrics(samples, sampleRate, timeSec){
  if(!Number.isFinite(timeSec)) return { available: false, reason: 'insufficient_transition_evidence' };
  const before = windowSamples(samples, sampleRate, timeSec - 0.45, timeSec - 0.08);
  const after = windowSamples(samples, sampleRate, timeSec + 0.08, timeSec + 0.45);
  if(before.length < sampleRate * 0.1 || after.length < sampleRate * 0.1){
    return { available: false, reason: 'insufficient_transition_evidence' };
  }
  const beforeRms = rms(before);
  const afterRms = rms(after);
  const rmsDelta = Math.abs(afterRms - beforeRms) / Math.max(beforeRms, afterRms, 1e-6);
  const zcrDelta = Math.abs(zeroCrossingRate(after) - zeroCrossingRate(before));
  const beforeCentroid = spectralCentroid(before, sampleRate);
  const afterCentroid = spectralCentroid(after, sampleRate);
  const spectralChange = beforeCentroid == null || afterCentroid == null ? 0 : Math.min(1, Math.abs(afterCentroid - beforeCentroid) / 2000);
  const abruptness = Math.min(1, rmsDelta * 0.55 + zcrDelta * 2 + spectralChange * 0.35);
  return {
    available: true,
    beforeRms: Math.round(beforeRms * 1000) / 1000,
    afterRms: Math.round(afterRms * 1000) / 1000,
    rmsDelta: Math.round(rmsDelta * 1000) / 1000,
    zcrDelta: Math.round(zcrDelta * 1000) / 1000,
    beforeSpectralCentroidHz: Math.round(beforeCentroid || 0),
    afterSpectralCentroidHz: Math.round(afterCentroid || 0),
    spectralChange: Math.round(spectralChange * 1000) / 1000,
    abruptness: Math.round(abruptness * 1000) / 1000,
    cleanliness: Math.round((1 - abruptness) * 1000) / 1000
  };
}

function computeDriftEvidence(onsets, timingOffsetsMs){
  const intervals = [];
  for(let i = 1; i < onsets.length; i++){
    const dt = onsets[i] - onsets[i - 1];
    if(dt > 0) intervals.push(dt);
  }
  const first = intervals.slice(0, Math.min(4, intervals.length));
  const last = intervals.slice(Math.max(0, intervals.length - 4));
  const avg = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const startBpm = first.length ? 60 / avg(first) : null;
  const endBpm = last.length ? 60 / avg(last) : null;
  const finiteOffsets = timingOffsetsMs.filter(Number.isFinite);
  const timingDriftMs = finiteOffsets.length >= 2 ? finiteOffsets[finiteOffsets.length - 1] - finiteOffsets[0] : null;
  const maxAbsTimingOffsetMs = finiteOffsets.length ? Math.max(...finiteOffsets.map(v => Math.abs(v))) : null;
  return {
    available: intervals.length >= 2 || finiteOffsets.length >= 2,
    startBpm: startBpm == null ? null : Math.round(startBpm * 100) / 100,
    endBpm: endBpm == null ? null : Math.round(endBpm * 100) / 100,
    tempoDriftBpm: startBpm != null && endBpm != null ? Math.round((endBpm - startBpm) * 100) / 100 : null,
    timingDriftMs: timingDriftMs == null ? null : Math.round(timingDriftMs),
    maxAbsTimingOffsetMs: maxAbsTimingOffsetMs == null ? null : Math.round(maxAbsTimingOffsetMs)
  };
}

function finiteAverage(values){
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
}

function buildAlignmentDefectRanges(rows, thresholdMs){
  const ranges = [];
  let current = null;
  rows.forEach(row => {
    const localAbs = Math.abs(row.localBeatDeviationMs || 0);
    const beatLoss = (row.droppedBeatsSincePrevious || 0) + (row.extraBeatsSincePrevious || 0);
    const defective = localAbs > thresholdMs || beatLoss > 0 || row.unmatched;
    if(defective && !current){
      current = {
        type: beatLoss > 0 ? 'dropped_or_extra_beat' : (row.unmatched ? 'unmatched_onset' : 'local_deviation'),
        startSec: row.measuredActualSec,
        endSec: row.measuredActualSec,
        maxAbsMs: localAbs,
        droppedBeats: row.droppedBeatsSincePrevious || 0,
        extraBeats: row.extraBeatsSincePrevious || 0
      };
    }else if(defective && current){
      current.endSec = row.measuredActualSec;
      current.maxAbsMs = Math.max(current.maxAbsMs, localAbs);
      current.droppedBeats += row.droppedBeatsSincePrevious || 0;
      current.extraBeats += row.extraBeatsSincePrevious || 0;
      if(beatLoss > 0) current.type = 'dropped_or_extra_beat';
    }else if(!defective && current){
      ranges.push(current);
      current = null;
    }
  });
  if(current) ranges.push(current);
  return ranges.map(range => ({
    type: range.type,
    startSec: roundTo(range.startSec, 3),
    endSec: roundTo(range.endSec, 3),
    maxAbsMs: Math.round(range.maxAbsMs),
    droppedBeats: range.droppedBeats,
    extraBeats: range.extraBeats
  }));
}

function computeReferenceAlignment(perEvent, beatIntervalSec){
  const rows = perEvent
    .map((event, outputIndex) => ({ event, outputIndex }))
    .filter(row => Number.isFinite(row.event.idealSec) && Number.isFinite(row.event.measuredActualSec));

  if(!Number.isFinite(beatIntervalSec) || beatIntervalSec <= 0 || !rows.length){
    return {
      available: false,
      reason: 'insufficient_reference_alignment_evidence',
      reference: 'ideal_event_grid'
    };
  }

  const firstIdealSec = rows[0].event.idealSec;
  const offsetsMs = rows.map(row => Number.isFinite(row.event.timingOffsetMs)
    ? row.event.timingOffsetMs
    : Math.round((row.event.measuredActualSec - row.event.idealSec) * 1000));
  const initialPhaseOffsetMs = offsetsMs[0];
  const accumulatedDriftMs = rows.length >= 2 ? offsetsMs[offsetsMs.length - 1] - initialPhaseOffsetMs : 0;
  const anchorMeasuredSec = firstIdealSec + initialPhaseOffsetMs / 1000;
  let droppedBeats = 0;
  let extraBeats = 0;
  let previous = null;
  const modeledRows = rows.map((row, idx) => {
    const progress = rows.length <= 1 ? 0 : idx / (rows.length - 1);
    const trendOffsetMs = initialPhaseOffsetMs + accumulatedDriftMs * progress;
    const correctedOffsetMs = offsetsMs[idx] - initialPhaseOffsetMs;
    const localBeatDeviationMs = offsetsMs[idx] - trendOffsetMs;
    const expectedBeatIndex = Math.round((row.event.idealSec - firstIdealSec) / beatIntervalSec);
    const measuredBeatIndex = Math.round((row.event.measuredActualSec - anchorMeasuredSec) / beatIntervalSec);
    let droppedBeatsSincePrevious = 0;
    let extraBeatsSincePrevious = 0;
    if(previous){
      const expectedStep = expectedBeatIndex - previous.expectedBeatIndex;
      const measuredStep = measuredBeatIndex - previous.measuredBeatIndex;
      const delta = measuredStep - expectedStep;
      if(delta > 0){
        droppedBeatsSincePrevious = delta;
        droppedBeats += delta;
      }else if(delta < 0){
        extraBeatsSincePrevious = Math.abs(delta);
        extraBeats += Math.abs(delta);
      }
    }
    if(row.event.onsetMatched === false) droppedBeats += 1;
    const modeled = {
      outputIndex: row.outputIndex,
      measuredActualSec: row.event.measuredActualSec,
      offsetMs: offsetsMs[idx],
      correctedOffsetMs,
      trendOffsetMs,
      localBeatDeviationMs,
      expectedBeatIndex,
      measuredBeatIndex,
      droppedBeatsSincePrevious,
      extraBeatsSincePrevious,
      unmatched: row.event.onsetMatched === false
    };
    previous = modeled;
    return modeled;
  });

  modeledRows.forEach(row => {
    perEvent[row.outputIndex].alignment = {
      reference: 'ideal_event_grid',
      initialPhaseOffsetMs: roundMs(initialPhaseOffsetMs),
      phaseOffsetMs: roundMs(row.offsetMs),
      correctedOffsetMs: roundMs(row.correctedOffsetMs),
      accumulatedDriftMs: roundMs(row.offsetMs - initialPhaseOffsetMs),
      localBeatDeviationMs: roundMs(row.localBeatDeviationMs),
      expectedBeatIndex: row.expectedBeatIndex,
      measuredBeatIndex: row.measuredBeatIndex,
      droppedBeatsSincePrevious: row.droppedBeatsSincePrevious,
      extraBeatsSincePrevious: row.extraBeatsSincePrevious
    };
  });

  const localAbs = modeledRows.map(row => Math.abs(row.localBeatDeviationMs));
  const correctedAbs = modeledRows.map(row => Math.abs(row.correctedOffsetMs));
  const defectThresholdMs = 60;
  const recoveryThresholdMs = 40;
  const recoveryCandidate = modeledRows.find(row => Math.abs(row.correctedOffsetMs) > 120 || Math.abs(row.localBeatDeviationMs) > defectThresholdMs || row.droppedBeatsSincePrevious || row.extraBeatsSincePrevious || row.unmatched);
  let recovered = false;
  let recoveryStartSec = null;
  let recoveryEndSec = null;
  if(recoveryCandidate){
    const afterDefect = modeledRows.slice(modeledRows.indexOf(recoveryCandidate) + 1);
    const recoveredRow = afterDefect.find(row => Math.abs(row.correctedOffsetMs) <= recoveryThresholdMs && Math.abs(row.localBeatDeviationMs) <= recoveryThresholdMs);
    if(recoveredRow){
      recovered = true;
      recoveryStartSec = recoveryCandidate.measuredActualSec;
      recoveryEndSec = recoveredRow.measuredActualSec;
    }
  }

  return {
    available: true,
    reason: null,
    reference: 'ideal_event_grid',
    beatIntervalSec: roundTo(beatIntervalSec, 6),
    initialPhaseOffsetMs: roundMs(initialPhaseOffsetMs),
    averageAbsPhaseOffsetMs: roundMs(finiteAverage(offsetsMs.map(v => Math.abs(v)))),
    averageAbsCorrectedOffsetMs: roundMs(finiteAverage(correctedAbs)),
    averageAbsLocalDeviationMs: roundMs(finiteAverage(localAbs)),
    maxAbsLocalDeviationMs: roundMs(Math.max(...localAbs)),
    accumulatedDriftMs: roundMs(accumulatedDriftMs),
    droppedBeats,
    extraBeats,
    recovered,
    recoveryStartSec: recoveryStartSec == null ? null : roundTo(recoveryStartSec, 3),
    recoveryEndSec: recoveryEndSec == null ? null : roundTo(recoveryEndSec, 3),
    defectRanges: buildAlignmentDefectRanges(modeledRows, defectThresholdMs)
  };
}

function eventTime(event){
  if(!event) return null;
  const value = event.actualSec ?? event.actualTime ?? event.time ?? event.timestamp;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function eventIdealTime(event){
  if(!event) return null;
  const idealMs = event.idealMs ?? (event.payload && event.payload.idealMs);
  if(idealMs != null && Number.isFinite(Number(idealMs))) return Number(idealMs) / 1000;
  const idealSec = event.idealSec ?? (event.payload && event.payload.idealSec);
  if(idealSec != null && Number.isFinite(Number(idealSec))) return Number(idealSec);
  return null;
}

function analyzeDecodedAudio({ samples, sampleRate = DEFAULT_SAMPLE_RATE, events = [] }){
  const inputEvents = Array.isArray(events) ? events : [];
  const durationSec = samples.length / sampleRate;
  const onsets = detectOnsets(samples, sampleRate);
  const bpm = estimateTempoBpm(onsets);
  const beatInterval = bpm ? 60 / bpm : null;
  const beatAnchor = onsets.length ? onsets[0] : 0;
  const phraseStructure = inferPhraseStructure(onsets, samples, sampleRate, bpm);
  const phraseAnchor = Number.isFinite(phraseStructure.anchorSec) ? phraseStructure.anchorSec : beatAnchor;
  const phraseLengthBeats = phraseStructure.phraseLengthBeats || 16;
  const loudness = measureLoudnessDynamics(samples, sampleRate);
  const frequencyBalance = measureFrequencyBalance(samples, sampleRate);
  const harmonic = measureHarmonicAnalysis(samples, sampleRate);
  const beatTimes = [];
  if(bpm){
    for(let t = beatAnchor; t < durationSec; t += beatInterval) beatTimes.push(Math.round(t * 1000) / 1000);
  }
  const detectedTransitions = detectTransitions(samples, sampleRate);

  let times = inputEvents.map(eventTime);
  const haveTimes = times.length > 0 && times.every(t => t != null);
  if(!haveTimes && inputEvents.length){
    times = inputEvents.map((_, i) => (i + 1) * durationSec / (inputEvents.length + 1));
  }

  const perEvent = [];
  const rmsValues = [];
  const timingOffsetsMs = [];
  for(let i = 0; i < inputEvents.length; i++){
    const idealSec = eventIdealTime(inputEvents[i]);
    const expectedSec = idealSec == null ? (times[i] == null ? (i * durationSec / Math.max(1, inputEvents.length)) : times[i]) : idealSec;
    const searchSec = times[i] == null ? expectedSec : times[i];
    const nearestOnset = nearestValue(onsets, searchSec, beatInterval ? Math.max(0.2, beatInterval * 0.55) : 0.5);
    const onsetMatched = nearestOnset != null;
    const measuredSec = nearestOnset == null ? (times[i] == null ? expectedSec : times[i]) : nearestOnset;
    const timingOffsetMs = idealSec == null ? null : Math.round((measuredSec - idealSec) * 1000);
    const beatOffsetSec = beatInterval ? nearestGridOffsetSec(measuredSec, beatAnchor, beatInterval) : null;
    const phraseOffsetBeats = beatInterval ? nearestPhraseOffsetBeats(measuredSec, phraseAnchor, beatInterval, phraseLengthBeats) : null;
    const transitionMetrics = localTransitionMetrics(samples, sampleRate, measuredSec);
    const transitionFrequency = transitionFrequencyMetrics(samples, sampleRate, measuredSec);
    const transitionHarmonic = transitionHarmonicMetrics(samples, sampleRate, measuredSec);
    timingOffsetsMs.push(timingOffsetMs);

    const t = measuredSec;
    const seg = sliceSegment(samples, sampleRate, t, 1.0);
    const segRms = rms(seg);
    rmsValues.push(segRms);

    let clipCount = 0;
    for(let k = 0; k < seg.length; k++) if(Math.abs(seg[k]) > 0.98) clipCount += 1;
    const clipRatio = seg.length ? clipCount / seg.length : 0;
    const freqs = computeSpectrum(seg, sampleRate);
    const low = bandEnergy(freqs, 20, 250);
    const mid = bandEnergy(freqs, 251, 4000);
    const high = bandEnergy(freqs, 4001, 20000);
    const freqOverlap = transitionFrequency.available ? transitionFrequency.frequencyMasking : Math.max(0, Math.min(1, low + mid * 0.3));
    const bassClash = transitionFrequency.available ? transitionFrequency.bassOverlap : low;
    const effectUsage = Math.round(Math.abs(mid - low) * 10);
    const scratchScore = Math.min(1, Math.max(0, high * 1.2));
    perEvent.push({
      index: i,
      freqOverlap: Math.round(freqOverlap * 100) / 100,
      bassClash: Math.round(bassClash * 100) / 100,
      clipping: clipRatio > 0.02,
      clipCount,
      clipDurationSec: Math.round((clipCount / sampleRate) * 1000) / 1000,
      gainVariance: null,
      eqPenalty: frequencyBalance.available ? frequencyBalance.balancePenalty : null,
      effectUsage,
      scratchScore,
      measuredActualSec: Math.round(measuredSec * 1000) / 1000,
      expectedSec: Math.round(expectedSec * 1000) / 1000,
      idealSec: idealSec == null ? null : Math.round(idealSec * 1000) / 1000,
      onsetMatched,
      timingOffsetMs,
      beatGridOffsetMs: beatOffsetSec == null ? null : Math.round(beatOffsetSec * 1000),
      phraseOffsetBeats: phraseOffsetBeats == null ? null : Math.round(phraseOffsetBeats * 1000) / 1000,
      transition: Object.assign({}, transitionMetrics, {
        frequency: transitionFrequency,
        harmonic: transitionHarmonic
      })
    });
  }

  const meanRms = rmsValues.reduce((a, b) => a + b, 0) / Math.max(1, rmsValues.length);
  const varRms = rmsValues.reduce((a, b) => a + Math.pow(b - meanRms, 2), 0) / Math.max(1, rmsValues.length);
  const gainVariance = Math.min(1, varRms / (meanRms + 1e-6));
  const measuredGainPenalty = loudness.available
    ? Math.min(1, Math.max(
      gainVariance,
      Math.max(0, ((loudness.shortTermRangeDb || 0) - 6) / 18),
      Math.max(0, ((loudness.gainJumps.maxJumpDb || 0) - 3) / 12),
      Math.max(0, (loudness.silence.maxDurationSec || 0) / 1.5)
    ))
    : gainVariance;
  perEvent.forEach(p => { p.gainVariance = Math.round(measuredGainPenalty * 100) / 100; });

  const avgFreqOverlap = perEvent.reduce((a, b) => a + b.freqOverlap, 0) / Math.max(1, perEvent.length);
  const clipRatioSession = perEvent.reduce((a, b) => a + (b.clipping ? 1 : 0), 0) / Math.max(1, perEvent.length);

  const bars = [];
  for(let i = 0; i < beatTimes.length; i += 4){
    bars.push({ start: beatTimes[i], beats: Math.min(4, beatTimes.length - i) });
  }
  const alignment = computeReferenceAlignment(perEvent, beatInterval);

  return {
    perEvent,
    session: {
      durationSec: Math.round(durationSec * 1000) / 1000,
      avgFreqOverlap: Math.round(avgFreqOverlap * 100) / 100,
      clipRatio: Math.round(clipRatioSession * 100) / 100,
      loudness: Math.round(meanRms * 100) / 100,
      loudnessMetrics: loudness,
      frequencyBalance,
      harmonic,
      onsets,
      bpm,
      beatTimes,
      drift: computeDriftEvidence(onsets, timingOffsetsMs),
      alignment,
      phrase: phraseStructure,
      bars,
      transitions: detectedTransitions
    }
  };
}

async function analyzeSessionAudio({ audioPath, events }){
  let buffer;
  try{
    buffer = await extractPcmBuffer(audioPath);
  }catch(err){
    const wrapped = new Error('FFmpeg audio extraction unavailable');
    wrapped.code = err && err.code === 'FFMPEG_UNAVAILABLE' ? err.code : 'FFMPEG_EXTRACT_FAILED';
    wrapped.capability = err && err.capability ? err.capability : publicFFmpegCapabilityStatus(getFFmpegCapability());
    throw wrapped;
  }
  return analyzeDecodedAudio({ samples: s16leToFloat32(buffer), sampleRate: DEFAULT_SAMPLE_RATE, events });
}

module.exports = {
  DEFAULT_SAMPLE_RATE,
  analyzeDecodedAudio,
  analyzeSessionAudio,
  bandEnergy,
  buildOnsetEnvelope,
  camelotRelationship,
  chromaForSegment,
  computeSpectrum,
  computeReferenceAlignment,
  dbfsFromAmplitude,
  detectOnsets,
  detectTransitions,
  estimateTempoBpm,
  extractPcmBuffer,
  fftMagnitudes,
  measureFrequencyBalance,
  measureHarmonicAnalysis,
  measureLoudnessDynamics,
  estimateKeyFromChroma,
  estimateKeyForSegment,
  inferPhraseStructure,
  localTransitionMetrics,
  nearestGridOffsetSec,
  nearestPhraseOffsetBeats,
  rms,
  s16leToFloat32,
  sliceSegment
};
