/**
 * Universal DJ / Producer Judge Engine
 * - analyzePerformance(events, options)
 * - preserves rawMeasurements (per-event raw fields)
 * - returns components, componentDetails, overallScore, timeline, recommendations
 *
 * Audio-backed DJ components use measured analyzer evidence when available:
 * BPM/onsets/beat grid, timing offsets, drift, phrase offsets, and transition metrics.
 * Producer components use whole-file audio evidence without reusing DJ transition
 * scoring semantics.
 * If evidence is missing, the affected component is marked unavailable instead of
 * receiving a fabricated neutral score.
 */

function msPerBeat(bpm){ return 60000 / (bpm || 120); }

function clamp(v, min = 0, max = 100){
  if(!Number.isFinite(Number(v))) return null;
  return Math.max(min, Math.min(max, Math.round(Number(v))));
}

function avg(values){
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
}

function maxAbs(values){
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite.map(value => Math.abs(value))) : null;
}

function scoreError(value, excellent, fail){
  const abs = Math.abs(Number(value));
  if(!Number.isFinite(abs)) return null;
  if(abs <= excellent) return 100;
  if(abs >= fail) return 0;
  return clamp(100 * (1 - ((abs - excellent) / (fail - excellent))));
}

function scoreAverageError(values, excellent, fail){
  const scores = values.filter(Number.isFinite).map(value => scoreError(value, excellent, fail)).filter(Number.isFinite);
  return scores.length ? clamp(avg(scores)) : null;
}

function scoreInRange(value, excellentLow, excellentHigh, failLow, failHigh){
  const numeric = Number(value);
  if(!Number.isFinite(numeric)) return null;
  if(numeric >= excellentLow && numeric <= excellentHigh) return 100;
  if(numeric <= failLow || numeric >= failHigh) return 0;
  if(numeric < excellentLow) return clamp(100 * ((numeric - failLow) / (excellentLow - failLow)));
  return clamp(100 * ((failHigh - numeric) / (failHigh - excellentHigh)));
}

function weightedScore(parts){
  const usable = parts.filter(part => Number.isFinite(part.score) && Number.isFinite(part.weight) && part.weight > 0);
  const weightSum = usable.reduce((sum, part) => sum + part.weight, 0);
  if(!weightSum) return null;
  return usable.reduce((sum, part) => sum + part.score * part.weight, 0) / weightSum;
}

function rangeText(range){
  if(!range || !Number.isFinite(range.startSec) || !Number.isFinite(range.endSec)) return null;
  return `${range.startSec.toFixed(3)}s-${range.endSec.toFixed(3)}s`;
}

function firstRangeText(ranges){
  return Array.isArray(ranges) && ranges.length ? rangeText(ranges[0]) : null;
}

function toMs(v){
  if(v == null) return null;
  const numeric = Number(v);
  if(!Number.isFinite(numeric)) return null;
  if(Math.abs(numeric) < 10000 && String(v).indexOf('.') > -1) return Math.round(numeric * 1000);
  return numeric;
}

function payloadFor(ev){
  return ev && ev.payload ? ev.payload : ev;
}

function buildRawMeasurements(events){
  return events.map(ev => {
    const payload = payloadFor(ev) || {};
    const bpm = payload.bpm || (payload.meta && payload.meta.bpm) || 120;
    const idealMs = payload.idealMs != null ? Number(payload.idealMs) : (payload.idealSec != null ? Number(payload.idealSec) * 1000 : null);
    const actualMs = payload.actualMs != null ? Number(payload.actualMs) : (payload.actualSec != null ? Number(payload.actualSec) * 1000 : null);
    const diffMs = (idealMs != null && actualMs != null) ? (actualMs - idealMs) : null;
    const beatMs = msPerBeat(bpm);
    const beats = diffMs != null ? diffMs / beatMs : null;
    return {
      label: payload.label || payload.event || 'event',
      bpm,
      idealMs,
      actualMs,
      diffMs,
      beats,
      payload
    };
  });
}

function componentUnavailable(reason, measurements = {}){
  return { available: false, score: null, reason, measurements, feedback: 'Insufficient measured evidence for this component.' };
}

function componentAvailable(score, measurements, feedback){
  return { available: true, score: clamp(score), reason: null, measurements, feedback };
}

function mergeAudioEvidence(per, audioAnalysis){
  if(!audioAnalysis || !Array.isArray(audioAnalysis.perEvent)) return;
  const perMap = new Map();
  audioAnalysis.perEvent.forEach(p => { perMap.set(Number(p.index), p); });
  per.forEach((e, idx) => {
    const evidence = perMap.get(idx);
    if(evidence) e.payload = Object.assign({}, e.payload || {}, evidence);
  });
}

function timingComponent(per){
  const audioOffsets = per.map(e => e.payload && e.payload.timingOffsetMs).filter(Number.isFinite);
  const fallbackDiffs = per.map(e => e.diffMs).filter(Number.isFinite);
  const offsets = audioOffsets.length ? audioOffsets : fallbackDiffs;
  if(!offsets.length) return componentUnavailable('insufficient_timing_evidence');
  const score = scoreAverageError(offsets, 20, 250);
  const measurements = {
    source: audioOffsets.length ? 'audio_timing_offset_ms' : 'telemetry_diff_ms',
    averageAbsOffsetMs: Math.round(avg(offsets.map(v => Math.abs(v)))),
    maxAbsOffsetMs: Math.round(maxAbs(offsets)),
    offsetsMs: offsets.map(v => Math.round(v))
  };
  return componentAvailable(score, measurements, `Average timing offset ${measurements.averageAbsOffsetMs} ms; max ${measurements.maxAbsOffsetMs} ms.`);
}

