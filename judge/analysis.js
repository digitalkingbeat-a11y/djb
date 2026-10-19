/* Judge Analysis — computes per-transition metrics and overall scores
   Exposes: DJJudge.analyzePerformance(events, options)
*/
(function(global){
  function msPerBeat(bpm){ return 60000 / (bpm || 120); }

  function severityToScore(name){
    switch(name){
      case 'Exceptional': return 100;
      case 'Excellent': return 96;
      case 'Very Good': return 90;
      case 'Good': return 82;
      case 'Noticeable': return 70;
      case 'Significant': return 55;
      case 'Major': return 30;
    }
    return 50;
  }

  function analyzeEvent(ev){
    const bpm = ev.bpm || 120;
    const idealMs = (ev.idealMs != null) ? ev.idealMs : (ev.idealSec*1000);
    const actualMs = (ev.actualMs != null) ? ev.actualMs : (ev.actualSec*1000);
    const diff = actualMs - idealMs;
    const beatMs = msPerBeat(bpm);
    const beats = diff / beatMs;
    const absMs = Math.abs(diff);
    // severity
    let severity = 'Major';
    if(absMs <= 30) severity='Exceptional'; else if(absMs<=75) severity='Excellent'; else if(absMs<=125) severity='Very Good'; else if(absMs<=200) severity='Good'; else if(absMs<=300) severity='Noticeable'; else if(absMs<=500) severity='Significant';

    // basic technical measures (placeholders when no audio analysis available)
    const timingScore = severityToScore(severity);
    const beatmatchingScore = Math.max(0, 100 - Math.min(100, Math.abs(beats)*40));
    const phraseMatchScore = ev.phraseOverlap ? Math.max(40, 100 - Math.abs(beats)*30) : 100;
    const gainPenalty = ev.clipping ? 0 : (ev.gainVariance ? Math.max(50, 100 - ev.gainVariance*20) : 95);
    const eqPenalty = ev.freqOverlap ? Math.max(40, 100 - (ev.freqOverlap*80)) : 95;

    // transition duration score: shorter isn't always better — prefer controlled durations
    const durationMs = ev.durationMs || (ev.actualMs - (ev.startMs || (ev.actualMs-2000)));
    const transitionDurationScore = Math.max(40, 100 - Math.abs((durationMs||0)-400)/10);

    const eventScore = Math.round((timingScore*0.35 + beatmatchingScore*0.15 + phraseMatchScore*0.15 + gainPenalty*0.15 + eqPenalty*0.1 + transitionDurationScore*0.1));

    const critique = buildCritique(ev, diff, beats, severity);

    return {
      label: ev.label || 'Event', idealMs, actualMs, diffMs: diff, diffBeats: beats, bpm, beatMs, severity, timingScore, beatmatchingScore, phraseMatchScore, gainPenalty, eqPenalty, transitionDurationScore, eventScore, critique
    };
  }

  function buildCritique(ev, diffMs, beats, severity){
    const dir = diffMs>0 ? 'late' : (diffMs<0 ? 'early' : 'on-time');
    const absMs = Math.abs(Math.round(diffMs));
    let lines = [];
    lines.push(`Your transition landed ${absMs} ms ${dir} (${Math.abs(beats).toFixed(2)} beats).`);
    if(ev.phraseOverlap) lines.push('The landing crossed a phrase boundary which affected musical impact.'); else lines.push('The landing remained inside the phrase boundary.');
    if(ev.clipping) lines.push('Clipping detected — reduce gain or apply limiter.');
    if(ev.freqOverlap) lines.push('Frequency overlap detected in low/mid bands — consider EQ carve or ducking.');
    if(Math.abs(beats) > 0.5) lines.push('Large beat offset — practice starting the transition earlier or use a different cue point.');
    if(severity === 'Exceptional') lines.push('Excellent timing — near perfect.');
    return lines.join(' ');
  }

  function analyzePerformance(events, options={}){
    // events: array of event objects with minimal properties
    const per = events.map(analyzeEvent);

    // Aggregate component scores across events
    const timingAvg = average(per.map(p=>p.timingScore));
    const beatAvg = average(per.map(p=>p.beatmatchingScore));
    const phraseAvg = average(per.map(p=>p.phraseMatchScore));
    const gainAvg = average(per.map(p=>p.gainPenalty));
    const eqAvg = average(per.map(p=>p.eqPenalty));
    const transitionAvg = average(per.map(p=>p.transitionDurationScore));

    const technicalScore = round((timingAvg*0.35 + beatAvg*0.15 + phraseAvg*0.15 + gainAvg*0.15 + eqAvg*0.1 + transitionAvg*0.1),1);
    const creativityScore = options.creativityScore != null ? options.creativityScore : Math.min(100, Math.max(40, 75 + (Math.random()*20-10)));
    const selectionScore = options.selectionScore != null ? options.selectionScore : 88;

    const judgePerformanceScore = round((technicalScore*0.7 + creativityScore*0.2 + selectionScore*0.1),1);
    const overall = round((judgePerformanceScore*0.9 + technicalScore*0.1),1);

    const timeline = per.map((p,i)=>({ timeMs: p.actualMs, label: p.label, summary: p.critique.split('. ')[0], severity: p.severity, details: p }));

    return {
      overallScore: overall,
      technicalScore,
      creativityScore,
      selectionScore,
      components: { timingAvg: round(timingAvg,1), beatAvg: round(beatAvg,1), phraseAvg: round(phraseAvg,1), gainAvg: round(gainAvg,1), eqAvg: round(eqAvg,1), transitionAvg: round(transitionAvg,1) },
      perEvent: per,
      timeline
    };
  }

  function average(arr){ if(!arr||arr.length===0) return 0; return arr.reduce((a,b)=>a+(b||0),0)/arr.length; }
  function round(v,dec=0){ const m = Math.pow(10,dec); return Math.round((v||0)*m)/m; }

  global.DJJudge = { analyzePerformance };
})(window);
