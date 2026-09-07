(function(global){
  function createStudioStreaming(deps){
    const doc = deps.document || global.document;
    const state = deps.state;
    const esc = deps.esc || (value => String(value ?? ''));
    const now = deps.now || (() => Date.now());

    function catalogRows(){
      return [
        { id:'stream-spotify-1', provider:'Spotify', title:'Imported playlist track', artist:'Metadata only', bpm:'--', key:'--', genre:'Playlist', duration:'--', access:'Metadata / Playlist Access Only' },
        { id:'stream-soundcloud-1', provider:'SoundCloud', title:'Creator-approved link', artist:'Provider catalog', bpm:126, key:'D minor', genre:'House', duration:'3:20', access:'Audio only if provider rights and SDK permit' },
        { id:'stream-beatport-1', provider:'Beatport', title:'Crate reference', artist:'Catalog metadata', bpm:128, key:'A minor', genre:'Tech House', duration:'4:02', access:'Metadata / purchase link only' }
      ];
    }

    function getSearchValue(){
      return deps.getStudioSearchValue ? deps.getStudioSearchValue() : (doc.getElementById('studio-search')?.value || '');
    }

    function renderServices(){
      const target = doc.getElementById('streaming-services');
      if(!target) return;
      target.innerHTML = state.streamingProviders.map(provider => `<button class="stream-service ${provider.status === 'Unsupported' ? 'unsupported' : ''}" type="button" data-connect="${esc(provider.id)}" ${provider.status === 'Unsupported' ? 'disabled' : ''}>
        <span>${esc(provider.icon)}</span><strong>${esc(provider.name)}</strong><small>${esc(provider.status)}</small>
      </button>`).join('');
      doc.querySelectorAll('[data-connect]').forEach(button => button.onclick = event => {
        const id = event.currentTarget.dataset.connect;
        const provider = state.streamingProviders.find(item => item.id === id);
        if(!provider) return;
        deps.openModal(`<span class="eyebrow accent">STREAMING</span><h3>${esc(provider.name)}</h3>
          <div class="status-grid dense" style="margin:12px 0">
            <div><span>Access</span><strong>${esc(provider.access)}</strong></div>
            <div><span>Audio</span><strong>${esc(provider.audio)}</strong></div>
          </div>
          <p style="color:var(--muted);line-height:1.6">This connection panel supports authentication and playlist metadata only when provider OAuth and permitted scopes are configured. It does not grant direct DJ deck playback unless the provider SDK and license explicitly allow it.</p>
          <div class="modal-actions"><button class="ghost" value="cancel">Close</button><button class="primary" type="button" id="prov-metadata-mode">Use Metadata Mode</button></div>`);
        setTimeout(()=>{
          const btn = doc.getElementById('prov-metadata-mode');
          if(btn) btn.onclick = () => {
            provider.status = provider.status === 'Unsupported' ? 'Unsupported' : 'Metadata Only';
            renderServices();
            renderBrowser(getSearchValue());
            doc.getElementById('modal').close();
          };
        },0);
      });
    }

    function metadataPlaylistCrate(){
      let crate = state.playlists.find(item => item.sourceType === 'streaming_metadata');
      if(crate) return crate;
      crate = {
        id:`streaming-metadata-${now()}`,
        name:'Streaming Metadata Imports',
        type:'playlist',
        sourceType:'streaming_metadata',
        visibility:'private',
        trackIds:[],
        items:[],
        transferNotice:'Metadata and links only. No streaming audio files are transferred.',
        createdAt:new Date(now()).toISOString(),
        updatedAt:new Date(now()).toISOString(),
        syncStatus:'local'
      };
      state.playlists.unshift(crate);
      return crate;
    }

    function importRow(row){
      if(!row) return { ok:false, error:'No streaming metadata row selected.' };
      const crate = metadataPlaylistCrate();
      const item = {
        title:row.title,
        artist:row.artist,
        album:row.album || '',
        bpm:row.bpm || '--',
        key:row.key || '--',
        genre:row.genre || '',
        duration:row.duration || row.dur || '--',
        source:row.provider || row.source || 'Streaming',
        sourceTrackId:row.id || '',
        sourcePlaylistId:crate.id,
        transferType:'metadata_only',
        artwork:row.artwork || ''
      };
      crate.items = Array.isArray(crate.items) ? crate.items : [];
      crate.items.push(item);
      crate.updatedAt = new Date(now()).toISOString();
      deps.persist();
      if(deps.renderLibraryCrateList) deps.renderLibraryCrateList();
      else deps.renderLibrary();
      deps.renderStudioLibrary(getSearchValue());
      deps.setStudioRuleStatus(`${item.title} imported as playlist metadata. Audio was not transferred.`, 'ok');
      return { ok:true, crate, item };
    }

    function renderBrowser(q){
      const out = doc.getElementById('stream-browser');
      if(!out) return;
      const query = String(q || '').toLowerCase();
      const list = catalogRows().filter(row => !query || [row.title,row.artist,row.provider,row.genre].join(' ').toLowerCase().includes(query));
      out.innerHTML = list.map((row, index) => `<div class="stream-row">
        <div><strong>${esc(row.title)}</strong><small>${esc(row.artist)} / ${esc(row.bpm)} BPM / ${esc(row.key)} / ${esc(row.duration)}</small></div>
        <div><span class="eyebrow">${esc(row.provider)}</span><button class="ghost small" data-stream-import="${index}" type="button">Import Metadata</button></div>
      </div>`).join('') || '<div class="stream-row"><small>No streaming metadata matches this search.</small></div>';
      doc.querySelectorAll('[data-stream-import]').forEach(button => button.onclick = () => importRow(list[Number(button.dataset.streamImport)]));
    }

    return {
      catalogRows,
      renderServices,
      metadataPlaylistCrate,
      importRow,
      renderBrowser
    };
  }

  global.DJBattleStudioStreaming = { create: createStudioStreaming };
})(typeof window !== 'undefined' ? window : globalThis);
