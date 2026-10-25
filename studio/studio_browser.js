(function(global){
  function createStudioBrowser(deps){
    const win = deps.window || global;
    const doc = deps.document || win.document;
    const state = deps.state;
    const esc = deps.esc || (value => String(value ?? ''));

    function playlistBrowserRows(){
      return deps.allLibraryCrates().flatMap(crate => {
        const ids = deps.resolveCrateTrackIds(crate);
        if(!ids.length && Array.isArray(crate.items) && crate.items.length){
          return crate.items.map((item, index) => ({
            playlist:crate.name,
            title:item.title || `Playlist item ${index + 1}`,
            artist:item.artist || 'Unknown Artist',
            bpm:item.bpm || '--',
            key:item.key || '--',
            genre:item.genre || crate.type || 'Playlist',
            duration:item.duration || '--',
            source:item.source || 'Playlist metadata',
            access:'Metadata only'
          }));
        }
        return ids.map(id => {
          const track = deps.getLibraryTrackById(id);
          return track ? { playlist:crate.name, track } : null;
        }).filter(Boolean);
      });
    }

    function renderSourcePanels(source){
      doc.querySelectorAll('.hardware-source [data-src]').forEach(button => button.classList.toggle('active', button.dataset.src === source));
      const services = doc.getElementById('streaming-services');
      const browser = doc.getElementById('stream-browser');
      if(services) services.classList.toggle('hidden', source !== 'STREAMING');
      if(browser) browser.classList.toggle('hidden', source !== 'STREAMING');
      if(source === 'STREAMING'){
        deps.renderStreamingServices();
        deps.renderStreamBrowser(doc.getElementById('studio-search')?.value || '');
      }
    }

    // Oct 25: All / Favourites / Recently played filter for the Studio browser (My Library source).
    function renderPrefsFilter(out){
      if(!deps.filterByTrackPrefs) return;
      const table = out.closest ? out.closest('.table-wrap') : null;
      if(!table || !table.parentNode) return;
      let bar = doc.getElementById('studio-prefs-filter');
      if(!bar){ bar = doc.createElement('div'); bar.id = 'studio-prefs-filter'; bar.className = 'studio-prefs-filter'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Show tracks'); table.parentNode.insertBefore(bar, table); }
      const mode = state.studioPrefsFilter || 'all';
      const chip = (id, label) => `<button type="button" class="ghost small ${mode === id ? 'active' : ''}" data-prefs-filter="${id}" aria-pressed="${mode === id ? 'true' : 'false'}">${label}</button>`;
      bar.innerHTML = chip('all', 'All') + chip('favourites', '★ Favourites') + chip('recent', 'Recently played') + '<button type="button" class="text-btn small" data-new-set title="Clear the ✓ Played marks and start a new set">New set</button>';
      bar.querySelectorAll('[data-prefs-filter]').forEach(b => b.onclick = () => { state.studioPrefsFilter = b.dataset.prefsFilter; try{ win.localStorage && win.localStorage.setItem('djBattleStudioPrefsFilter', state.studioPrefsFilter); }catch(e){} renderLibrary(doc.getElementById('studio-search') ? doc.getElementById('studio-search').value : ''); });
      const ns = bar.querySelector('[data-new-set]'); if(ns) ns.onclick = () => { if(deps.newTrackSet) deps.newTrackSet(); renderLibrary(doc.getElementById('studio-search') ? doc.getElementById('studio-search').value : ''); };
    }

    function renderLibrary(filterQ){
      const out = doc.getElementById('studio-library-table');
      if(!out) return;
      if(state.studioPrefsFilter == null){ try{ state.studioPrefsFilter = win.localStorage && win.localStorage.getItem('djBattleStudioPrefsFilter') || 'all'; }catch(e){ state.studioPrefsFilter = 'all'; } }
      renderPrefsFilter(out);
      const q = String(filterQ || '').toLowerCase();
      const source = state.studioLibrarySource || 'MY_LIBRARY';
      renderSourcePanels(source);
      let rows = [];
      if(source === 'STREAMING'){
        rows = deps.streamingCatalogRows()
          .filter(row => !q || [row.title,row.artist,row.provider,row.genre].join(' ').toLowerCase().includes(q))
          .map(row => ({ ...row, source:row.provider, compatibility:row.access, streaming:true }));
      }else if(source === 'PLAYLISTS'){
        rows = playlistBrowserRows()
          .filter(row => !q || [row.title, row.artist, row.playlist, row.genre, row.source, row.track && deps.trackTitle(row.track)].join(' ').toLowerCase().includes(q))
          .map(row => row.track
            ? { ...deps.normalizedDeckRecord(row.track), libraryId:row.track.libraryId, _sourceTrack:row.track, source:row.playlist, compatibility:'Playlist order' }
            : { ...row, source:row.playlist || row.source, compatibility:row.access || 'Metadata only', metadataOnly:true });
      }else{
        const pool = deps.filterByTrackPrefs ? deps.filterByTrackPrefs(deps.allLibraryTracks(), state.studioPrefsFilter || 'all') : deps.allLibraryTracks();
        rows = pool
          .filter(track => !q || deps.matchesLibrarySearch(track, q))
          .map(track => ({ ...deps.normalizedDeckRecord(track), libraryId:track.libraryId, _sourceTrack:track, compatibility:deps.compatibleTracksFor(track).length ? 'Compatible matches' : 'Ready' }));
      }
      if(!rows.length){
        const pm = state.studioPrefsFilter || 'all';
        if(source !== 'STREAMING' && source !== 'PLAYLISTS' && pm !== 'all'){ out.innerHTML = `<tr><td colspan="10"><small>${pm === 'favourites' ? 'No favourites yet. Tap ☆ next to a track to star it.' : 'Nothing played yet. Tracks you play on a deck show up here.'}</small></td></tr>`; win._studioRows = rows; return; }
        out.innerHTML = `<tr><td colspan="10"><small>No ${source === 'STREAMING' ? 'streaming metadata' : source === 'PLAYLISTS' ? 'playlist tracks' : 'authorized library tracks'} found.</small></td></tr>`;
        win._studioRows = rows;
        return;
      }
      out.innerHTML = rows.map((r,idx)=>{
        const eligibilityA = r._sourceTrack ? deps.libraryTrackLoadEligibility(r._sourceTrack, 'a') : { allowed:false, reason:r.compatibility || 'Metadata only' };
        const eligibilityB = r._sourceTrack ? deps.libraryTrackLoadEligibility(r._sourceTrack, 'b') : { allowed:false, reason:r.compatibility || 'Metadata only' };
        const loadCell = r._sourceTrack
          ? `<button class="ghost small" data-load-a="${idx}" ${eligibilityA.allowed ? '' : 'disabled'}>A</button><button class="ghost small" data-load-b="${idx}" ${eligibilityB.allowed ? '' : 'disabled'}>B</button>`
          : `<button class="ghost small" data-import-stream="${idx}" type="button">Import</button>`;
        return `<tr data-studio-idx="${idx}">
      <td class="studio-load-cell">${loadCell}</td>
      <td>${r._sourceTrack ? deps.artworkMarkup(r._sourceTrack) : '<div class="library-art">MD</div>'}</td>
      <td>${r.libraryId && r._sourceTrack && deps.trackStarHtml ? deps.trackStarHtml(r.libraryId) : ''}<strong>${esc(r.title)}</strong>${r.libraryId && r._sourceTrack && deps.trackPrefsTitleExtras ? deps.trackPrefsTitleExtras(r.libraryId) : ''}<small>${r._sourceTrack ? (eligibilityA.allowed || eligibilityB.allowed ? 'Audio available from library' : esc(eligibilityA.reason)) : 'Metadata / playlist access only'}</small></td>
      <td>${esc(r.artist)}</td>
      <td>${esc(r.bpm)}</td>
      <td>${r._sourceTrack ? deps.keyBadgeHtml(r.key) : esc(r.key)}</td>
      <td>${esc(r.genre)}</td>
      <td>${esc(r.source)}</td>
      <td>${esc(r.compatibility || r.elig || 'Ready')}</td>
      <td>${esc(r.dur || r.duration || '--')}</td>
    </tr>`;
      }).join('');
      out.querySelectorAll('[data-load-a]').forEach(button => button.onclick = () => {
        const rec = rows[Number(button.dataset.loadA)];
        if(rec) deps.loadLibraryTrackToDeck(rec.libraryId, 'a');
      });
      out.querySelectorAll('[data-load-b]').forEach(button => button.onclick = () => {
        const rec = rows[Number(button.dataset.loadB)];
        if(rec) deps.loadLibraryTrackToDeck(rec.libraryId, 'b');
      });
      out.querySelectorAll('[data-import-stream]').forEach(button => button.onclick = () => deps.importStreamingMetadataRow(rows[Number(button.dataset.importStream)]));
      win._studioRows = rows;
      if(deps.wireTrackStars) deps.wireTrackStars(out, () => renderLibrary(filterQ));
      out.querySelectorAll('tr[data-studio-idx]').forEach(row => row.ondblclick = () => {
        const rec = rows[Number(row.dataset.studioIdx)];
        if(rec && rec.libraryId) deps.loadLibraryTrackToDeck(rec.libraryId, deps.getFocusedDeck());
      });
    }

    return {
      playlistBrowserRows,
      renderSourcePanels,
      renderLibrary
    };
  }

  global.DJBattleStudioBrowser = { create: createStudioBrowser };
})(typeof window !== 'undefined' ? window : globalThis);
