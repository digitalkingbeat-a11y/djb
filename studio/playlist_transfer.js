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
        deps.persist();
        deps.renderLibrary();
        state.studioLibrarySource = 'PLAYLISTS';
        if(deps.localStorage && deps.localStorage.setItem) deps.localStorage.setItem('djBattleStudioLibrarySource', state.studioLibrarySource);
        deps.renderStudioLibrary();
        deps.setStudioRuleStatus(`${items.length} playlist item(s) imported from ${file.name}.`, 'ok');
      };
      reader.onerror = () => deps.setStudioRuleStatus('Playlist import failed in this browser.', 'denied');
      reader.readAsText(file);
      return { ok:true };
    }

    function exportRowsForCrate(crate){
      const trackRows = deps.resolveCrateTrackIds(crate).map((id, index) => {
        const track = deps.getLibraryTrackById(id);
        return track ? {
          title:deps.trackTitle(track),
          artist:deps.trackArtist(track),
          album:track.album || '',
          bpm:deps.parseBpm(track) || track.bpm || '',
          key:track.key || '',
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
      const headers = ['title','artist','album','bpm','key','playlistOrder','artwork','source','sourceTrackId','sourcePlaylistId','transferType'];
      return [headers.join(','), ...rows.map(row => headers.map(header => `"${String(row[header] ?? '').replace(/"/g,'""')}"`).join(','))].join('\n');
    }

    function rowsToM3u(rows){
      return ['#EXTM3U', ...rows.flatMap(row => {
        const title = row.artist ? `${row.artist} - ${row.title}` : row.title;
        return [`#EXTINF:-1,${title}`, `#DJ-BATTLE:${encodeURIComponent(JSON.stringify(row))}`, row.sourceTrackId || row.title];
      })].join('\n');
    }

    function exportActiveStudioPlaylist(format){
      const crate = deps.getLibraryCrateById(state.libraryFilters.crate) || deps.allLibraryCrates().find(item => !item.builtIn && (deps.resolveCrateTrackIds(item).length || item.items?.length));
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
    }

    return {
      normalizeHeader,
      parseCsvLine,
      parsePlaylistText,
      importPlaylistFile,
      exportRowsForCrate,
      rowsToCsv,
      rowsToM3u,
      exportActiveStudioPlaylist,
      wireControls
    };
  }

  global.DJBattlePlaylistTransfer = { create: createPlaylistTransfer };
})(typeof window !== 'undefined' ? window : globalThis);