function beatAlignmentComponent(per, audioAnalysis){
  const beatOffsets = per.map(e => e.payload && e.payload.beatGridOffsetMs).filter(Number.isFinite);
  const drift = audioAnalysis && audioAnalysis.session && audioAnalysis.session.drift;
  const alignment = audioAnalysis && audioAnalysis.session && audioAnalysis.session.alignment;
  if(alignment && alignment.available){
    const phaseScore = scoreError(alignment.initialPhaseOffsetMs, 15, 180);
    const localScore = scoreError(alignment.averageAbsLocalDeviationMs, 20, 120);
    const driftScore = scoreError(alignment.accumulatedDriftMs, 20, 250);
    const hasAlignmentDefect = (alignment.defectRanges || []).length > 0 || alignment.droppedBeats > 0 || alignment.extraBeats > 0 || Math.abs(alignment.accumulatedDriftMs || 0) > 120;
    const recoveryScore = !hasAlignmentDefect ? 100 : (alignment.recovered ? 85 : 45);
    const beatLossPenalty = Math.min(45, ((alignment.droppedBeats || 0) + (alignment.extraBeats || 0)) * 12);
    const score = clamp(weightedScore([
      { score: phaseScore, weight: 0.35 },
      { score: localScore, weight: 0.25 },
      { score: driftScore, weight: 0.25 },
      { score: recoveryScore, weight: 0.15 }
    ]) - beatLossPenalty);
    const firstRange = (alignment.defectRanges || [])[0];
    const measurements = {
      source: 'reference_alignment',
      reference: alignment.reference,
      initialPhaseOffsetMs: alignment.initialPhaseOffsetMs,
      accumulatedDriftMs: alignment.accumulatedDriftMs,
      averageAbsLocalDeviationMs: alignment.averageAbsLocalDeviationMs,
      maxAbsLocalDeviationMs: alignment.maxAbsLocalDeviationMs,
      droppedBeats: alignment.droppedBeats,
      extraBeats: alignment.extraBeats,
      recovered: alignment.recovered,
      recoveryStartSec: alignment.recoveryStartSec,
      recoveryEndSec: alignment.recoveryEndSec,
      defectRanges: alignment.defectRanges || [],
      beatLossPenalty
    };
    const range = rangeText(firstRange);
    const defectText = firstRange
      ? `; ${firstRange.type} near ${range} with max ${firstRange.maxAbsMs} ms local deviation`
      : '';
    const recoveryText = alignment.recovered && Number.isFinite(alignment.recoveryStartSec) && Number.isFinite(alignment.recoveryEndSec)
      ? `; recovered from ${alignment.recoveryStartSec.toFixed(3)}s-${alignment.recoveryEndSec.toFixed(3)}s`
      : '';
    return componentAvailable(score, measurements, `Initial phase offset ${alignment.initialPhaseOffsetMs} ms; accumulated drift ${alignment.accumulatedDriftMs} ms; average local beat deviation ${alignment.averageAbsLocalDeviationMs} ms${defectText}${recoveryText}.`);
  }

  const scores = [];
  const measurements = {};

  if(beatOffsets.length){
    scores.push(scoreAverageError(beatOffsets, 15, 120));
    measurements.averageAbsBeatOffsetMs = Math.round(avg(beatOffsets.map(v => Math.abs(v))));
    measurements.maxAbsBeatOffsetMs = Math.round(maxAbs(beatOffsets));
    measurements.beatGridOffsetMs = beatOffsets.map(v => Math.round(v));
  }

  if(drift && Number.isFinite(drift.tempoDriftBpm)){
    scores.push(scoreError(drift.tempoDriftBpm, 0.75, 8));
    measurements.tempoDriftBpm = drift.tempoDriftBpm;
    measurements.startBpm = drift.startBpm;
    measurements.endBpm = drift.endBpm;
  }

  if(!scores.filter(Number.isFinite).length) return componentUnavailable('insufficient_beat_grid_evidence');
  const score = avg(scores.filter(Number.isFinite));
  return componentAvailable(score, measurements, `Beat-grid offset ${measurements.averageAbsBeatOffsetMs ?? 'n/a'} ms; tempo drift ${measurements.tempoDriftBpm ?? 'n/a'} BPM.`);
}

function phrasingComponent(per, audioAnalysis){
  const phraseOffsets = per.map(e => e.payload && e.payload.phraseOffsetBeats).filter(Number.isFinite);
  if(!phraseOffsets.length) return componentUnavailable('insufficient_phrase_boundary_evidence');
  const phrase = audioAnalysis && audioAnalysis.session && audioAnalysis.session.phrase;
  const normalized = phraseOffsets.map(offset => Math.abs(offset));
  const scores = normalized.map(offset => scoreError(offset, 0.25, 2)).filter(Number.isFinite);
  const measurements = {
    averagePhraseOffsetBeats: Math.round(avg(normalized) * 1000) / 1000,
    maxPhraseOffsetBeats: Math.round(maxAbs(phraseOffsets) * 1000) / 1000,
    phraseOffsetBeats: phraseOffsets,
    phraseLengthBeats: phrase && phrase.phraseLengthBeats ? phrase.phraseLengthBeats : null,
    phraseLengthBars: phrase && phrase.phraseLengthBars ? phrase.phraseLengthBars : null,
    phraseEvidence: phrase ? (phrase.available ? 'inferred_from_onset_energy' : 'fallback_4_bar') : 'unknown',
    fallbackReason: phrase && phrase.fallback ? phrase.reason : null
  };
  const fallbackText = measurements.phraseEvidence === 'fallback_4_bar' ? '; used documented 4-bar fallback' : '';
  return componentAvailable(avg(scores), measurements, `Average phrase-boundary offset ${measurements.averagePhraseOffsetBeats} beats against ${measurements.phraseLengthBars || 'unknown'}-bar phrases${fallbackText}.`);
}

function transitionQualityComponent(per){
  const transitions = per
    .map(e => ({
      measuredActualSec: e.payload && Number.isFinite(e.payload.measuredActualSec) ? e.payload.measuredActualSec : null,
      transition: e.payload && e.payload.transition
    }))
    .filter(row => row.transition && row.transition.available && Number.isFinite(row.transition.abruptness));
  if(!transitions.length) return componentUnavailable('insufficient_transition_evidence');
  const abruptnessValues = transitions.map(row => row.transition.abruptness);
  const spectralValues = transitions.map(row => row.transition.spectralChange).filter(Number.isFinite);
  const rmsValues = transitions.map(row => row.transition.rmsDelta).filter(Number.isFinite);
  const clippingPenalty = per.some(e => e.payload && e.payload.clipping) ? 20 : 0;
  const score = clamp((1 - avg(abruptnessValues)) * 100 - clippingPenalty);
  const sharpRanges = transitions
    .filter(row => row.transition.abruptness >= 0.35 && Number.isFinite(row.measuredActualSec))
    .map(row => ({
      startSec: Math.round(Math.max(0, row.measuredActualSec - 0.45) * 1000) / 1000,
      endSec: Math.round((row.measuredActualSec + 0.45) * 1000) / 1000,
      abruptness: row.transition.abruptness,
      spectralChange: row.transition.spectralChange,
      rmsDelta: row.transition.rmsDelta
    }));
  const measurements = {
    averageAbruptness: Math.round(avg(abruptnessValues) * 1000) / 1000,
    maxAbruptness: Math.round(maxAbs(abruptnessValues) * 1000) / 1000,
    averageSpectralChange: spectralValues.length ? Math.round(avg(spectralValues) * 1000) / 1000 : null,
    averageRmsDelta: rmsValues.length ? Math.round(avg(rmsValues) * 1000) / 1000 : null,
    transitionCount: transitions.length,
    clippingPenalty,
    sharpRanges
  };
  const range = sharpRanges[0] ? `; sharp change at ${sharpRanges[0].startSec.toFixed(3)}s-${sharpRanges[0].endSec.toFixed(3)}s` : '';
  return componentAvailable(score, measurements, `Average transition abruptness ${measurements.averageAbruptness}; spectral change ${measurements.averageSpectralChange ?? 'n/a'}; RMS delta ${measurements.averageRmsDelta ?? 'n/a'}${range}.`);
}

