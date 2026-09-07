/**
 * Telemetry processing worker
 * - polls `telemetry_events` for unprocessed rows
 * - groups events by session_id (or user_id+battle_id)
 * - computes lightweight analysis and inserts into judge_breakdowns and timing_analysis
 * - marks processed telemetry_events
 */
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
if(!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY required');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const Judge = require('./judge_engine');
const { buildTimingAnalysisPayload, buildJudgeBreakdownPayload } = require('./analysis_storage');
const { getFFmpegCapability, publicFFmpegCapabilityStatus } = require('./ffmpeg_capability');

async function runOnce(){
  try{
    // fetch belt test ids to avoid processing belt exam sessions here (those are handled by the belt grader worker)
    const bt = await supabase.from('belt_tests').select('id');
    const beltIds = (bt.data || []).map(b=>String(b.id));
    const q = await supabase.from('telemetry_events').select('*').eq('processed', false).order('timestamp', { ascending: true }).limit(500);
    if(q.error) throw q.error;
    const rows = q.data || [];
    if(rows.length === 0) return;
    // Group by session_id (fallback to user_id+battle_id)
    const groups = {};
    rows.forEach(r=>{
      const key = r.session_id || `${r.user_id||'u'}::${r.battle_id||'b'}`;
      groups[key] = groups[key] || { meta: { user_id: r.user_id, session_id: r.session_id, battle_id: r.battle_id }, events: [] };
      groups[key].events.push(r);
    });

    for(const [key, grp] of Object.entries(groups)){
      // skip groups that are explicit belt exam sessions so the belt grader handles them
      if(grp.meta && grp.meta.session_id && beltIds.includes(String(grp.meta.session_id))){
        continue;
      }
      // Use the universal Judge to analyze the grouped events
      let events = grp.events.map(r=> r.payload ? r.payload : r);
      // If audio metadata is available, run audio analysis to augment payloads
      let audioAnalysis = null;
      try{
        const audioPaths = (grp.events || []).map(e=> (e.payload && (e.payload.audioUrl || e.payload.audioPath)) || e.audio_path).filter(x=>x);
        const audioPath = audioPaths.length ? audioPaths[0] : (grp.meta && grp.meta.audio_path) || null;
        if(audioPath){
          const capability = getFFmpegCapability();
          if(!capability.available){
            console.warn('audio analysis skipped', publicFFmpegCapabilityStatus(capability));
          }else{
            const analyzer = require('./audio_analyzer_ffmpeg');
            audioAnalysis = await analyzer.analyzeSessionAudio({ audioPath, events });
            if(audioAnalysis && audioAnalysis.perEvent){
              audioAnalysis.perEvent.forEach(pe=>{ if(events[pe.index]) events[pe.index] = Object.assign({}, events[pe.index], pe); });
            }
          }
        }
      }catch(e){ console.warn('audio analysis failed', e); }

      const result = Judge.analyzePerformance(events, { audioAnalysis });

      const ta = buildTimingAnalysisPayload({
        userId: grp.meta.user_id,
        battleId: grp.meta.battle_id,
        source: 'bridge_processor',
        groupKey: key,
        analysis: result
      });
      const ins1 = await supabase.from('timing_analysis').insert([ta]);
      if(ins1.error) console.error('timing_analysis insert error', ins1.error);

      const jb = buildJudgeBreakdownPayload({
        userId: grp.meta.user_id,
        battleId: grp.meta.battle_id,
        source: 'bridge_processor',
        context: { groupKey: key },
        analysis: result
      });
      const ins2 = await supabase.from('judge_breakdowns').insert([jb]);
      if(ins2.error) console.error('judge_breakdowns insert error', ins2.error);

      // Mark source telemetry_events as processed
      const ids = grp.events.map(r=>r.id);
      const upd = await supabase.from('telemetry_events').update({ processed: true }).in('id', ids);
      if(upd.error) console.error('mark processed error', upd.error);
    }
  }catch(err){
    console.error('process_telemetry error', err);
  }
}

async function loop(){
  while(true){
    await runOnce();
    await new Promise(r=>setTimeout(r, 10000));
  }
}

if(require.main === module){
  console.log('Starting telemetry processor...');
  loop().catch(e=>{ console.error(e); process.exit(1); });
}
