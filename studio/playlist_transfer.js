(function(global){
  function createPlaylistTransfer(deps){
    const win = deps.window || global;
    const doc = deps.document || win.document;
    const state = deps.state;
    const now = deps.now || (() => Date.now());

    function normalizeHeader(value){
      return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function parseCsvLine(line){
      const values = [];
      let current = '';
      let quoted = false;
      for(let i = 0; i < String(line || '').length; i += 1){
        const char = line[i];
        if(char === '"' && quoted && line[i + 1] === '"'){
          current += '"';
          i += 1;
        }else if(char === '"'){
          quoted = !quoted;
        }else if(char === ',' && !quoted){
          values.push(current.trim());
          current = '';
        }else{
          current += char;
        }
      }
      values.push(current.trim());
      return values;
    }

    function parsePlaylistText(text, fileName){
      const raw = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const items = [];
      const looksCsv = /\.csv$/i.test(fileName || '') || raw[0]?.includes(',');
      if(looksCsv){
        const headers = parseCsvLine(raw.shift()).map(normalizeHeader);
        raw.forEach((line, index) => {
          const values = parseCsvLine(line);
          const item = {};
          headers.forEach((header, i) => { item[header] = values[i] || ''; });
          items.push({
            title:item.title || item.track || `Playlist item ${index + 1}`,
            artist:item.artist || '',
            album:item.album || '',
            bpm:item.bpm || '',
            key:item.key || '',
            genre:item.genre || '',
            duration:item.duration || '',
            artwork:item.artwork || '',
            source:item.source || 'CSV',
            sourceTrackId:item.sourcetrackid || item.trackid || '',
            sourcePlaylistId:item.sourceplaylistid || '',
            transferType:item.transfertype || 'metadata_only'
          });
        });
        return items;
      }
      let pendingTitle = '';
      let pendingMetadata = null;
      raw.forEach((line, index) => {
        if(line.startsWith('#EXTINF')){
          pendingTitle = line.split(',').slice(1).join(',').trim();
          return;
        }
        if(line.startsWith('#DJ-BATTLE:')){
          try{ pendingMetadata = JSON.parse(decodeURIComponent(line.slice('#DJ-BATTLE:'.length))); }catch(error){ pendingMetadata = null; }
          return;
        }
        if(line.startsWith('#')) return;
        const clean = pendingTitle || line.split(/[\\/]/).pop() || `Playlist item ${index + 1}`;
        const parts = clean.split(' - ');
        items.push({
          title:parts.length > 1 ? parts.slice(1).join(' - ') : clean,
          artist:parts.length > 1 ? parts[0] : '',
          source:'Local playlist reference',
          sourceTrackId:line,
          sourcePlaylistId:fileName || '',
          transferType:'local_file_reference',
          ...pendingMetadata
        });
        pendingTitle = '';
        pendingMetadata = null;
      });
      return items;
    }

    function importPlaylistFile(file){
      if(!file) return { ok:false, error:'Choose an M3U, M3U8 or CSV playlist.' };
      const Reader = deps.FileReader || win.FileReader;
      if(!Reader) return { ok:false, error:'Playlist import is unavailable in this browser.' };
      const reader = new Reader();
      reader.onload = () => {
        const items = parsePlaylistText(reader.result, file.name);
        const crate = {
          id:`playlist-import-${now()}`,
          name:file.name.replace(/\.[^/.]+$/, '') || 'Imported Playlist',
          type:'playlist',
          sourceType:'playlist_import',
          visibility:'private',
          trackIds:[],
          items,
          transferNotice:'Playlist metadata and local references imported. Audio files are not transferred.',
          createdAt:new Date(now()).toISOString(),
          updatedAt:new Date(now()).toISOString(),
          syncStatus:'local'
        };
        state.playlists.unshift(crate);
        const added = typeof deps.addImportedItemsToLibrary === 'function' ? deps.addImportedItemsToLibrary(items, file.name) : 0;
        deps.persist();
        deps.renderLibrary();
        state.studioLibrarySource = 'PLAYLISTS';
        if(deps.localStorage && deps.localStorage.setItem) deps.localStorage.setItem('djBattleStudioLibrarySource', state.studioLibrarySource);
        deps.renderStudioLibrary();
        deps.setStudioRuleStatus(`${items.length} playlist item(s) imported from ${file.name}${added ? ` (${added} new in your library)` : ''}. Audio files are not transferred.`, 'ok');
        if(typeof deps.onImported === 'function') deps.onImported({ items, added, crate });
      };
      reader.onerror = () => deps.setStudioRuleStatus('Playlist import failed in this browser.', 'denied');
      reader.readAsText(file);
      return { ok:true };
    }


    /* ---- Oct 20: Rekordbox XML and Serato crate import ---- */
    const XML_ENTITIES = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'" };
    function xmlDecode(value){
      return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
        if(e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
        return XML_ENTITIES[e.toLowerCase()] || m;
      });
    }
    function xmlAttrs(tag){
      const out = {};
      String(tag || '').replace(/([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g, (m, name, q, a, b) => { out[name] = xmlDecode(a != null ? a : b); return m; });
      return out;
    }
    function fileNameFromLocation(location){
      let text = String(location || '');
      try{ text = decodeURIComponent(text); }catch(e){}
      return text.replace(/^file:\/\/(localhost)?/i, '').split(/[\\/]/).pop() || '';
    }
    function camelotOrKey(value){ return String(value || '').trim(); }
    function secondsToDuration(sec){
      const n = Math.round(Number(sec) || 0);
      return n > 0 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : '';
    }
    // Returns { playlists:[{ name, items }], tracks:[item], source:'Rekordbox' }.
    function parseRekordboxXml(text){
      const xml = String(text || '');
      if(!/<DJ_PLAYLISTS[\s>]/i.test(xml)) return { error:'That XML file is not a Rekordbox library export (File > Export Collection in xml format).' };
      const collection = (xml.match(/<COLLECTION[\s\S]*?<\/COLLECTION>/i) || [''])[0];
      const byId = new Map();
      const trackRe = /<TRACK\b([^>]*?)(\/>|>([\s\S]*?)<\/TRACK>)/gi;
      let m;
      while((m = trackRe.exec(collection))){
        const a = xmlAttrs(m[1]);
        if(!a.TrackID) continue;
        const cuePoints = [];
        String(m[3] || '').replace(/<POSITION_MARK\b([^>]*)\/?>/gi, (x, attrs) => {
          const c = xmlAttrs(attrs);
          const start = Number(c.Start);
          if(Number.isFinite(start)) cuePoints.push({ name:c.Name || '', seconds:Math.round(start * 1000) / 1000, type:Number(c.Type) === 4 ? 'loop' : 'cue', hotCue:Number(c.Num) >= 0 ? Number(c.Num) : null });
          return x;
        });
        const bpm = Number(a.AverageBpm);
        const item = {
          title:a.Name || fileNameFromLocation(a.Location) || `Track ${a.TrackID}`,
          artist:a.Artist || '', album:a.Album || '', genre:a.Genre || '',
          bpm:Number.isFinite(bpm) && bpm > 0 ? String(Math.round(bpm * 100) / 100) : '',
          key:camelotOrKey(a.Tonality), duration:secondsToDuration(a.TotalTime),
          fileName:fileNameFromLocation(a.Location), cuePoints,
          source:'Rekordbox', sourceTrackId:String(a.TrackID), transferType:'metadata_only'
        };
        byId.set(String(a.TrackID), item);
      }
      const playlists = [];
      const playlistsXml = (xml.match(/<PLAYLISTS[\s\S]*<\/PLAYLISTS>/i) || [''])[0];
      const nodeRe = /<NODE\b([^>]*)>([\s\S]*?)<\/NODE>/gi;
      // Leaf playlists (Type="1") only contain TRACK Key="..." children.
      String(playlistsXml).replace(/<NODE\b([^>]*Type="1"[^>]*)>([\s\S]*?)<\/NODE>/gi, (x, attrs, body) => {
        const a = xmlAttrs(attrs);
        const items = [];
        body.replace(/<TRACK\b([^>]*)\/?>/gi, (y, t) => { const k = xmlAttrs(t).Key; if(byId.has(String(k))) items.push(byId.get(String(k))); return y; });
        playlists.push({ name:a.Name || 'Rekordbox playlist', items });
        return x;
      });
      void nodeRe;
      const tracks = [...byId.values()];
      if(!playlists.length && tracks.length) playlists.push({ name:'Rekordbox collection', items:tracks });
      return { playlists, tracks, source:'Rekordbox' };
    }
    // Serato .crate files are binary: 4-letter tag + 4-byte length + data, strings in UTF-16BE.
    // A crate only lists file paths; BPM, key and cues live in the audio files' own tags, so we
    // fill those from tracks already in your library with the same file name.
    function readUtf16BE(bytes, start, end){
      let out = '';
      for(let i = start; i + 1 < end; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      return out;
    }
    function parseSeratoCrate(buffer, fileName){
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []);
      const tag = i => String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
      const len = i => ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
      if(bytes.length < 8 || tag(0) !== 'vrsn') return { error:'That file is not a Serato crate (look in your _Serato_/Subcrates folder for .crate files).' };
      const items = [];
      let i = 0;
      while(i + 8 <= bytes.length){
        const t = tag(i); const n = len(i + 4); const start = i + 8; const end = Math.min(bytes.length, start + n);
        if(t === 'otrk'){
          let j = start;
          while(j + 8 <= end){
            const it = tag(j); const il = len(j + 4);
            if(it === 'ptrk'){
              const path = readUtf16BE(bytes, j + 8, Math.min(end, j + 8 + il));
              const base = path.split(/[\\/]/).pop() || path;
              const clean = base.replace(/\.[a-z0-9]{2,4}$/i, '');
              const parts = clean.split(' - ');
              items.push({ title:parts.length > 1 ? parts.slice(1).join(' - ') : clean, artist:parts.length > 1 ? parts[0] : '', fileName:base, source:'Serato', sourceTrackId:path, transferType:'metadata_only', cuePoints:[] });
            }
            j += 8 + il;
          }
        }
        i = end;
      }
      const name = String(fileName || 'Serato crate').replace(/\.crate$/i, '').replace(/%%/g, ' / ');
      return { playlists:[{ name, items }], tracks:items, source:'Serato' };
    }
    function importDjSoftwareFile(file){
      if(!file) return { ok:false, error:'Choose a Rekordbox XML or Serato .crate file.' };
      const Reader = deps.FileReader || win.FileReader;
      if(!Reader) return { ok:false, error:'Import is unavailable in this browser.' };
      const isCrate = /\.crate$/i.test(file.name || '');
      const reader = new Reader();
      reader.onload = () => applyDjSoftwareImport(isCrate ? parseSeratoCrate(reader.result, file.name) : parseRekordboxXml(reader.result), file.name);
      reader.onerror = () => deps.setStudioRuleStatus('Import failed in this browser.', 'denied');
      if(isCrate) reader.readAsArrayBuffer(file); else reader.readAsText(file);
      return { ok:true };
    }
    function applyDjSoftwareImport(parsed, fileName){
      if(!parsed || parsed.error){ deps.setStudioRuleStatus(parsed && parsed.error || 'Nothing to import.', 'denied'); return { ok:false, error:parsed && parsed.error }; }
      const at = new Date(now()).toISOString();
      const merge = typeof deps.mergeImportedTrackDetails === 'function' ? deps.mergeImportedTrackDetails(parsed.tracks) : { matched:0, needsAudio:parsed.tracks.length };
      parsed.playlists.forEach((pl, index) => {
        state.playlists.unshift({
          id:`${parsed.source.toLowerCase()}-import-${now()}-${index}`, name:pl.name, type:'playlist', sourceType:`${parsed.source.toLowerCase()}_import`,
          visibility:'private', trackIds:[], items:pl.items, createdAt:at, updatedAt:at, syncStatus:'local',
          transferNotice:`Imported from ${parsed.source}: names, BPMs, keys and cue points. Audio files are not transferred.`
        });
      });
      const added = typeof deps.addImportedItemsToLibrary === 'function' ? deps.addImportedItemsToLibrary(parsed.tracks, fileName) : 0;
      deps.persist();
      deps.renderLibrary();
      if(typeof deps.renderStudioLibrary === 'function') deps.renderStudioLibrary();
      const cues = parsed.tracks.reduce((n, t) => n + (t.cuePoints || []).length, 0);
      const summary = `${parsed.playlists.length} playlist(s), ${parsed.tracks.length} track(s)${cues ? `, ${cues} cue point(s)` : ''} imported from ${parsed.source}. ${merge.matched} matched audio already in your library; ${Math.max(0, parsed.tracks.length - merge.matched)} still need their audio file uploaded.`;
      deps.setStudioRuleStatus(summary, 'ok');
      if(typeof deps.onImported === 'function') deps.onImported({ items:parsed.tracks, added, source:parsed.source, summary });
      return { ok:true, playlists:parsed.playlists.length, tracks:parsed.tracks.length, cues, matched:merge.matched, added, summary };
    }

    function exportRowsForCrate(crate){
      const trackRows = (crate.libraryTracks || deps.resolveCrateTrackIds(crate).map(id => deps.getLibraryTrackById(id))).map((track, index) => {
        return track ? {
          title:deps.trackTitle(track),
          artist:deps.trackArtist(track),
          album:track.album || '',
          bpm:deps.parseBpm(track) || track.bpm || '',
          key:track.key || '',
          duration:track.duration && track.duration !== '--' ? track.duration : '',
          playlistOrder:index + 1,
          artwork:deps.secureArtworkSource(track) || '',
          source:deps.trackSource(track),
          sourceTrackId:deps.rawServerTrackIdForMembership(track.libraryId) || track.libraryId,
          sourcePlaylistId:crate.id,
          transferType:deps.securePlaybackSource(track) ? 'user_owned_audio_reference' : 'metadata_only'
        } : null;
      }).filter(Boolean);
      const itemRows = (crate.items || []).map((item, index) => ({ ...item, playlistOrder:trackRows.length + index + 1, transferType:item.transferType || 'metadata_only' }));
      return [...trackRows, ...itemRows];
    }

    function rowsToCsv(rows){
      const headers = ['title','artist','album','bpm','key','duration','playlistOrder','artwork','source','sourceTrackId','sourcePlaylistId','transferType'];
      return [headers.join(','), ...rows.map(row => headers.map(header => `"${String(row[header] ?? '').replace(/"/g,'""')}"`).join(','))].join('\n');
    }

    function durationSeconds(value){
      const match = String(value || '').match(/^(\d+):(\d{2})$/);
      return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
    }

    function rowsToM3u(rows){
      return ['#EXTM3U', ...rows.flatMap(row => {
        const title = row.artist ? `${row.artist} - ${row.title}` : row.title;
        const seconds = durationSeconds(row.duration);
        return [`#EXTINF:${seconds},${title}`, `#DJ-BATTLE:${encodeURIComponent(JSON.stringify(row))}`, row.sourceTrackId || row.title];
      })].join('\n');
    }

    function exportActiveStudioPlaylist(format){
      let crate = deps.getLibraryCrateById(state.libraryFilters.crate) || deps.allLibraryCrates().find(item => !item.builtIn && (deps.resolveCrateTrackIds(item).length || item.items?.length));
      const libraryTracks = (state.library || []).filter(track => track && !track.metadataOnly);
      if(!crate && libraryTracks.length){
        crate = { id:'my-library', name:'My Library', libraryTracks };
      }
      if(!crate){
        deps.setStudioRuleStatus('Create or import a playlist before exporting.', 'warn');
        return { ok:false, error:'No playlist available.' };
      }
      const rows = exportRowsForCrate(crate);
      const exportFormat = ['m3u','m3u8'].includes(format) ? format : 'csv';
      const content = exportFormat === 'csv' ? rowsToCsv(rows) : rowsToM3u(rows);
      const mimeType = exportFormat === 'csv' ? 'text/csv' : 'audio/x-mpegurl';
      const BlobCtor = win.Blob || global.Blob;
      if(BlobCtor && win.URL && win.URL.createObjectURL && !deps.disableDownload){
        const blob = new BlobCtor([content], { type:mimeType });
        const url = win.URL.createObjectURL(blob);
        const a = doc.createElement('a');
        a.href = url;
        a.download = `${(crate.name || 'playlist').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'') || 'playlist'}-export.${exportFormat}`;
        a.click();
        setTimeout(()=>win.URL.revokeObjectURL(url), 1000);
      }
      deps.setStudioRuleStatus(`Exported ${rows.length} row(s) as ${exportFormat.toUpperCase()}. Transfer type is declared per track.`, 'ok');
      return { ok:true, rows, content, csv:exportFormat === 'csv' ? content : undefined, format:exportFormat };
    }

    function wireControls(){
      const importButton = doc.getElementById('import-playlist');
      const importInput = doc.getElementById('playlist-import-file');
      if(importButton && importInput) importButton.onclick = () => importInput.click();
      if(importInput) importInput.onchange = event => importPlaylistFile(event.currentTarget.files && event.currentTarget.files[0]);
      const exportButton = doc.getElementById('export-playlist');
      const exportFormat = doc.getElementById('playlist-export-format');
      if(exportButton) exportButton.onclick = () => exportActiveStudioPlaylist(exportFormat && exportFormat.value);
      const djButton = doc.getElementById('import-dj-software');
      const djInput = doc.getElementById('dj-software-import-file');
      if(djButton && djInput) djButton.onclick = () => djInput.click();
      if(djInput) djInput.onchange = event => { importDjSoftwareFile(event.currentTarget.files && event.currentTarget.files[0]); event.currentTarget.value = ''; };
    }

    return {
      normalizeHeader,
      parseCsvLine,
      parsePlaylistText,
      importPlaylistFile,
      parseRekordboxXml,
      parseSeratoCrate,
      importDjSoftwareFile,
      applyDjSoftwareImport,
      exportRowsForCrate,
      rowsToCsv,
      rowsToM3u,
      durationSeconds,
      exportActiveStudioPlaylist,
      wireControls
    };
  }

  global.DJBattlePlaylistTransfer = { create: createPlaylistTransfer };
})(typeof window !== 'undefined' ? window : globalThis);