function gainControlComponent(per, audioAnalysis){
  const loudness = audioAnalysis && audioAnalysis.session && audioAnalysis.session.loudnessMetrics;
  if(loudness && loudness.available){
    const loudnessScore = scoreInRange(loudness.integratedLoudnessDb, -18, -10, -34, -4);
    const rangeScore = scoreError(loudness.shortTermRangeDb, 6, 22);
    const jumpScore = scoreError(loudness.gainJumps.maxJumpDb || 0, 3, 15);
    const silenceScore = scoreError(loudness.silence.maxDurationSec || 0, 0.2, 1.5);
    const crestScore = loudness.overLimited ? scoreInRange(loudness.crestFactorDb, 6, 18, 2, 24) : 100;
    const clipPenalty = Math.min(25, (loudness.clipping.durationSec || 0) * 120);
    const score = clamp(weightedScore([
      { score: loudnessScore, weight: 0.32 },
      { score: rangeScore, weight: 0.2 },
      { score: jumpScore, weight: 0.2 },
      { score: silenceScore, weight: 0.18 },
      { score: crestScore, weight: 0.1 }
    ]) - clipPenalty);
    const jumpRange = firstRangeText(loudness.gainJumps.ranges);
    const silenceRange = firstRangeText(loudness.silence.ranges);
    const measurements = {
      source: 'decoded_audio_loudness',
      integratedLoudnessDb: loudness.integratedLoudnessDb,
      shortTermAverageDb: loudness.shortTermAverageDb,
      shortTermRangeDb: loudness.shortTermRangeDb,
      peakLevelDb: loudness.peakLevelDb,
      crestFactorDb: loudness.crestFactorDb,
      maxGainJumpDb: loudness.gainJumps.maxJumpDb,
      gainJumpCount: loudness.gainJumps.count,
      gainJumpRanges: loudness.gainJumps.ranges,
      silenceDurationSec: loudness.silence.totalDurationSec,
      maxSilenceDurationSec: loudness.silence.maxDurationSec,
      silenceRanges: loudness.silence.ranges,
      overLimited: loudness.overLimited,
      quiet: loudness.quiet,
      clipPenalty: Math.round(clipPenalty)
    };
    const jumpText = jumpRange ? `; gain jump ${loudness.gainJumps.maxJumpDb} dB at ${jumpRange}` : '';
    const silenceText = silenceRange ? `; dropout ${loudness.silence.maxDurationSec}s at ${silenceRange}` : '';
    const limitText = loudness.overLimited ? '; over-limited crest factor detected' : '';
    const quietText = loudness.quiet ? '; quiet integrated level detected' : '';
    return componentAvailable(score, measurements, `Integrated loudness ${loudness.integratedLoudnessDb} dBFS; peak ${loudness.peakLevelDb} dBFS; short-term range ${loudness.shortTermRangeDb} dB${jumpText}${silenceText}${limitText}${quietText}.`);
  }

  const values = per.map(e => e.payload && e.payload.gainVariance).filter(Number.isFinite);
  if(!values.length) return componentUnavailable('insufficient_gain_evidence');
  return componentAvailable((1 - Math.min(1, avg(values))) * 100, { source: 'event_gain_variance', values }, `Gain variance evidence from ${values.length} event(s).`);
}

function clippingComponent(per, audioAnalysis){
  const loudness = audioAnalysis && audioAnalysis.session && audioAnalysis.session.loudnessMetrics;
  if(loudness && loudness.available){
    const durationMs = (loudness.clipping.durationSec || 0) * 1000;
    const durationScore = scoreError(durationMs, 0, 120);
    const countScore = scoreError(loudness.clipping.sampleCount || 0, 0, 2000);
    const peakScore = loudness.peakLevelDb >= -0.1 ? 80 : 100;
    const score = Math.min(durationScore, countScore, peakScore);
    const clipRange = firstRangeText(loudness.clipping.ranges);
    const measurements = {
      source: 'decoded_audio_clipping',
      sampleCount: loudness.clipping.sampleCount,
      durationSec: loudness.clipping.durationSec,
      durationMs: Math.round(durationMs),
      peakLevelDb: loudness.peakLevelDb,
      ranges: loudness.clipping.ranges
    };
    const range = clipRange ? ` at ${clipRange}` : '';
    return componentAvailable(score, measurements, `Clipping samples ${measurements.sampleCount}; duration ${measurements.durationMs} ms; peak ${measurements.peakLevelDb} dBFS${range}.`);
  }

  return booleanPayloadComponent(per, 'clipping', 'insufficient_clipping_evidence');
}

function eqControlComponent(per, audioAnalysis){
  const balance = audioAnalysis && audioAnalysis.session && audioAnalysis.session.frequencyBalance;
  if(balance && balance.available){
    const hollowScore = scoreError(balance.hollowMidPenalty, 0.05, 0.75);
    const harshScore = scoreError(balance.harshHighPenalty, 0.05, 0.75);
    const bassScore = scoreError(balance.bassHeavyPenalty, 0.05, 0.75);
    const balanceScore = scoreError(balance.balancePenalty, 0.05, 0.8);
    const score = weightedScore([
      { score: hollowScore, weight: 0.3 },
      { score: harshScore, weight: 0.25 },
      { score: bassScore, weight: 0.2 },
      { score: balanceScore, weight: 0.25 }
    ]);
    const measurements = {
      source: 'decoded_audio_band_balance',
      lowShare: balance.lowShare,
      midShare: balance.midShare,
      highShare: balance.highShare,
      lowMidRatioDb: balance.lowMidRatioDb,
      highMidRatioDb: balance.highMidRatioDb,
      hollowMidPenalty: balance.hollowMidPenalty,
      harshHighPenalty: balance.harshHighPenalty,
      bassHeavyPenalty: balance.bassHeavyPenalty,
      balancePenalty: balance.balancePenalty,
      windowCount: balance.windowCount
    };
    const defects = [];
    if(balance.hollowMidPenalty > 0.2) defects.push('hollow mids');
    if(balance.harshHighPenalty > 0.2) defects.push('harsh highs');
    if(balance.bassHeavyPenalty > 0.2) defects.push('excessive bass');
    const defectText = defects.length ? `; ${defects.join(', ')} measured across the mix` : '';
    return componentAvailable(score, measurements, `Band balance low/mid/high ${balance.lowShare}/${balance.midShare}/${balance.highShare}${defectText}.`);
  }

  const values = per.map(e => e.payload && e.payload.eqPenalty).filter(Number.isFinite);
  if(!values.length) return componentUnavailable('insufficient_eq_evidence');
  return componentAvailable((1 - Math.min(1, avg(values))) * 100, { source: 'event_eq_penalty', values }, `EQ penalty evidence from ${values.length} event(s).`);
}

function transitionFrequencyRows(per){
  return per
    .map(e => ({
      measuredActualSec: e.payload && Number.isFinite(e.payload.measuredActualSec) ? e.payload.measuredActualSec : null,
      frequency: e.payload && e.payload.transition && e.payload.transition.frequency
    }))
    .filter(row => row.frequency && row.frequency.available);
}

function frequencyOverlapComponent(per){
  const rows = transitionFrequencyRows(per).filter(row => Number.isFinite(row.frequency.frequencyMasking));
  if(!rows.length){
    const values = per.map(e => e.payload && e.payload.freqOverlap).filter(Number.isFinite);
    if(!values.length) return componentUnavailable('insufficient_frequency_overlap_evidence');
    return componentAvailable((1 - Math.min(1, avg(values))) * 100, { source: 'event_frequency_overlap', values }, `Frequency overlap evidence from ${values.length} event(s).`);
  }

  const values = rows.map(row => row.frequency.frequencyMasking);
  const score = (1 - Math.min(1, avg(values))) * 100;
  const worst = rows.slice().sort((a, b) => b.frequency.frequencyMasking - a.frequency.frequencyMasking)[0];
  const measurements = {
    source: 'transition_frequency_masking',
    averageMasking: Math.round(avg(values) * 1000) / 1000,
    maxMasking: Math.round(maxAbs(values) * 1000) / 1000,
    transitionCount: rows.length,
    ranges: rows.map(row => Object.assign({}, row.frequency.range, {
      frequencyMasking: row.frequency.frequencyMasking,
      spectralOverlap: row.frequency.spectralOverlap
    }))
  };
  const range = worst && worst.frequency.range ? rangeText(worst.frequency.range) : null;
  return componentAvailable(score, measurements, `Frequency masking average ${measurements.averageMasking}; max ${measurements.maxMasking}${range ? ` at ${range}` : ''}.`);
}

