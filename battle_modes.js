(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.DJBattleModes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  const BATTLE_LIFECYCLE_STATUSES = Object.freeze([
    'draft',
    'open',
    'matched',
    'ready',
    'active',
    'submission_pending',
    'judging',
    'completed',
    'cancelled'
  ]);

  const BATTLE_STATUS_TRANSITIONS = Object.freeze({
    draft: ['open', 'cancelled'],
    open: ['matched', 'ready', 'active', 'cancelled'],
    matched: ['ready', 'active', 'cancelled'],
    ready: ['active', 'cancelled'],
    active: ['submission_pending', 'judging', 'completed', 'cancelled'],
    submission_pending: ['judging', 'completed', 'cancelled'],
    judging: ['completed', 'cancelled'],
    completed: [],
    cancelled: []
  });

  const REWARD_TYPES = Object.freeze(['standard', 'xp', 'belt', 'bitcoin', 'high_score', 'future']);
  const TRACK_SELECTION_METHODS = Object.freeze(['assigned', 'own_selection', 'genre_pool', 'open_library', 'ai_practice']);
  const OPPONENT_REQUIREMENTS = Object.freeze(['required', 'optional', 'none']);
  const VISIBILITIES = Object.freeze(['public', 'private', 'available']);
  const DEFAULT_GENRES = Object.freeze(['Hip-Hop', 'House', 'Tech House', 'Bass House', 'Drum & Bass', 'Jungle', 'UK Garage', 'Bassline', 'Dubstep', 'Riddim', 'Open Format', 'Scratch', 'EDM']);
  const PRODUCER_JUDGING_CRITERIA = Object.freeze(['composition', 'drums_rhythm', 'sound_selection', 'arrangement', 'mix_quality', 'creativity', 'originality', 'challenge_compliance', 'sample_use', 'overall_impact']);

  const BATTLE_MODES = Object.freeze({
    transition_battle: mode({
      id: 'transition_battle',
      label: 'Transition Battle',
      aliases: ['Standard Battle', 'Transition', 'Bass House Transition'],
      defaultDurationMinutes: 10,
      allowedDurations: [5, 10, 20],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'assigned',
      trackCount: 2,
      opponentRequirement: 'required',
      judgingCriteria: ['beatmatching', 'timing', 'phrasing', 'transition_quality', 'gain_control', 'frequency_balance', 'harmonic_compatibility'],
      premiumRequired: false,
      rewardType: 'standard',
      description: 'Same assigned tracks for both DJs. The score emphasizes clean timing, beat alignment, phrase alignment, transition control, and measurable audio quality.'
    }),
    scratching_battle: mode({
      id: 'scratching_battle',
      label: 'Scratching Battle',
      aliases: ['Scratch Battle', 'Ahh/Fresh Scratch Battle', 'Ahh / Fresh Scratch Battle', 'Ahh / Fresh Scratch', 'Song-to-Song Scratch Battle'],
      defaultDurationMinutes: 2,
      allowedDurations: [2, 5, 10],
      defaultGenre: 'Scratch',
      trackSelectionMethod: 'assigned',
      trackCount: 2,
      opponentRequirement: 'required',
      judgingCriteria: ['timing', 'scratching_technique', 'pattern_control', 'creativity', 'rule_compliance'],
      premiumRequired: false,
      rewardType: 'standard',
      description: 'Assigned scratch material and backing tracks. The score emphasizes measured timing, technique, pattern control, creativity, and rule compliance.'
    }),
    full_mix_battle: mode({
      id: 'full_mix_battle',
      label: 'Full Mix Battle',
      aliases: ['60-Minute Mix', 'Full Mix', 'One-Hour Mix Battle'],
      defaultDurationMinutes: 60,
      allowedDurations: [45, 60, 90],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'own_selection',
      trackCount: null,
      minimumTrackCount: 8,
      opponentRequirement: 'required',
      judgingCriteria: ['programming', 'beatmatching', 'phrasing', 'transition_quality', 'energy_flow', 'loudness_control', 'frequency_balance', 'harmonic_compatibility'],
      premiumRequired: false,
      rewardType: 'xp',
      description: 'Long-form programming battle with DJ-selected tracks. The score emphasizes sustained structure, transitions, energy movement, and measurable mix quality.'
    }),
    half_hour_mix_battle: mode({
      id: 'half_hour_mix_battle',
      label: 'Half-Hour Mix Battle',
      aliases: ['30-Minute Mix', 'Half Hour Mix', 'Half-Hour Mix'],
      defaultDurationMinutes: 30,
      allowedDurations: [30],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'own_selection',
      trackCount: null,
      minimumTrackCount: 5,
      opponentRequirement: 'required',
      judgingCriteria: ['programming', 'beatmatching', 'phrasing', 'transition_quality', 'energy_flow', 'loudness_control', 'frequency_balance', 'harmonic_compatibility'],
      premiumRequired: true,
      rewardType: 'xp',
      description: 'Premium own-selection battle for a compact long-form set.'
    }),
    five_song_mix_battle: mode({
      id: 'five_song_mix_battle',
      label: 'Five-Song Mix Battle',
      aliases: ['5-Song Mix', 'Five Song Mix', 'Five-Song Mix'],
      defaultDurationMinutes: 20,
      allowedDurations: [10, 20, 30],
      defaultGenre: 'Hip-Hop',
      trackSelectionMethod: 'assigned',
      trackCount: 5,
      opponentRequirement: 'required',
      judgingCriteria: ['programming', 'beatmatching', 'phrasing', 'transition_quality', 'energy_flow', 'rule_compliance'],
      premiumRequired: false,
      rewardType: 'standard',
      description: 'Five assigned tracks for every participant. The score emphasizes sequencing, transitions, phrasing, and rule compliance.'
    }),
    genre_specific_battle: mode({
      id: 'genre_specific_battle',
      label: 'Genre-specific Battle',
      aliases: ['Genre Battle', 'Genre-specific battles'],
      defaultDurationMinutes: 10,
      allowedDurations: [10, 20, 30],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'genre_pool',
      trackCount: 2,
      opponentRequirement: 'required',
      judgingCriteria: ['genre_fit', 'beatmatching', 'phrasing', 'transition_quality', 'energy_flow', 'rule_compliance'],
      premiumRequired: false,
      rewardType: 'standard',
      requiresGenre: true,
      description: 'Battle constrained by a selected genre and an approved genre-matched track pool.'
    }),
    own_selection_battle: mode({
      id: 'own_selection_battle',
      label: 'Own Selection Battle',
      aliases: ['Own Selection', 'Own Selection (Premium)', 'DJ-selected Battle'],
      defaultDurationMinutes: 20,
      allowedDurations: [10, 20, 30, 60],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'own_selection',
      trackCount: null,
      minimumTrackCount: 2,
      opponentRequirement: 'required',
      judgingCriteria: ['programming', 'beatmatching', 'phrasing', 'transition_quality', 'energy_flow', 'harmonic_compatibility', 'rule_compliance'],
      premiumRequired: true,
      rewardType: 'xp',
      description: 'DJs bring eligible tracks from their own library under the configured genre and duration rules.'
    }),
    ai_only_practice: mode({
      id: 'ai_only_practice',
      label: 'AI-Only Practice/High-Score Mode',
      aliases: ['AI Practice', 'Solo AI Rating', 'Practice', 'AI-Only Practice', 'High-Score Mode'],
      defaultDurationMinutes: 10,
      allowedDurations: [5, 10, 20, 30],
      defaultGenre: 'Global',
      trackSelectionMethod: 'ai_practice',
      trackCount: null,
      minimumTrackCount: 1,
      opponentRequirement: 'none',
      judgingCriteria: ['beatmatching', 'timing', 'phrasing', 'transition_quality', 'gain_control', 'frequency_balance', 'harmonic_compatibility'],
      premiumRequired: false,
      rewardType: 'high_score',
      description: 'Solo practice session that can save an AI high score without an opponent.'
    }),
    bitcoin_battle: mode({
      id: 'bitcoin_battle',
      label: 'Bitcoin Battle',
      aliases: ['Bitcoin', 'BTC Battle'],
      defaultDurationMinutes: 10,
      allowedDurations: [10, 20, 30],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'assigned',
      trackCount: 2,
      opponentRequirement: 'required',
      judgingCriteria: ['beatmatching', 'timing', 'phrasing', 'transition_quality', 'gain_control', 'frequency_balance', 'harmonic_compatibility', 'rule_compliance'],
      premiumRequired: false,
      rewardType: 'bitcoin',
      rewardMetadata: { network: 'bitcoin', custody: 'external_pending', walletConnected: false },
      description: 'Battle mode that preserves Bitcoin reward metadata without connecting wallets or moving funds.'
    }),
    open_beat_battle: mode({
      id: 'open_beat_battle',
      label: 'Open Beat Battle',
      aliases: ['Open Beat', 'Producer Open Beat'],
      discipline: 'producer',
      defaultDurationMinutes: 60,
      allowedDurations: [30, 60, 120],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'open_library',
      trackCount: null,
      opponentRequirement: 'required',
      judgingCriteria: PRODUCER_JUDGING_CRITERIA,
      premiumRequired: false,
      rewardType: 'standard',
      description: 'Producers submit an original beat with no fixed challenge constraint.'
    }),
    sample_flip_battle: mode({
      id: 'sample_flip_battle',
      label: 'Sample Flip Battle',
      aliases: ['Sample Flip'],
      discipline: 'producer',
      defaultDurationMinutes: 60,
      allowedDurations: [30, 60, 120],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'open_library',
      trackCount: null,
      opponentRequirement: 'required',
      judgingCriteria: PRODUCER_JUDGING_CRITERIA,
      premiumRequired: false,
      rewardType: 'standard',
      description: 'Producers flip a released sample into an original beat where rights allow.'
    }),
    genre_challenge_beat_battle: mode({
      id: 'genre_challenge_beat_battle',
      label: 'Genre Challenge Beat Battle',
      aliases: ['Genre Challenge', 'Producer Genre Challenge'],
      discipline: 'producer',
      defaultDurationMinutes: 60,
      allowedDurations: [30, 60, 120],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'open_library',
      trackCount: null,
      opponentRequirement: 'required',
      judgingCriteria: PRODUCER_JUDGING_CRITERIA,
      premiumRequired: false,
      rewardType: 'standard',
      requiresGenre: true,
      description: 'Producers build an original beat constrained to a selected genre.'
    }),
    bpm_challenge_beat_battle: mode({
      id: 'bpm_challenge_beat_battle',
      label: 'BPM Challenge Beat Battle',
      aliases: ['BPM Challenge', 'Producer BPM Challenge'],
      discipline: 'producer',
      defaultDurationMinutes: 60,
      allowedDurations: [30, 60, 120],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'open_library',
      trackCount: null,
      opponentRequirement: 'required',
      judgingCriteria: PRODUCER_JUDGING_CRITERIA,
      premiumRequired: false,
      rewardType: 'standard',
      description: 'Producers build an original beat that measurably matches a target BPM.'
    }),
    timed_beat_challenge_battle: mode({
      id: 'timed_beat_challenge_battle',
      label: 'Timed Beat Challenge',
      aliases: ['Timed Beat Challenge Battle'],
      discipline: 'producer',
      defaultDurationMinutes: 30,
      allowedDurations: [15, 30, 60],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'open_library',
      trackCount: null,
      opponentRequirement: 'required',
      judgingCriteria: PRODUCER_JUDGING_CRITERIA,
      premiumRequired: false,
      rewardType: 'standard',
      description: 'Producers build an original beat inside a fixed production window.'
    }),
    drum_challenge_battle: mode({
      id: 'drum_challenge_battle',
      label: 'Drum Challenge Beat Battle',
      aliases: ['Drum Challenge'],
      discipline: 'producer',
      defaultDurationMinutes: 60,
      allowedDurations: [30, 60, 120],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'open_library',
      trackCount: null,
      opponentRequirement: 'required',
      judgingCriteria: PRODUCER_JUDGING_CRITERIA,
      premiumRequired: false,
      rewardType: 'standard',
      description: 'Producers build a beat that showcases original drum programming.'
    }),
    remix_challenge_battle: mode({
      id: 'remix_challenge_battle',
      label: 'Remix Challenge Beat Battle',
      aliases: ['Remix Challenge'],
      discipline: 'producer',
      defaultDurationMinutes: 120,
      allowedDurations: [60, 120],
      defaultGenre: 'Open Format',
      trackSelectionMethod: 'open_library',
      trackCount: null,
      opponentRequirement: 'required',
      judgingCriteria: PRODUCER_JUDGING_CRITERIA,
      premiumRequired: true,
      rewardType: 'standard',
      description: 'Producers remix cleared source material where rights explicitly allow it.'
    })
  });

  const MODE_ALIASES = Object.freeze(Object.keys(BATTLE_MODES).reduce((acc, id) => {
    const cfg = BATTLE_MODES[id];
    acc[normalizeKey(id)] = id;
    acc[normalizeKey(cfg.label)] = id;
    cfg.aliases.forEach(alias => { acc[normalizeKey(alias)] = id; });
    return acc;
  }, {}));

  function mode(config){
    return Object.freeze({
      minimumTrackCount: null,
      rewardMetadata: {},
      requiresGenre: false,
      discipline: 'dj',
      ...config,
      aliases: Object.freeze(config.aliases || []),
      allowedDurations: Object.freeze(config.allowedDurations || [config.defaultDurationMinutes]),
      judgingCriteria: Object.freeze(config.judgingCriteria || []),
      rewardMetadata: Object.freeze(config.rewardMetadata || {})
    });
  }

  function normalizeKey(value){
    return String(value || '').trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function normalizeModeId(value){
    const key = normalizeKey(value);
    return MODE_ALIASES[key] || key;
  }

  function getBattleMode(value){
    const id = normalizeModeId(value || 'transition_battle');
    return BATTLE_MODES[id] || null;
  }

  function listBattleModes(){
    return Object.keys(BATTLE_MODES).map(id => BATTLE_MODES[id]);
  }

  function parseDurationMinutes(value, fallback){
    if(value == null || value === '') return Number(fallback || 10);
    const match = String(value).match(/(\d+(?:\.\d+)?)/);
    if(!match) return Number(fallback || 10);
    return Number(match[1]);
  }

  function normalizeSelection(value, fallback){
    const key = normalizeKey(value || fallback || 'assigned');
    if(key.includes('own') || key.includes('dj_selected')) return 'own_selection';
    if(key.includes('genre')) return 'genre_pool';
    if(key.includes('open')) return 'open_library';
    if(key.includes('practice') || key.includes('ai')) return 'ai_practice';
    return TRACK_SELECTION_METHODS.includes(key) ? key : 'assigned';
  }

  function normalizeOpponentRequirement(value, fallback){
    const key = normalizeKey(value || fallback || 'required');
    if(key === 'none' || key === 'solo' || key.includes('ai_only')) return 'none';
    if(key === 'optional') return 'optional';
    return 'required';
  }

  function normalizeVisibility(value){
    const key = normalizeKey(value || 'public');
    if(key === 'available') return 'available';
    if(key === 'private') return 'private';
    return 'public';
  }

  function normalizeReward(input, modeConfig){
    const rawType = typeof input === 'string' ? input : input && input.type;
    const type = REWARD_TYPES.includes(normalizeKey(rawType)) ? normalizeKey(rawType) : modeConfig.rewardType;
    const metadata = typeof input === 'object' && input ? cloneJson(input.metadata || {}) : {};
    return {
      type,
      metadata: { ...cloneJson(modeConfig.rewardMetadata || {}), ...metadata }
    };
  }

  function trackLabel(track){
    if(typeof track === 'string') return track.trim();
    if(track && typeof track === 'object') return String(track.title || track.name || track.id || '').trim();
    return '';
  }

  function normalizeAssignedTracks(value){
    return Array.isArray(value) ? value.map(trackLabel).filter(Boolean) : [];
  }

  function normalizeBattleConfig(input, options){
    const source = input || {};
    const modeConfig = getBattleMode(source.modeId || source.mode || source.type || source.battleType) || BATTLE_MODES.transition_battle;
    const durationMinutes = parseDurationMinutes(source.durationMinutes || source.duration || source.time, modeConfig.defaultDurationMinutes);
    const trackSelectionMethod = normalizeSelection(source.trackSelectionMethod || source.selection, modeConfig.trackSelectionMethod);
    const trackCount = source.trackCount == null || source.trackCount === '' ? modeConfig.trackCount : Number(source.trackCount);
    const opponentRequirement = normalizeOpponentRequirement(source.opponentRequirement || source.opponent, modeConfig.opponentRequirement);
    const genre = String(source.genre || modeConfig.defaultGenre || 'Open Format').trim();
    const reward = normalizeReward(source.reward || source.rewardType, modeConfig);
    const judgingCriteria = Array.isArray(source.judgingCriteria) && source.judgingCriteria.length
      ? source.judgingCriteria.map(item => normalizeKey(item)).filter(Boolean)
      : modeConfig.judgingCriteria.slice();
    const assignedTracks = normalizeAssignedTracks(source.assignedTracks || source.assigned || []);
    const visibility = normalizeVisibility(source.visibility || (source.private ? 'private' : 'public'));
    const status = BATTLE_LIFECYCLE_STATUSES.includes(source.status) ? source.status : 'open';
    const createdAt = source.createdAt || source.created_at || (options && options.now) || new Date().toISOString();
    const createdBy = source.createdBy || source.created_by || source.creatorId || (options && options.createdBy) || null;
    const title = String(source.title || `${genre} ${modeConfig.label}`).trim();

    return {
      modeId: modeConfig.id,
      type: modeConfig.label,
      discipline: modeConfig.discipline === 'producer' ? 'producer' : 'dj',
      title,
      genre,
      durationMinutes,
      trackSelectionMethod,
      trackCount: Number.isFinite(trackCount) && trackCount > 0 ? Math.floor(trackCount) : null,
      minimumTrackCount: modeConfig.minimumTrackCount,
      opponentRequirement,
      visibility,
      reward,
      judgingCriteria,
      premiumRequired: Boolean(source.premiumRequired != null ? source.premiumRequired : modeConfig.premiumRequired),
      assignedTracks,
      status,
      createdAt,
      createdBy
    };
  }

  function validateBattleConfig(input, options){
    const cfg = normalizeBattleConfig(input, options);
    const modeConfig = BATTLE_MODES[cfg.modeId];
    const errors = [];
    if(!modeConfig) errors.push({ field: 'modeId', message: 'Choose a valid battle mode.' });
    if(!cfg.genre) errors.push({ field: 'genre', message: 'Choose a battle genre.' });
    if(modeConfig && modeConfig.requiresGenre && (!cfg.genre || cfg.genre === 'Open Format')) errors.push({ field: 'genre', message: 'Choose a specific genre for this battle mode.' });
    if(!Number.isFinite(cfg.durationMinutes) || cfg.durationMinutes <= 0) errors.push({ field: 'durationMinutes', message: 'Choose a valid battle duration.' });
    if(modeConfig && modeConfig.allowedDurations.length && !modeConfig.allowedDurations.includes(cfg.durationMinutes)) errors.push({ field: 'durationMinutes', message: `Duration must be one of: ${modeConfig.allowedDurations.join(', ')} minutes.` });
    if(!TRACK_SELECTION_METHODS.includes(cfg.trackSelectionMethod)) errors.push({ field: 'trackSelectionMethod', message: 'Choose a valid track-selection rule.' });
    if(!OPPONENT_REQUIREMENTS.includes(cfg.opponentRequirement)) errors.push({ field: 'opponentRequirement', message: 'Choose a valid opponent requirement.' });
    if(!VISIBILITIES.includes(cfg.visibility)) errors.push({ field: 'visibility', message: 'Choose a valid battle visibility.' });
    if(!REWARD_TYPES.includes(cfg.reward.type)) errors.push({ field: 'reward', message: 'Choose a valid reward type.' });
    if(cfg.trackSelectionMethod === 'assigned' || cfg.trackSelectionMethod === 'genre_pool'){
      if(!cfg.trackCount || cfg.trackCount < 1) errors.push({ field: 'trackCount', message: 'Assigned battles need a track count.' });
    }
    if(cfg.trackSelectionMethod === 'own_selection' || cfg.trackSelectionMethod === 'ai_practice' || cfg.trackSelectionMethod === 'open_library'){
      if(cfg.minimumTrackCount != null && cfg.minimumTrackCount < 1) errors.push({ field: 'minimumTrackCount', message: 'Own-selection battles need a minimum track rule.' });
    }
    if(options && options.requireAssignedTracks && (cfg.trackSelectionMethod === 'assigned' || cfg.trackSelectionMethod === 'genre_pool') && cfg.assignedTracks.length < cfg.trackCount){
      errors.push({ field: 'assignedTracks', message: `Assign ${cfg.trackCount} eligible track(s) before opening this battle.` });
    }
    if(options && options.isPremium === false && cfg.premiumRequired) errors.push({ field: 'premiumRequired', message: 'This battle mode requires Premium.' });
    return { ok: errors.length === 0, errors, value: cfg };
  }

  function createBattleRecord(input, options){
    const validation = validateBattleConfig(input, options);
    if(!validation.ok) return { error: validation.errors, validation };
    const cfg = validation.value;
    const participants = normalizeParticipants(input && input.participants);
    const entries = cloneJson((input && input.entries) || {});
    const record = {
      id: input && input.id ? String(input.id) : buildStableBattleId(cfg),
      modeId: cfg.modeId,
      type: cfg.type,
      discipline: cfg.discipline,
      title: cfg.title,
      genre: cfg.genre,
      durationMinutes: cfg.durationMinutes,
      time: `${cfg.durationMinutes} min`,
      trackSelectionMethod: cfg.trackSelectionMethod,
      trackCount: cfg.trackCount,
      minimumTrackCount: cfg.minimumTrackCount,
      tracks: describeTrackRule(cfg),
      selection: describeSelection(cfg.trackSelectionMethod),
      opponentRequirement: cfg.opponentRequirement,
      visibility: cfg.visibility,
      reward: cfg.reward,
      rewardType: cfg.reward.type,
      judgingCriteria: cfg.judgingCriteria,
      judging: describeJudging(cfg.judgingCriteria),
      premiumRequired: cfg.premiumRequired,
      stems: Boolean(input && input.stems) || cfg.premiumRequired,
      people: Math.max(Number(input && input.people) || 0, participants.length),
      desc: input && input.desc ? String(input.desc) : buildBattleDescription(cfg),
      assignedTracks: cfg.assignedTracks,
      participants,
      entries,
      status: cfg.status,
      createdAt: cfg.createdAt,
      createdBy: cfg.createdBy,
      startedAt: input && input.startedAt || null,
      submittedAt: input && input.submittedAt || null,
      judgedAt: input && input.judgedAt || null,
      completedAt: input && input.completedAt || null,
      result: input && input.result || null
    };
    return { battle: record };
  }

  function normalizeBattleRecord(input, options){
    const created = createBattleRecord(input || {}, { ...(options || {}), requireAssignedTracks: false });
    if(created.error) return input;
    return created.battle;
  }

  function describeTrackRule(cfg){
    if(cfg.trackSelectionMethod === 'own_selection') return cfg.minimumTrackCount ? `${cfg.minimumTrackCount}+ own tracks` : 'Own selection';
    if(cfg.trackSelectionMethod === 'ai_practice') return cfg.minimumTrackCount ? `${cfg.minimumTrackCount}+ practice track(s)` : 'Practice selection';
    if(cfg.trackSelectionMethod === 'open_library') return 'Open library';
    const count = cfg.trackCount || 0;
    return `${count} assigned`;
  }

  function describeSelection(method){
    if(method === 'own_selection') return 'DJ-selected';
    if(method === 'genre_pool') return 'Genre pool';
    if(method === 'open_library') return 'Open library';
    if(method === 'ai_practice') return 'Practice';
    return 'Assigned';
  }

  function describeJudging(criteria){
    const hasAudio = criteria.some(item => ['beatmatching', 'timing', 'phrasing', 'transition_quality', 'gain_control', 'frequency_balance', 'harmonic_compatibility'].includes(item));
    return hasAudio ? 'Measured + Community-compatible' : 'Rule-based + Community-compatible';
  }

  function buildBattleDescription(cfg){
    const reward = cfg.reward.type === 'bitcoin' ? ' Bitcoin reward metadata is preserved without wallet custody.' : '';
    return `${cfg.type} in ${cfg.genre}. ${describeTrackRule(cfg)} over ${cfg.durationMinutes} minutes.${reward}`;
  }

  function canTransitionBattleStatus(from, to){
    return Boolean(BATTLE_STATUS_TRANSITIONS[from] && BATTLE_STATUS_TRANSITIONS[from].includes(to));
  }

  function transitionBattleStatus(record, to, patch){
    const current = record && record.status || 'draft';
    if(current === to) return { battle: { ...record, ...(patch || {}) } };
    if(!canTransitionBattleStatus(current, to)) return { error: `Cannot transition battle from ${current} to ${to}.` };
    return { battle: { ...record, ...(patch || {}), status: to } };
  }

  function normalizeParticipants(participants){
    if(!Array.isArray(participants)) return [];
    const seen = new Set();
    return participants.map(item => {
      const userId = String(item && (item.userId || item.user_id || item.id) || '').trim();
      if(!userId || seen.has(userId)) return null;
      seen.add(userId);
      return {
        userId,
        name: item.name || item.dj || item.displayName || 'DJ',
        role: item.role || 'participant',
        status: item.status || 'joined',
        joinedAt: item.joinedAt || item.joined_at || null,
        submissionId: item.submissionId || item.submission_id || null,
        submittedAt: item.submittedAt || item.submitted_at || null
      };
    }).filter(Boolean);
  }

  function getParticipant(record, userId){
    const id = String(userId || '');
    return (record.participants || []).find(participant => String(participant.userId) === id) || null;
  }

  function joinBattle(record, user, options){
    const userId = typeof user === 'string' ? user : user && (user.userId || user.id);
    if(!userId) return { error: 'Sign in before joining this battle.' };
    if(!record || !record.id) return { error: 'Battle was not found.' };
    if(['completed', 'cancelled'].includes(record.status)) return { error: 'This battle is no longer accepting entries.' };
    if(record.status === 'draft' && String(record.createdBy || '') !== String(userId)) return { error: 'This draft battle is not open yet.' };
    if(getParticipant(record, userId)) return { error: 'You have already joined this battle.', code: 'duplicate_entry' };
    const participant = {
      userId: String(userId),
      name: typeof user === 'object' && user ? (user.name || user.dj || user.displayName || 'DJ') : 'DJ',
      role: 'participant',
      status: 'joined',
      joinedAt: options && options.now || new Date().toISOString(),
      submissionId: null,
      submittedAt: null
    };
    const participants = normalizeParticipants([...(record.participants || []), participant]);
    let nextStatus = record.status === 'draft' ? 'open' : record.status;
    if(record.opponentRequirement === 'none') nextStatus = 'ready';
    else if(record.opponentRequirement === 'required' && participants.length >= 2) nextStatus = 'matched';
    else if(record.opponentRequirement === 'optional' && participants.length >= 1) nextStatus = 'ready';
    const transitioned = nextStatus === record.status ? { battle: { ...record, participants } } : transitionBattleStatus(record, nextStatus, { participants });
    return transitioned.error ? transitioned : { battle: transitioned.battle, participant };
  }

  function prepareBattle(record, options){
    const userId = options && options.userId;
    if(userId && !getParticipant(record, userId) && String(record.createdBy || '') !== String(userId)) return { error: 'Only a participant can prepare this battle.' };
    const assignedTracks = normalizeAssignedTracks((options && options.assignedTracks) || record.assignedTracks || []);
    const patch = { assignedTracks };
    const target = ['open', 'matched'].includes(record.status) ? 'ready' : record.status;
    return target === record.status ? { battle: { ...record, ...patch } } : transitionBattleStatus(record, target, patch);
  }

  function activateBattle(record, options){
    const userId = options && options.userId;
    if(userId && !getParticipant(record, userId) && String(record.createdBy || '') !== String(userId)) return { error: 'Only a participant can start this battle.' };
    if(record.status === 'active') return { battle: record };
    return transitionBattleStatus(record, 'active', { startedAt: options && options.now || new Date().toISOString() });
  }

  function markSubmissionUploaded(record, options){
    const userId = options && options.userId;
    const participant = getParticipant(record, userId);
    if(!participant) return { error: 'Only a participant can submit to this battle.' };
    if(!options || !options.submissionId) return { error: 'Submission ID is required.' };
    const participants = (record.participants || []).map(item => String(item.userId) === String(userId)
      ? { ...item, status: 'submitted', submissionId: String(options.submissionId), submittedAt: options.now || new Date().toISOString() }
      : item);
    const patch = { participants, submittedAt: options.now || new Date().toISOString() };
    const target = record.status === 'judging' ? 'judging' : 'submission_pending';
    return record.status === target ? { battle: { ...record, ...patch } } : transitionBattleStatus(record, target, patch);
  }

  function markBattleJudging(record, options){
    return transitionBattleStatus(record, 'judging', { judgedAt: options && options.now || new Date().toISOString() });
  }

  function completeBattle(record, options){
    const result = options && options.result || null;
    const completedAt = options && options.now || new Date().toISOString();
    const progression = calculateProgression({ battle: record, result });
    return transitionBattleStatus(record, 'completed', { result: result ? { ...result, progression } : { progression }, completedAt });
  }

  function buildBattleRules(record){
    const cfg = normalizeBattleConfig(record);
    return {
      modeId: cfg.modeId,
      mode: cfg.type,
      discipline: cfg.discipline,
      genre: cfg.genre,
      durationMinutes: cfg.durationMinutes,
      trackSelectionMethod: cfg.trackSelectionMethod,
      trackCount: cfg.trackCount,
      minimumTrackCount: cfg.minimumTrackCount,
      opponentRequirement: cfg.opponentRequirement,
      judgingCriteria: cfg.judgingCriteria,
      reward: cfg.reward,
      premiumRequired: cfg.premiumRequired
    };
  }

  function buildBattleResultPayload({ battle, userId, submissionId, judgeResult, now }){
    if(!battle || !battle.id) return { error: 'Battle is required.' };
    if(!getParticipant(battle, userId)) return { error: 'Only a participant can receive a battle result.' };
    if(!submissionId) return { error: 'Submission ID is required.' };
    const score = extractScore(judgeResult);
    const breakdown = judgeResult && (judgeResult.breakdown || judgeResult.components || judgeResult.analysis || judgeResult);
    const result = {
      battleId: battle.id,
      userId: String(userId),
      submissionId: String(submissionId),
      score,
      won: typeof (judgeResult && judgeResult.won) === 'boolean' ? judgeResult.won : null,
      opponentScore: Number.isFinite(Number(judgeResult && judgeResult.opponentScore)) ? Number(judgeResult.opponentScore) : null,
      winnerUserId: judgeResult && judgeResult.winnerUserId ? String(judgeResult.winnerUserId) : null,
      breakdown: cloneJson(breakdown || {}),
      timing: cloneJson(judgeResult && (judgeResult.timing || judgeResult.timeline || judgeResult.analysis && judgeResult.analysis.timeline) || []),
      rawMeasurements: cloneJson(judgeResult && (judgeResult.rawMeasurements || judgeResult.analysis && judgeResult.analysis.rawMeasurements) || []),
      recommendations: cloneJson(judgeResult && (judgeResult.recommendations || judgeResult.analysis && judgeResult.analysis.recommendations) || []),
      confidence: cloneJson(judgeResult && judgeResult.confidence || null),
      measurableAnalysis: cloneJson(judgeResult && judgeResult.measurableAnalysis || null),
      scoringModel: cloneJson(judgeResult && judgeResult.scoringModel || null),
      battleContext: cloneJson(judgeResult && judgeResult.battleContext || null),
      battleMode: judgeResult && judgeResult.battleMode || battle.modeId || null,
      humanVoting: cloneJson(judgeResult && judgeResult.humanVoting || null),
      aiFeedback: cloneJson(judgeResult && judgeResult.aiFeedback || null),
      evidenceType: judgeResult && judgeResult.evidenceType || 'deterministic_measurements',
      explanation: judgeResult && judgeResult.explanation || null,
      completedAt: now || new Date().toISOString(),
      reward: cloneJson(battle.reward || { type: battle.rewardType || 'standard', metadata: {} })
    };
    result.progression = calculateProgression({ battle, result });
    return { result };
  }

  function calculateProgression({ battle, result }){
    const mode = getBattleMode(battle && battle.modeId) || BATTLE_MODES.transition_battle;
    const score = Math.max(0, Math.min(100, Number(result && result.score || 0)));
    const completed = Boolean(result);
    const base = completed ? 25 : 0;
    const durationBonus = Math.min(30, Math.round((battle && battle.durationMinutes || mode.defaultDurationMinutes) / 2));
    const scoreBonus = Math.round(score / 4);
    const winBonus = result && result.won ? 20 : 0;
    const xp = base + durationBonus + scoreBonus + winBonus;
    const ratingDelta = Math.round((score - 50) / 5) + (result && result.won ? 8 : 0);
    const beltProgress = Math.max(0, Math.min(100, Math.round(score)));
    return {
      xp,
      ratingDelta,
      beltProgress,
      highScoreEligible: mode.rewardType === 'high_score' || (battle && battle.opponentRequirement === 'none'),
      rewardType: battle && (battle.rewardType || battle.reward && battle.reward.type) || mode.rewardType
    };
  }

  function extractScore(judgeResult){
    const raw = judgeResult && (judgeResult.score ?? judgeResult.overallScore ?? judgeResult.total ?? judgeResult.aiScore);
    if(!Number.isFinite(Number(raw))) return null;
    return Math.max(0, Math.min(100, Number(raw)));
  }

  function buildStableBattleId(cfg){
    const seed = [
      cfg.modeId,
      cfg.genre,
      cfg.durationMinutes,
      cfg.trackSelectionMethod,
      cfg.trackCount || cfg.minimumTrackCount || '',
      cfg.opponentRequirement,
      cfg.visibility,
      cfg.reward.type,
      cfg.createdBy || 'local',
      cfg.createdAt
    ].join('|');
    return `battle-${hashString(seed)}`;
  }

  function hashString(value){
    let hash = 2166136261;
    const str = String(value);
    for(let i = 0; i < str.length; i += 1){
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).padStart(7, '0');
  }

  function cloneJson(value){
    if(value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  return {
    BATTLE_MODES,
    BATTLE_LIFECYCLE_STATUSES,
    BATTLE_STATUS_TRANSITIONS,
    REWARD_TYPES,
    TRACK_SELECTION_METHODS,
    OPPONENT_REQUIREMENTS,
    VISIBILITIES,
    DEFAULT_GENRES,
    PRODUCER_JUDGING_CRITERIA,
    normalizeModeId,
    getBattleMode,
    listBattleModes,
    parseDurationMinutes,
    normalizeBattleConfig,
    validateBattleConfig,
    createBattleRecord,
    normalizeBattleRecord,
    buildBattleRules,
    canTransitionBattleStatus,
    transitionBattleStatus,
    joinBattle,
    prepareBattle,
    activateBattle,
    markSubmissionUploaded,
    markBattleJudging,
    completeBattle,
    buildBattleResultPayload,
    calculateProgression
  };
});
