function averageTimingMs(rawMeasurements){
  const timed = (rawMeasurements || []).filter(measurement => measurement.diffMs != null);
  if(!timed.length) return null;
  return timed.reduce((total, measurement) => total + Math.abs(measurement.diffMs), 0) / timed.length;
}

function buildTimingAnalysisPayload({ userId, battleId, source, groupKey, analysis }){
  const events = analysis.rawMeasurements || [];
  return {
    user_id: userId || null,
    battle_id: battleId || null,
    recorded_at: new Date().toISOString(),
    duration: null,
    meta: {
      source,
      groupKey,
      summary: { avgTimingMs: averageTimingMs(events) }
    },
    events
  };
}

function buildJudgeBreakdownPayload({ userId, battleId, source, context = {}, analysis }){
  return {
    user_id: userId,
    battle_id: battleId || null,
    recorded_at: new Date().toISOString(),
    duration: analysis.meta && analysis.meta.duration ? analysis.meta.duration : null,
    meta: {
      source,
      ...context,
      analysis: {
        meta: analysis.meta || {},
        components: analysis.components || {},
        overall_score: analysis.overallScore ?? null,
        recommendations: analysis.recommendations || []
      }
    },
    per_event: analysis.rawMeasurements || analysis.perEvent || []
  };
}

function buildBeltAttemptBreakdownPayload({ source, context = {}, analysis }){
  return {
    source,
    ...context,
    analysis: {
      meta: analysis.meta || {},
      components: analysis.components || {},
      overall_score: analysis.overallScore ?? null,
      recommendations: analysis.recommendations || []
    },
    per_event: analysis.rawMeasurements || analysis.perEvent || []
  };
}

module.exports = { buildTimingAnalysisPayload, buildJudgeBreakdownPayload, buildBeltAttemptBreakdownPayload };