function bassClashComponent(per){
  const rows = transitionFrequencyRows(per).filter(row => Number.isFinite(row.frequency.bassOverlap));
  if(!rows.length){
    const values = per.map(e => e.payload && e.payload.bassClash).filter(Number.isFinite);
    if(!values.length) return componentUnavailable('insufficient_bass_clash_evidence');
    return componentAvailable((1 - Math.min(1, avg(values))) * 100, { source: 'event_bass_clash', values }, `Bass clash evidence from ${values.length} event(s).`);
  }

  const values = rows.map(row => row.frequency.bassOverlap);
  const score = (1 - Math.min(1, avg(values))) * 100;
  const worst = rows.slice().sort((a, b) => b.frequency.bassOverlap - a.frequency.bassOverlap)[0];
  const measurements = {
    source: 'transition_bass_overlap',
    averageBassOverlap: Math.round(avg(values) * 1000) / 1000,
    maxBassOverlap: Math.round(maxAbs(values) * 1000) / 1000,
    transitionCount: rows.length,
    ranges: rows.map(row => Object.assign({}, row.frequency.range, {
      bassOverlap: row.frequency.bassOverlap,
      centerLowShare: row.frequency.center.low
    }))
  };
  const range = worst && worst.frequency.range ? rangeText(worst.frequency.range) : null;
  return componentAvailable(score, measurements, `Bass overlap average ${measurements.averageBassOverlap}; max ${measurements.maxBassOverlap}${range ? ` at ${range}` : ''}.`);
}

function transitionHarmonicRows(per){
  return per
    .map(e => ({
      measuredActualSec: e.payload && Number.isFinite(e.payload.measuredActualSec) ? e.payload.measuredActualSec : null,
      harmonic: e.payload && e.payload.transition && e.payload.transition.harmonic
    }))
    .filter(row => row.harmonic);
}

function harmonicCompatibilityComponent(per){
  const rows = transitionHarmonicRows(per);
  const availableRows = rows.filter(row => row.harmonic.available && row.harmonic.camelot && row.harmonic.camelot.available);
  if(!availableRows.length){
    const reason = rows.length && rows[0].harmonic && rows[0].harmonic.reason ? rows[0].harmonic.reason : 'insufficient_transition_harmonic_evidence';
    return componentUnavailable(reason);
  }

  const rowScores = availableRows.map(row => {
    const h = row.harmonic;
    const relationshipScore = (h.camelot.compatibility || 0) * 100;
    const consonanceScore = Number.isFinite(h.consonance) ? h.consonance * 100 : null;
    const clashScore = Number.isFinite(h.keyClash) ? (1 - h.keyClash) * 100 : null;
    const confidenceScore = avg([h.outgoing && h.outgoing.confidence, h.incoming && h.incoming.confidence].filter(Number.isFinite)) * 100;
    return clamp(weightedScore([
      { score: relationshipScore, weight: 0.45 },
      { score: consonanceScore, weight: 0.2 },
      { score: clashScore, weight: 0.2 },
      { score: confidenceScore, weight: 0.15 }
    ]));
  }).filter(Number.isFinite);

  const score = avg(rowScores);
  const worst = availableRows
    .slice()
    .sort((a, b) => (b.harmonic.keyClash || 0) - (a.harmonic.keyClash || 0))[0];
  const measurements = {
    source: 'decoded_audio_chroma_harmony',
    transitionCount: availableRows.length,
    averageCompatibility: Math.round(avg(availableRows.map(row => row.harmonic.camelot.compatibility)) * 1000) / 1000,
    averageConsonance: Math.round(avg(availableRows.map(row => row.harmonic.consonance).filter(Number.isFinite)) * 1000) / 1000,
    averageDissonance: Math.round(avg(availableRows.map(row => row.harmonic.dissonance).filter(Number.isFinite)) * 1000) / 1000,
    averageKeyClash: Math.round(avg(availableRows.map(row => row.harmonic.keyClash).filter(Number.isFinite)) * 1000) / 1000,
    transitions: availableRows.map(row => ({
      outgoingKey: row.harmonic.outgoing.name,
      outgoingCamelot: row.harmonic.outgoing.camelot,
      incomingKey: row.harmonic.incoming.name,
      incomingCamelot: row.harmonic.incoming.camelot,
      relationship: row.harmonic.camelot.relationship,
      compatibility: row.harmonic.camelot.compatibility,
      consonance: row.harmonic.consonance,
      dissonance: row.harmonic.dissonance,
      keyClash: row.harmonic.keyClash,
      confidence: Math.round(avg([row.harmonic.outgoing.confidence, row.harmonic.incoming.confidence].filter(Number.isFinite)) * 1000) / 1000,
      range: row.harmonic.overlapRange || row.harmonic.range
    }))
  };
  const range = worst && (worst.harmonic.overlapRange || worst.harmonic.range) ? rangeText(worst.harmonic.overlapRange || worst.harmonic.range) : null;
  const feedback = worst
    ? `Harmonic transition ${worst.harmonic.outgoing.name} (${worst.harmonic.outgoing.camelot}) to ${worst.harmonic.incoming.name} (${worst.harmonic.incoming.camelot}); ${worst.harmonic.camelot.relationship}; key clash ${worst.harmonic.keyClash}${range ? ` at ${range}` : ''}.`
    : 'Harmonic compatibility measured from decoded chroma evidence.';
  return componentAvailable(score, measurements, feedback);
}

function numericPayloadComponent(per, key, mapper, reason){
  const values = per.map(e => e.payload && e.payload[key]).filter(Number.isFinite);
  if(!values.length) return componentUnavailable(reason);
  const score = mapper(values);
  return componentAvailable(score, { values }, `${key} evidence from ${values.length} event(s).`);
}

function booleanPayloadComponent(per, key, reason){
  const values = per.map(e => e.payload && e.payload[key]).filter(value => typeof value === 'boolean');
  if(!values.length) return componentUnavailable(reason);
  const ratio = values.filter(Boolean).length / values.length;
  return componentAvailable((1 - ratio) * 100, { ratio, values }, `${key} observed on ${Math.round(ratio * 100)}% of events.`);
}

function buildComponentDetails(per, audioAnalysis){
  return {
    timing: timingComponent(per),
    beat_alignment: beatAlignmentComponent(per, audioAnalysis),
    phrasing: phrasingComponent(per, audioAnalysis),
    transition_quality: transitionQualityComponent(per),
    freq_overlap: frequencyOverlapComponent(per),
    bass_clash: bassClashComponent(per),
    gain_consistency: gainControlComponent(per, audioAnalysis),
    clipping: clippingComponent(per, audioAnalysis),
    eq_control: eqControlComponent(per, audioAnalysis),
    harmonic_compatibility: harmonicCompatibilityComponent(per),
    creativity: numericPayloadComponent(per, 'creativityScore', values => {
      const average = avg(values);
      return average <= 1 ? average * 100 : average;
    }, 'insufficient_creativity_evidence'),
    scratching: numericPayloadComponent(per, 'scratchScore', values => avg(values) * 100, 'insufficient_scratch_evidence'),
    technical_difficulty: numericPayloadComponent(per, 'effectUsage', values => Math.min(100, 50 + avg(values) * 10), 'insufficient_technical_difficulty_evidence')
  };
}

function buildComponents(componentDetails){
  return Object.fromEntries(Object.entries(componentDetails).map(([key, detail]) => [key, detail.available ? detail.score : null]));
}

function computeOverall(components, componentWeights){
  let total = 0;
  let weightSum = 0;
  componentWeights.forEach(component => {
    const value = components[component.id];
    if(Number.isFinite(value)){
      total += value * component.weight;
      weightSum += component.weight;
    }
  });
  return weightSum > 0 ? Math.round(total / weightSum) : null;
}

