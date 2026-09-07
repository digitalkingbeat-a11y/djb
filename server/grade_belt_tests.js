/*
 Belt grading worker
 - polls unprocessed telemetry_events grouped by session_id
 - if a session_id matches a belt_tests.id, grade the events against the test.criteria
 - insert a belt_attempt and award user_belts when passed
*/
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
if(!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY required');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const Judge = require('./judge_engine');
const { buildJudgeBreakdownPayload, buildBeltAttemptBreakdownPayload } = require('./analysis_storage');
const { getFFmpegCapability, publicFFmpegCapabilityStatus } = require('./ffmpeg_capability');

async function processOnce(){
  try{
    // fetch belt_tests id list and then only query telemetry events whose session_id matches a belt test
    const bt = await supabase.from('belt_tests').select('id');
    const beltIds = (bt.data || []).map(b=>String(b.id));
    if(!beltIds.length) return; // nothing to grade
    const q = await supabase.from('telemetry_events').select('*').eq('processed', false).in('session_id', beltIds).order('timestamp',{ascending:true}).limit(500);
    if(q.error) throw q.error;
    const rows = q.data || [];
    if(rows.length===0) return;
    // group by session_id
    const groups = {};
    rows.forEach(r=>{
      const sid = r.session_id;
      groups[sid] = groups[sid] || { events: [], user_id: r.user_id };
      groups[sid].events.push(r);
    });

    for(const [sessionId, grp] of Object.entries(groups)){
      // Run universal Judge analysis on the session events (preserves rawMeasurements)
      let events = grp.events.map(r=> r.payload ? r.payload : r);
      let audioAnalysis = null;
      try{
        const audioPaths = (grp.events || []).map(e=> (e.payload && (e.payload.audioUrl || e.payload.audioPath)) || e.audio_path).filter(x=>x);
        const audioPath = audioPaths.length ? audioPaths[0] : null;
        if(audioPath){
          const capability = getFFmpegCapability();
          if(!capability.available){
            console.warn('audio analysis skipped', publicFFmpegCapabilityStatus(capability));
          }else{
            const analyzer = require('./audio_analyzer_ffmpeg');
            audioAnalysis = await analyzer.analyzeSessionAudio({ audioPath, events });
            if(audioAnalysis && audioAnalysis.perEvent){ audioAnalysis.perEvent.forEach(pe=>{ if(events[pe.index]) events[pe.index] = Object.assign({}, events[pe.index], pe); }); }
          }
        }
      }catch(e){ console.warn('audio analysis failed', e); }
      const result = Judge.analyzePerformance(events, { audioAnalysis });

      const jb = buildJudgeBreakdownPayload({
        userId: grp.user_id,
        battleId: null,
        source: 'belt_grader_worker',
        context: { sessionId },
        analysis: result
      });
      const insJB = await supabase.from('judge_breakdowns').insert([jb]).select('*');
      if(insJB.error) console.error('insert judge_breakdown err', insJB.error);

      // If this session corresponds to an explicit belt test, fetch the test record
      const tQ = await supabase.from('belt_tests').select('*').eq('id', sessionId).limit(1).single();
      if(tQ.error){ console.warn('belt_tests lookup err', tQ.error); }
      const test = tQ && tQ.data ? tQ.data : null;

      // Only create a belt_attempt when the test type is explicitly a belt exam
      const isBeltExam = (test && (test.test_type === 'belt_exam' || (test.criteria && test.criteria.belt))) || false;
      if(isBeltExam){
        const attemptRow = {
          user_id: grp.user_id || null,
          test_id: sessionId,
          score: result.overallScore,
          passing_score: test.passing_score || (test.criteria && test.criteria.passing_score) || 0,
          breakdown: buildBeltAttemptBreakdownPayload({
            source: 'belt_grader_worker',
            context: { sessionId },
            analysis: result
          })
        };
        const insA = await supabase.from('belt_attempts').insert([attemptRow]).select('*');
        if(insA.error) console.error('belt_attempts insert error', insA.error);
        // Do NOT auto-award belts here for general sessions; award only when explicitly required
        const attempt = insA.data && insA.data[0] ? insA.data[0] : null;
        if(attempt){
          const passed = Number(attempt.score) >= Number(attempt.passing_score || 0);
          if(passed){
            const beltCode = test.code || (test.criteria && test.criteria.belt) || null;
            if(beltCode){
              // Upsert user_belts as evidence only; actual award flow can be admin-verified
              const existing = await supabase.from('user_belts').select('*').eq('user_id', grp.user_id).limit(1).single();
              if(existing.error && existing.error.code !== 'PGRST116'){ console.warn('user_belts select err', existing.error); }
              if(existing.data){
                const upd = await supabase.from('user_belts').update({ belt_code: beltCode, awarded_at: new Date().toISOString(), evidence: attempt.breakdown }).eq('user_id', grp.user_id);
                if(upd.error) console.error('user_belts update err', upd.error);
              } else {
                const insB = await supabase.from('user_belts').insert([{ user_id: grp.user_id, belt_code: beltCode, awarded_at: new Date().toISOString(), evidence: attempt.breakdown }]);
                if(insB.error) console.error('user_belts insert err', insB.error);
              }
            }
          }
        }
      }

      // mark telemetry processed
      const ids = grp.events.map(e=>e.id);
      const upd = await supabase.from('telemetry_events').update({ processed: true }).in('id', ids);
      if(upd.error) console.error('telemetry mark processed err', upd.error);
    }

  }catch(err){ console.error('grade_belt_tests error', err); }
}

async function loop(){
  while(true){ await processOnce(); await new Promise(r=>setTimeout(r, 8000)); }
}

if(require.main === module){ console.log('Starting belt grading worker...'); loop().catch(e=>{ console.error(e); process.exit(1); }); }