function buildRecommendations(componentDetails){
  const recommendations = [];
  if(componentDetails.timing.available && componentDetails.timing.score < 80){
    recommendations.push(`Timing needs work: measured average offset ${componentDetails.timing.measurements.averageAbsOffsetMs} ms.`);
  }else if(!componentDetails.timing.available){
    recommendations.push('Timing score unavailable: insufficient timing evidence.');
  }

  if(componentDetails.beat_alignment.available && componentDetails.beat_alignment.score < 80){
    const m = componentDetails.beat_alignment.measurements;
    const range = m.defectRanges && m.defectRanges[0] ? rangeText(m.defectRanges[0]) : null;
    const rangeSuffix = range ? ` near ${range}` : '';
    recommendations.push(`Beatmatching needs work: initial phase ${m.initialPhaseOffsetMs ?? 'n/a'} ms, drift ${m.accumulatedDriftMs ?? m.tempoDriftBpm ?? 'n/a'}${m.accumulatedDriftMs == null ? ' BPM' : ' ms'}, local deviation ${m.averageAbsLocalDeviationMs ?? m.averageAbsBeatOffsetMs ?? 'n/a'} ms${rangeSuffix}.`);
  }else if(!componentDetails.beat_alignment.available){
    recommendations.push('Beatmatching score unavailable: insufficient beat-grid evidence.');
  }

  if(componentDetails.phrasing.available && componentDetails.phrasing.score < 80){
    recommendations.push(`Phrase mixing needs work: measured phrase offset ${componentDetails.phrasing.measurements.averagePhraseOffsetBeats} beats.`);
  }else if(!componentDetails.phrasing.available){
    recommendations.push('Phrase Mixing score unavailable: insufficient phrase-boundary evidence.');
  }

  if(componentDetails.transition_quality.available && componentDetails.transition_quality.score < 80){
    const range = componentDetails.transition_quality.measurements.sharpRanges && componentDetails.transition_quality.measurements.sharpRanges[0]
      ? rangeText(componentDetails.transition_quality.measurements.sharpRanges[0])
      : null;
    recommendations.push(`Transition quality needs work: measured abruptness ${componentDetails.transition_quality.measurements.averageAbruptness}${range ? ` at ${range}` : ''}.`);
  }else if(!componentDetails.transition_quality.available){
    recommendations.push('Transition quality score unavailable: insufficient transition evidence.');
  }

  if(componentDetails.gain_consistency.available && componentDetails.gain_consistency.score < 80){
    const m = componentDetails.gain_consistency.measurements;
    const jumpRange = firstRangeText(m.gainJumpRanges);
    const silenceRange = firstRangeText(m.silenceRanges);
    const range = jumpRange || silenceRange;
    recommendations.push(`Gain control needs work: integrated loudness ${m.integratedLoudnessDb ?? 'n/a'} dBFS, short-term range ${m.shortTermRangeDb ?? 'n/a'} dB, max gain jump ${m.maxGainJumpDb ?? 'n/a'} dB${range ? ` at ${range}` : ''}.`);
  }else if(!componentDetails.gain_consistency.available){
    recommendations.push('Gain control score unavailable: insufficient loudness evidence.');
  }

  if(componentDetails.clipping.available && componentDetails.clipping.score < 90){
    const range = firstRangeText(componentDetails.clipping.measurements.ranges);
    recommendations.push(`Reduce output gain: measured clipping duration ${componentDetails.clipping.measurements.durationMs ?? 'n/a'} ms${range ? ` at ${range}` : ''}.`);
  }else if(!componentDetails.clipping.available){
    recommendations.push('Clipping score unavailable: insufficient peak evidence.');
  }

  if(componentDetails.eq_control.available && componentDetails.eq_control.score < 80){
    const m = componentDetails.eq_control.measurements;
    recommendations.push(`EQ control needs work: low/mid/high balance ${m.lowShare ?? 'n/a'}/${m.midShare ?? 'n/a'}/${m.highShare ?? 'n/a'}.`);
  }else if(!componentDetails.eq_control.available){
    recommendations.push('EQ score unavailable: insufficient frequency-balance evidence.');
  }

  if(componentDetails.bass_clash.available && componentDetails.bass_clash.score < 80){
    const range = firstRangeText(componentDetails.bass_clash.measurements.ranges);
    recommendations.push(`Bass clash needs work: measured bass overlap ${componentDetails.bass_clash.measurements.averageBassOverlap ?? 'n/a'}${range ? ` at ${range}` : ''}.`);
  }else if(!componentDetails.bass_clash.available){
    recommendations.push('Bass clash score unavailable: insufficient transition frequency evidence.');
  }

  if(componentDetails.freq_overlap.available && componentDetails.freq_overlap.score < 80){
    const range = firstRangeText(componentDetails.freq_overlap.measurements.ranges);
    recommendations.push(`Frequency masking needs work: measured masking ${componentDetails.freq_overlap.measurements.averageMasking ?? 'n/a'}${range ? ` at ${range}` : ''}.`);
  }else if(!componentDetails.freq_overlap.available){
    recommendations.push('Frequency masking score unavailable: insufficient transition spectrum evidence.');
  }

  if(componentDetails.harmonic_compatibility.available && componentDetails.harmonic_compatibility.score < 80){
    const transition = componentDetails.harmonic_compatibility.measurements.transitions && componentDetails.harmonic_compatibility.measurements.transitions[0];
    const range = transition && transition.range ? rangeText(transition.range) : null;
    recommendations.push(`Harmonic mixing needs work: ${transition ? `${transition.outgoingKey} to ${transition.incomingKey}` : 'measured transition'} key clash ${componentDetails.harmonic_compatibility.measurements.averageKeyClash ?? 'n/a'}${range ? ` at ${range}` : ''}.`);
  }else if(!componentDetails.harmonic_compatibility.available){
    recommendations.push('Harmonic compatibility score unavailable: insufficient confident key evidence.');
  }
  return recommendations;
}

const PRODUCER_COMPONENT_WEIGHTS = Object.freeze([
  { id: 'composition', weight: 0.18 },
  { id: 'drums_rhythm', weight: 0.16 },
  { id: 'sound_selection', weight: 0.12 },
  { id: 'arrangement', weight: 0.14 },
  { id: 'mix_quality', weight: 0.16 },
  { id: 'creativity', weight: 0.08 },
  { id: 'originality', weight: 0.06 },
  { id: 'challenge_compliance', weight: 0.06 },
  { id: 'sample_use', weight: 0.02 },
  { id: 'overall_impact', weight: 0.02 }
]);

function plainObject(value){
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function audioSession(audioAnalysis){
  return audioAnalysis && audioAnalysis.session && typeof audioAnalysis.session === 'object'
    ? audioAnalysis.session
    : null;
}

function finiteNumber(value){
  if(value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundTo(value, decimals = 3){
  const number = finiteNumber(value);
  if(number == null) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(number * factor) / factor;
}

function countArray(value){
  return Array.isArray(value) ? value.length : 0;
}

function normalizedScoreValue(value){
  const number = finiteNumber(value);
  if(number == null) return null;
  return clamp(Math.abs(number) <= 1 ? number * 100 : number);
}

function firstFinite(values){
  for(const value of values){
    const number = finiteNumber(value);
    if(number != null) return number;
  }
  return null;
}

function producerContextScore(context, keys){
  const source = plainObject(context);
  const challenge = plainObject(source.challenge);
  const rules = plainObject(source.rules);
  const audit = plainObject(source.audit);
  for(const key of keys){
    const value = firstFinite([source[key], challenge[key], rules[key], audit[key]]);
    if(value != null) return normalizedScoreValue(value);
  }
  return null;
}

function producerNumericEvidenceComponent(per, context, keys, reason, label){
  const values = [];
  per.forEach(row => {
    const payload = row && row.payload || {};
    const value = firstFinite(keys.map(key => payload[key]));
    const score = normalizedScoreValue(value);
    if(score != null) values.push(score);
  });
  const contextScore = producerContextScore(context, keys);
  if(contextScore != null) values.push(contextScore);
  if(!values.length) return componentUnavailable(reason);
  const score = avg(values);
  return componentAvailable(score, { source: 'declared_manual_or_external_evidence', scores: values }, `${label} evidence from ${values.length} supplied value(s).`);
}

function producerRhythmComponent(audioAnalysis){
  const session = audioSession(audioAnalysis);
  if(!session) return componentUnavailable('insufficient_audio_session_evidence');
  const durationSec = finiteNumber(session.durationSec);
  const onsetCount = countArray(session.onsets);
  const beatGridCount = countArray(session.beatTimes);
  const bpm = finiteNumber(session.bpm);
  if(!durationSec || durationSec <= 0 || !onsetCount || !bpm) return componentUnavailable('insufficient_rhythm_evidence', { durationSec, onsetCount, bpm });

  const onsetDensity = onsetCount / durationSec;
  const densityScore = scoreInRange(onsetDensity, 1.2, 8, 0.1, 14);
  const beatCoverageScore = beatGridCount ? scoreInRange(beatGridCount / durationSec, 1.1, 4, 0.05, 6) : null;
  const drift = plainObject(session.drift);
  const driftScore = Number.isFinite(drift.tempoDriftBpm) ? scoreError(drift.tempoDriftBpm, 1.5, 10) : null;
  const phrase = plainObject(session.phrase);
  const phraseScore = phrase.available ? 100 : phrase.reason ? 64 : null;
  const score = weightedScore([
    { score: densityScore, weight: 0.4 },
    { score: beatCoverageScore, weight: 0.25 },
    { score: driftScore, weight: 0.2 },
    { score: phraseScore, weight: 0.15 }
  ]);
  const measurements = {
    source: 'decoded_audio_rhythm',
    bpm: roundTo(bpm, 2),
    durationSec: roundTo(durationSec, 3),
    onsetCount,
    beatGridCount,
    onsetDensity: roundTo(onsetDensity, 3),
    tempoDriftBpm: Number.isFinite(drift.tempoDriftBpm) ? drift.tempoDriftBpm : null,
    phraseLengthBeats: phrase.phraseLengthBeats || null,
    phraseEvidence: phrase.available ? 'inferred_from_onset_energy' : phrase.reason || null
  };
  return componentAvailable(score, measurements, `Rhythm measured at ${measurements.bpm} BPM with ${measurements.onsetCount} onsets and density ${measurements.onsetDensity}/s.`);
}

function producerMixQualityComponent(audioAnalysis){
  const gain = gainControlComponent([], audioAnalysis);
  const clipping = clippingComponent([], audioAnalysis);
  const eq = eqControlComponent([], audioAnalysis);
  const score = weightedScore([
    { score: gain.score, weight: 0.38 },
    { score: clipping.score, weight: 0.24 },
    { score: eq.score, weight: 0.38 }
  ]);
  if(score == null) return componentUnavailable('insufficient_mix_quality_evidence');
  const measurements = {
    source: 'decoded_audio_mix_health',
    gain: gain.available ? gain.measurements : null,
    clipping: clipping.available ? clipping.measurements : null,
    eq: eq.available ? eq.measurements : null
  };
  return componentAvailable(score, measurements, `Mix quality combined gain, clipping, and frequency-balance measurements.`);
}

function producerSoundSelectionComponent(audioAnalysis){
  const session = audioSession(audioAnalysis);
  if(!session) return componentUnavailable('insufficient_audio_session_evidence');
  const balance = plainObject(session.frequencyBalance);
  const harmonic = plainObject(session.harmonic);
  const balanceScore = balance.available
    ? scoreError(balance.balancePenalty, 0.05, 0.8)
    : null;
  const midPresenceScore = balance.available
    ? scoreInRange(balance.midShare, 0.34, 0.72, 0.08, 0.92)
    : null;
  const harmonicScore = harmonic.available
    ? scoreInRange(harmonic.confidence, 0.35, 1, 0.05, 1.2)
    : null;
  const score = weightedScore([
    { score: balanceScore, weight: 0.5 },
    { score: midPresenceScore, weight: 0.28 },
    { score: harmonicScore, weight: 0.22 }
  ]);
  if(score == null) return componentUnavailable('insufficient_sound_selection_evidence');
  const measurements = {
    source: 'decoded_audio_tonal_balance',
    lowShare: balance.available ? balance.lowShare : null,
    midShare: balance.available ? balance.midShare : null,
    highShare: balance.available ? balance.highShare : null,
    balancePenalty: balance.available ? balance.balancePenalty : null,
    harmonicKey: harmonic.available && harmonic.key ? harmonic.key.name || null : null,
    harmonicConfidence: harmonic.available ? harmonic.confidence : null
  };
  return componentAvailable(score, measurements, `Sound palette measured from frequency balance${measurements.harmonicKey ? ` and detected ${measurements.harmonicKey}` : ''}.`);
}

function producerArrangementComponent(audioAnalysis){
  const session = audioSession(audioAnalysis);
  if(!session) return componentUnavailable('insufficient_audio_session_evidence');
  const durationSec = finiteNumber(session.durationSec);
  if(!durationSec || durationSec <= 0) return componentUnavailable('insufficient_arrangement_evidence');
  const transitions = countArray(session.transitions);
  const sectionCount = transitions + 1;
  const phrase = plainObject(session.phrase);
  const loudness = plainObject(session.loudnessMetrics);
  const sectionScore = scoreInRange(sectionCount, 2, 8, 1, 18);
  const durationScore = scoreInRange(durationSec, 35, 240, 8, 420);
  const phraseScore = phrase.available ? 100 : phrase.reason ? 66 : null;
  const silenceScore = loudness.available && loudness.silence ? scoreError(loudness.silence.maxDurationSec || 0, 0.2, 2.5) : null;
  const score = weightedScore([
    { score: sectionScore, weight: 0.32 },
    { score: durationScore, weight: 0.24 },
    { score: phraseScore, weight: 0.22 },
    { score: silenceScore, weight: 0.22 }
  ]);
  const measurements = {
    source: 'decoded_audio_arrangement',
    durationSec: roundTo(durationSec, 3),
    detectedSectionChanges: transitions,
    estimatedSectionCount: sectionCount,
    phraseLengthBeats: phrase.phraseLengthBeats || null,
    phraseEvidence: phrase.available ? 'inferred_from_onset_energy' : phrase.reason || null,
    maxSilenceDurationSec: loudness.available && loudness.silence ? loudness.silence.maxDurationSec || 0 : null
  };
  return componentAvailable(score, measurements, `Arrangement evidence found ${sectionCount} section area(s) over ${measurements.durationSec}s.`);
}

function producerChallengeComplianceComponent(audioAnalysis, context){
  const session = audioSession(audioAnalysis);
  const source = plainObject(context);
  const challenge = plainObject(source.challenge);
  const rules = plainObject(source.rules);
  const targetBpm = firstFinite([source.targetBpm, source.bpmTarget, challenge.targetBpm, challenge.bpmTarget, rules.targetBpm, rules.bpmTarget]);
  const targetDurationSec = firstFinite([source.targetAudioDurationSec, source.audioDurationSec, challenge.targetAudioDurationSec, rules.targetAudioDurationSec]);
  const minDurationSec = firstFinite([source.minAudioDurationSec, challenge.minAudioDurationSec, rules.minAudioDurationSec]);
  const maxDurationSec = firstFinite([source.maxAudioDurationSec, challenge.maxAudioDurationSec, rules.maxAudioDurationSec]);
  const checks = [];
  const measurements = { source: 'declared_challenge_rules' };

  if(targetBpm != null && session && finiteNumber(session.bpm) != null){
    const delta = finiteNumber(session.bpm) - targetBpm;
    checks.push(scoreError(delta, 1, 8));
    measurements.targetBpm = targetBpm;
    measurements.measuredBpm = roundTo(session.bpm, 2);
    measurements.bpmDelta = roundTo(delta, 2);
  }
  if(targetDurationSec != null && session && finiteNumber(session.durationSec) != null){
    const delta = finiteNumber(session.durationSec) - targetDurationSec;
    checks.push(scoreError(delta, 2, 20));
    measurements.targetAudioDurationSec = targetDurationSec;
    measurements.durationSec = roundTo(session.durationSec, 3);
    measurements.durationDeltaSec = roundTo(delta, 3);
  }
  if((minDurationSec != null || maxDurationSec != null) && session && finiteNumber(session.durationSec) != null){
    const duration = finiteNumber(session.durationSec);
    const low = minDurationSec == null ? 0 : minDurationSec;
    const high = maxDurationSec == null ? Number.MAX_SAFE_INTEGER : maxDurationSec;
    checks.push(duration >= low && duration <= high ? 100 : scoreError(duration < low ? low - duration : duration - high, 1, 30));
    measurements.minAudioDurationSec = minDurationSec;
    measurements.maxAudioDurationSec = maxDurationSec;
    measurements.durationSec = roundTo(duration, 3);
  }

  const usable = checks.filter(Number.isFinite);
  if(!usable.length) return componentUnavailable('insufficient_challenge_compliance_evidence');
  return componentAvailable(avg(usable), measurements, `Challenge compliance measured from ${usable.length} declared rule check(s).`);
}

function producerSampleUseComponent(context){
  const source = plainObject(context);
  const sample = plainObject(source.sampleAudit || source.sampleCompliance || source.sampleUse);
  const score = normalizedScoreValue(firstFinite([sample.score, sample.sampleUseScore, source.sampleUseScore]));
  if(score != null){
    return componentAvailable(score, { source: 'declared_sample_audit', score }, 'Sample-use evidence supplied by sample audit metadata.');
  }
  const detected = sample.detected ?? sample.sampleDetected ?? source.sampleDetected;
  if(typeof detected === 'boolean'){
    return componentAvailable(detected ? 100 : 0, { source: 'declared_sample_audit', sampleDetected: detected }, 'Sample-use detection supplied by sample audit metadata.');
  }
  return componentUnavailable('insufficient_sample_use_evidence');
}

function producerCompositionComponent(details){
  const score = weightedScore([
    { score: details.drums_rhythm.score, weight: 0.34 },
    { score: details.arrangement.score, weight: 0.28 },
    { score: details.sound_selection.score, weight: 0.2 },
    { score: details.mix_quality.score, weight: 0.18 }
  ]);
  if(score == null) return componentUnavailable('insufficient_composition_evidence');
  const measurements = {
    source: 'producer_audio_component_rollup',
    drumsRhythm: details.drums_rhythm.score,
    arrangement: details.arrangement.score,
    soundSelection: details.sound_selection.score,
    mixQuality: details.mix_quality.score
  };
  return componentAvailable(score, measurements, 'Composition score derived from measurable rhythm, arrangement, sound-selection, and mix-quality components.');
}

function buildProducerComponentDetails(per, audioAnalysis, context){
  const details = {
    drums_rhythm: producerRhythmComponent(audioAnalysis),
    sound_selection: producerSoundSelectionComponent(audioAnalysis),
    arrangement: producerArrangementComponent(audioAnalysis),
    mix_quality: producerMixQualityComponent(audioAnalysis),
    creativity: producerNumericEvidenceComponent(per, context, ['creativityScore', 'creativity'], 'insufficient_creativity_evidence', 'Creativity'),
    originality: producerNumericEvidenceComponent(per, context, ['originalityScore', 'originality'], 'insufficient_originality_evidence', 'Originality'),
    challenge_compliance: producerChallengeComplianceComponent(audioAnalysis, context),
    sample_use: producerSampleUseComponent(context),
    overall_impact: producerNumericEvidenceComponent(per, context, ['impactScore', 'overallImpactScore', 'overallImpact'], 'insufficient_overall_impact_evidence', 'Overall impact')
  };
  details.composition = producerCompositionComponent(details);
  return {
    composition: details.composition,
    drums_rhythm: details.drums_rhythm,
    sound_selection: details.sound_selection,
    arrangement: details.arrangement,
    mix_quality: details.mix_quality,
    creativity: details.creativity,
    originality: details.originality,
    challenge_compliance: details.challenge_compliance,
    sample_use: details.sample_use,
    overall_impact: details.overall_impact
  };
}

function buildProducerRecommendations(componentDetails){
  const recommendations = [];
  if(componentDetails.drums_rhythm.available && componentDetails.drums_rhythm.score < 80){
    recommendations.push(`Rhythm needs work: measured onset density ${componentDetails.drums_rhythm.measurements.onsetDensity ?? 'n/a'}/s at ${componentDetails.drums_rhythm.measurements.bpm ?? 'n/a'} BPM.`);
  }else if(!componentDetails.drums_rhythm.available){
    recommendations.push('Rhythm score unavailable: insufficient BPM and onset evidence.');
  }
  if(componentDetails.arrangement.available && componentDetails.arrangement.score < 80){
    recommendations.push(`Arrangement needs work: measured ${componentDetails.arrangement.measurements.estimatedSectionCount ?? 'n/a'} section area(s) over ${componentDetails.arrangement.measurements.durationSec ?? 'n/a'} seconds.`);
  }else if(!componentDetails.arrangement.available){
    recommendations.push('Arrangement score unavailable: insufficient whole-file structure evidence.');
  }
  if(componentDetails.mix_quality.available && componentDetails.mix_quality.score < 85){
    const gain = componentDetails.mix_quality.measurements.gain || {};
    recommendations.push(`Mix quality needs work: integrated loudness ${gain.integratedLoudnessDb ?? 'n/a'} dBFS, peak ${gain.peakLevelDb ?? 'n/a'} dBFS.`);
  }else if(!componentDetails.mix_quality.available){
    recommendations.push('Mix quality score unavailable: insufficient loudness, clipping, and EQ evidence.');
  }
  if(componentDetails.sound_selection.available && componentDetails.sound_selection.score < 80){
    const m = componentDetails.sound_selection.measurements;
    recommendations.push(`Sound selection needs work: low/mid/high balance ${m.lowShare ?? 'n/a'}/${m.midShare ?? 'n/a'}/${m.highShare ?? 'n/a'}.`);
  }else if(!componentDetails.sound_selection.available){
    recommendations.push('Sound selection score unavailable: insufficient tonal-balance evidence.');
  }
  if(!componentDetails.challenge_compliance.available){
    recommendations.push('Challenge compliance score unavailable: no measurable challenge target evidence was supplied.');
  }
  return recommendations;
}

function producerAudioEvidence(audioAnalysis){
  const session = audioSession(audioAnalysis);
  return {
    available: Boolean(session),
    bpm: session ? session.bpm : null,
    durationSec: session ? session.durationSec : null,
    onsetCount: session && Array.isArray(session.onsets) ? session.onsets.length : 0,
    beatGridCount: session && Array.isArray(session.beatTimes) ? session.beatTimes.length : 0,
    transitionCount: session && Array.isArray(session.transitions) ? session.transitions.length : 0,
    loudness: session ? session.loudnessMetrics || null : null,
    frequencyBalance: session ? session.frequencyBalance || null : null,
    harmonic: session ? session.harmonic || null : null,
    phrase: session ? session.phrase || null : null
  };
}

function analyzeProducerBeat(rawEvents, options = {}){
  const per = buildRawMeasurements(Array.isArray(rawEvents) ? rawEvents : []);
  mergeAudioEvidence(per, options.audioAnalysis);
  const componentDetails = buildProducerComponentDetails(per, options.audioAnalysis, options.battleContext || {});
  const components = buildComponents(componentDetails);
  const overall = computeOverall(components, options.components || PRODUCER_COMPONENT_WEIGHTS);
  const timeline = per.map(e => ({
    label: e.label,
    timeMs: e.payload && Number.isFinite(e.payload.measuredActualSec) ? Math.round(e.payload.measuredActualSec * 1000) : e.actualMs,
    measuredActualSec: e.payload && Number.isFinite(e.payload.measuredActualSec) ? e.payload.measuredActualSec : null,
    notes: e.payload && e.payload.note ? e.payload.note : null
  }));
  const unavailableComponents = Object.entries(componentDetails).filter(([, detail]) => !detail.available).map(([key, detail]) => ({ id: key, reason: detail.reason }));

  return {
    meta: {
      analyzedAt: options.analyzedAt || new Date().toISOString(),
      discipline: 'producer',
      events: per.length,
      audioEvidence: producerAudioEvidence(options.audioAnalysis),
      unavailableComponents
    },
    rawMeasurements: per,
    components,
    componentDetails,
    overallScore: overall,
    timeline,
    recommendations: buildProducerRecommendations(componentDetails)
  };
}

function analyzePerformance(rawEvents, options = {}){
  const per = buildRawMeasurements(Array.isArray(rawEvents) ? rawEvents : []);
  const defaultComponents = options.components || [
    { id: 'timing', weight: 0.22 },
    { id: 'beat_alignment', weight: 0.14 },
    { id: 'phrasing', weight: 0.12 },
    { id: 'transition_quality', weight: 0.12 },
    { id: 'freq_overlap', weight: 0.08 },
    { id: 'bass_clash', weight: 0.06 },
    { id: 'gain_consistency', weight: 0.06 },
    { id: 'clipping', weight: 0.05 },
    { id: 'eq_control', weight: 0.05 },
    { id: 'creativity', weight: 0.1 }
  ];

  mergeAudioEvidence(per, options.audioAnalysis);
  const componentDetails = buildComponentDetails(per, options.audioAnalysis);
  const components = buildComponents(componentDetails);
  const overall = computeOverall(components, defaultComponents);

  const timeline = per.map((e, idx) => ({
    label: e.label,
    timeMs: e.payload && Number.isFinite(e.payload.measuredActualSec) ? Math.round(e.payload.measuredActualSec * 1000) : e.actualMs,
    timingOffsetMs: e.payload && Number.isFinite(e.payload.timingOffsetMs) ? e.payload.timingOffsetMs : e.diffMs,
    beatGridOffsetMs: e.payload && Number.isFinite(e.payload.beatGridOffsetMs) ? e.payload.beatGridOffsetMs : null,
    alignment: e.payload && e.payload.alignment ? e.payload.alignment : null,
    phraseOffsetBeats: e.payload && Number.isFinite(e.payload.phraseOffsetBeats) ? e.payload.phraseOffsetBeats : null,
    transitionAbruptness: e.payload && e.payload.transition && Number.isFinite(e.payload.transition.abruptness) ? e.payload.transition.abruptness : null,
    frequencyMasking: e.payload && e.payload.transition && e.payload.transition.frequency && Number.isFinite(e.payload.transition.frequency.frequencyMasking) ? e.payload.transition.frequency.frequencyMasking : null,
    bassOverlap: e.payload && e.payload.transition && e.payload.transition.frequency && Number.isFinite(e.payload.transition.frequency.bassOverlap) ? e.payload.transition.frequency.bassOverlap : null,
    harmonic: e.payload && e.payload.transition && e.payload.transition.harmonic ? e.payload.transition.harmonic : null,
    gainVariance: e.payload && Number.isFinite(e.payload.gainVariance) ? e.payload.gainVariance : null,
    eqPenalty: e.payload && Number.isFinite(e.payload.eqPenalty) ? e.payload.eqPenalty : null,
    timingScore: componentDetails.timing.available ? scoreError((e.payload && Number.isFinite(e.payload.timingOffsetMs)) ? e.payload.timingOffsetMs : e.diffMs, 20, 250) : null,
    beatScore: componentDetails.beat_alignment.available && e.payload && e.payload.alignment
      ? scoreError((Math.abs(e.payload.alignment.phaseOffsetMs || 0) * 0.5) + Math.abs(e.payload.alignment.localBeatDeviationMs || 0), 20, 250)
      : (componentDetails.beat_alignment.available && e.payload && Number.isFinite(e.payload.beatGridOffsetMs) ? scoreError(e.payload.beatGridOffsetMs, 15, 120) : null),
    phraseScore: componentDetails.phrasing.available && e.payload && Number.isFinite(e.payload.phraseOffsetBeats) ? scoreError(e.payload.phraseOffsetBeats, 0.25, 2) : null,
    notes: e.payload && e.payload.note ? e.payload.note : null
  }));

  const unavailableComponents = Object.entries(componentDetails).filter(([, detail]) => !detail.available).map(([key, detail]) => ({ id: key, reason: detail.reason }));

  return {
    meta: {
      analyzedAt: options.analyzedAt || new Date().toISOString(),
      events: per.length,
      audioEvidence: {
        available: Boolean(options.audioAnalysis && options.audioAnalysis.session),
        bpm: options.audioAnalysis && options.audioAnalysis.session ? options.audioAnalysis.session.bpm : null,
        onsetCount: options.audioAnalysis && options.audioAnalysis.session && Array.isArray(options.audioAnalysis.session.onsets) ? options.audioAnalysis.session.onsets.length : 0,
        beatGridCount: options.audioAnalysis && options.audioAnalysis.session && Array.isArray(options.audioAnalysis.session.beatTimes) ? options.audioAnalysis.session.beatTimes.length : 0,
        drift: options.audioAnalysis && options.audioAnalysis.session ? options.audioAnalysis.session.drift || null : null,
        alignment: options.audioAnalysis && options.audioAnalysis.session ? options.audioAnalysis.session.alignment || null : null,
        phrase: options.audioAnalysis && options.audioAnalysis.session ? options.audioAnalysis.session.phrase || null : null,
        loudness: options.audioAnalysis && options.audioAnalysis.session ? options.audioAnalysis.session.loudnessMetrics || null : null,
        frequencyBalance: options.audioAnalysis && options.audioAnalysis.session ? options.audioAnalysis.session.frequencyBalance || null : null,
        harmonic: options.audioAnalysis && options.audioAnalysis.session ? options.audioAnalysis.session.harmonic || null : null,
        transitionCount: options.audioAnalysis && options.audioAnalysis.session && Array.isArray(options.audioAnalysis.session.transitions) ? options.audioAnalysis.session.transitions.length : 0
      },
      unavailableComponents
    },
    rawMeasurements: per,
    components,
    componentDetails,
    overallScore: overall,
    timeline,
    recommendations: buildRecommendations(componentDetails)
  };
}

module.exports = {
  analyzeProducerBeat,
  analyzePerformance,
  buildRawMeasurements,
  scoreError
};
