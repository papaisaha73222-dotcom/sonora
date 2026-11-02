// ============================================================
// SONORA - SPOTIFY THEMED LIQUID GLASS AUDIO ENGINE & AUTO-SYNC
// ============================================================

class SonoraApp {
  constructor() {
    this.tracks = [];
    this.playlists = [];
    this.currentTrack = null;
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isShuffle = false;
    this.isRepeat = false;
    this.currentView = 'home';
    this.activeFilter = 'all';
    this.activePlaylistId = null;
    this.dbVersion = null;

    // DOM Elements
    this.audio = document.getElementById('audio-player');
    this.viewContainer = document.getElementById('view-container');
    this.searchInput = document.getElementById('search-input');
    this.clearSearchBtn = document.getElementById('btn-clear-search');

    // Player Elements
    this.playBtn = document.getElementById('btn-play');
    this.playIcon = document.getElementById('play-icon');
    this.prevBtn = document.getElementById('btn-prev');
    this.nextBtn = document.getElementById('btn-next');
    this.shuffleBtn = document.getElementById('btn-shuffle');
    this.repeatBtn = document.getElementById('btn-repeat');
    this.playerCover = document.getElementById('player-cover');
    this.playerTitle = document.getElementById('player-title');
    this.playerArtist = document.getElementById('player-artist');
    this.playerBadge = document.getElementById('player-badge');
    this.playerLikeBtn = document.getElementById('player-like-btn');
    this.currentTimeEl = document.getElementById('current-time');
    this.totalDurationEl = document.getElementById('total-duration');
    this.progressTrack = document.getElementById('progress-track');
    this.progressFill = document.getElementById('progress-fill');
    this.volumeTrack = document.getElementById('volume-track');
    this.volumeFill = document.getElementById('volume-fill');
    this.muteBtn = document.getElementById('btn-mute');

    // Modals
    this.autoImportModal = document.getElementById('auto-import-modal');
    this.specsModal = document.getElementById('specs-modal');
    this.uploadModal = document.getElementById('upload-modal');
    this.canvas = document.getElementById('visualizer-canvas');
    this.canvasCtx = this.canvas.getContext('2d');
    this.toastContainer = document.getElementById('toast-container');

    // Auto Feed State
    this.feedStatus = { state: 'idle', message: 'Autonomous engine standby', total_synced: 0 };

    // Audio Visualizer
    this.audioCtx = null;
    this.analyser = null;
    this.sourceNode = null;
    this.visualizerInitialized = false;

    this.init();
  }

  showToast(message, icon = '🎵') {
    if (!this.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-msg">${message}</div>
    `;
    this.toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 4500);
  }

  async init() {
    this.setupEventListeners();
    await this.fetchInitialData();
    this.render();
    this.setupAudioEvents();
    this.startAutoSyncPolling();
  }

  // -----------------------------------------------------------
  // Data Fetching & Real-time Auto-Sync
  // -----------------------------------------------------------
  async fetchInitialData() {
    try {
      const [tracksRes, playlistsRes, statsRes] = await Promise.all([
        fetch('/api/tracks'),
        fetch('/api/playlists'),
        fetch('/api/stats')
      ]);

      const tracksData = await tracksRes.json();
      const playlistsData = await playlistsRes.json();
      const statsData = await statsRes.json();

      this.tracks = tracksData.tracks || [];
      this.playlists = playlistsData.playlists || [];
      this.dbVersion = statsData.version;

      document.getElementById('stat-tracks-count').innerText = statsData.tracksCount || this.tracks.length;
      document.getElementById('stat-lossless-count').innerText = statsData.losslessCount || this.tracks.length;

      this.renderSidebarPlaylists();

      if (this.tracks.length > 0 && !this.currentTrack) {
        this.selectTrack(this.tracks[0], false);
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  }

  startAutoSyncPolling() {
    // Poll every 3 seconds for new auto-feed additions or external downloads
    setInterval(async () => {
      try {
        const [verRes, statusRes] = await Promise.all([
          fetch('/api/version'),
          fetch('/api/auto-feed/status')
        ]);
        const verData = await verRes.json();
        const statData = await statusRes.json();

        const wasSyncing = this.feedStatus?.state === 'syncing';
        this.feedStatus = statData;

        // Update live status text on the Home page banner if visible
        const statusText = document.getElementById('feed-status-detail');
        const syncBtn = document.getElementById('btn-trigger-autofeed');
        if (statusText && statData.message) {
          statusText.innerText = statData.message;
        }
        if (syncBtn) {
          if (statData.state === 'syncing') {
            syncBtn.disabled = true;
            syncBtn.innerHTML = `<span class="sync-spin">🔄</span> Syncing Charts...`;
          } else {
            syncBtn.disabled = false;
            syncBtn.innerHTML = `<span>⚡ Sync Latest Charts Now</span>`;
          }
        }

        // Check if database version changed (new tracks imported)
        if (this.dbVersion && verData.version !== this.dbVersion) {
          console.log('[Auto-Sync] Catalog update detected! Refreshing...');
          const prevCount = this.tracks.length;
          await this.fetchInitialData();
          this.render();

          if (this.tracks.length > prevCount) {
            const added = this.tracks.length - prevCount;
            this.showToast(`✨ ${added} new trending track(s) auto-imported into Sonora!`, '🔥');
          }
        }

        if (wasSyncing && statData.state === 'idle') {
          this.showToast('✅ Chart sync completed. All playlists up to date!', '✨');
        }
      } catch (e) {
        // server busy or transient
      }
    }, 3000);
  }

  // -----------------------------------------------------------
  // Audio Engine & Visualizer
  // -----------------------------------------------------------
  initAudioContext() {
    if (this.visualizerInitialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;

      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      this.visualizerInitialized = true;
      this.startVisualizer();
    } catch (e) {
      console.warn('Audio Context init:', e);
    }
  }

  startVisualizer() {
    if (!this.analyser) return;
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      requestAnimationFrame(draw);
      this.analyser.getByteFrequencyData(dataArray);

      const width = this.canvas.width;
      const height = this.canvas.height;
      this.canvasCtx.clearRect(0, 0, width, height);

      const barWidth = (width / bufferLength) * 1.6;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * height;

        const gradient = this.canvasCtx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, '#10b981');
        gradient.addColorStop(0.6, '#1ed760');
        gradient.addColorStop(1, '#ffffff');

        this.canvasCtx.fillStyle = gradient;
        this.canvasCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
        x += barWidth + 1;
      }
    };
    draw();
  }

  selectTrack(track, autoPlay = true) {
    this.currentTrack = track;
    this.currentIndex = this.tracks.findIndex(t => t.id === track.id);

    this.audio.src = `/api/stream/${track.id}`;

    // Update Player Bar
    this.playerTitle.innerText = track.title;
    this.playerArtist.innerText = track.artist;
    this.playerCover.src = track.cover;
    this.playerBadge.innerText = track.audioQuality.replace('HI-RES ', '');

    if (track.isFavorite) {
      this.playerLikeBtn.classList.add('liked');
      this.playerLikeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
    } else {
      this.playerLikeBtn.classList.remove('liked');
      this.playerLikeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    }

    if (autoPlay) {
      this.play();
    }

    // Update Media Session API (lock-screen controls for Android/iOS)
    this.updateMediaSession(track);

    this.highlightActiveRow();
  }

  updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'Sonora',
        artwork: [
          { src: track.cover, sizes: '512x512', type: 'image/jpeg' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.playNext());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.playPrev());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime && this.audio.duration) {
          this.audio.currentTime = details.seekTime;
        }
      });
      navigator.mediaSession.playbackState = 'playing';
    } catch (err) {
      console.warn('[MediaSession] Error:', err);
    }
  }

  play() {
    this.initAudioContext();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.audio.play()
      .then(() => {
        this.isPlaying = true;
        this.updatePlayBtnState();
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
      })
      .catch(e => console.warn('Play prevented:', e));
  }

  pause() {
    this.audio.pause();
    this.isPlaying = false;
    this.updatePlayBtnState();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  updatePlayBtnState() {
    if (this.isPlaying) {
      this.playIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
    } else {
      this.playIcon.innerHTML = `<polygon points="8,5 19,12 8,19"/>`;
    }
    this.highlightActiveRow();
  }

  playNext() {
    if (this.tracks.length === 0) return;
    if (this.isShuffle) {
      const rand = Math.floor(Math.random() * this.tracks.length);
      this.selectTrack(this.tracks[rand], true);
    } else {
      let nextIdx = this.currentIndex + 1;
      if (nextIdx >= this.tracks.length) nextIdx = 0;
      this.selectTrack(this.tracks[nextIdx], true);
    }
  }

  playPrev() {
    if (this.tracks.length === 0) return;
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    let prevIdx = this.currentIndex - 1;
    if (prevIdx < 0) prevIdx = this.tracks.length - 1;
    this.selectTrack(this.tracks[prevIdx], true);
  }

  setupAudioEvents() {
    this.audio.addEventListener('timeupdate', () => {
      const cur = this.audio.currentTime || 0;
      const dur = this.audio.duration || 0;
      this.currentTimeEl.innerText = this.formatTime(cur);
      this.totalDurationEl.innerText = this.formatTime(dur);

      if (dur > 0) {
        const percent = (cur / dur) * 100;
        this.progressFill.style.width = `${percent}%`;
      }
    });

    this.audio.addEventListener('ended', () => {
      if (this.isRepeat) {
        this.audio.currentTime = 0;
        this.play();
      } else {
        this.playNext();
      }
    });

    this.progressTrack.addEventListener('click', (e) => {
      const rect = this.progressTrack.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      if (this.audio.duration) {
        this.audio.currentTime = pos * this.audio.duration;
      }
    });

    this.volumeTrack.addEventListener('click', (e) => {
      const rect = this.volumeTrack.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.audio.volume = pos;
      this.volumeFill.style.width = `${pos * 100}%`;
    });
  }

  // -----------------------------------------------------------
  // View Rendering
  // -----------------------------------------------------------
  render() {
    if (this.currentView === 'home') {
      this.renderHomeView();
    } else if (this.currentView === 'search') {
      this.renderSearchView();
    } else if (this.currentView === 'library') {
      this.renderLibraryView();
    } else if (this.currentView === 'playlist') {
      this.renderPlaylistView(this.activePlaylistId);
    }
    this.highlightActiveRow();
  }

  renderHomeView() {
    const quickTiles = this.tracks.slice(0, 6);

    let filteredTracks = [...this.tracks];
    if (this.activeFilter === 'bangla') {
      filteredTracks = filteredTracks.filter(t => 
        (t.genre || '').toLowerCase().includes('bangla') || 
        (t.album || '').toLowerCase().includes('bangla')
      );
    } else if (this.activeFilter === 'bollywood') {
      filteredTracks = filteredTracks.filter(t => 
        (t.genre || '').toLowerCase().includes('bollywood') || 
        (t.album || '').toLowerCase().includes('bollywood')
      );
    } else if (this.activeFilter === 'spotify') {
      filteredTracks = filteredTracks.filter(t => 
        (t.genre || '').toLowerCase().includes('global') || 
        (t.album || '').toLowerCase().includes('global') ||
        (t.album || '').toLowerCase().includes('spotify')
      );
    } else if (this.activeFilter === 'punjabi') {
      filteredTracks = filteredTracks.filter(t => 
        (t.genre || '').toLowerCase().includes('punjabi') || 
        (t.genre || '').toLowerCase().includes('hip-hop') ||
        (t.genre || '').toLowerCase().includes('desi') ||
        (t.genre || '').toLowerCase().includes('trap')
      );
    } else if (this.activeFilter === 'lofi') {
      filteredTracks = filteredTracks.filter(t => (t.genre || '').toLowerCase().includes('lo-fi'));
    } else if (this.activeFilter === 'hires') {
      filteredTracks = filteredTracks.filter(t => (t.audioQuality || '').includes('HI-RES') || (t.audioQuality || '').includes('LOSSLESS'));
    } else if (this.activeFilter === 'classical') {
      filteredTracks = filteredTracks.filter(t => (t.genre || '').toLowerCase().includes('classical'));
    }

    const isSyncing = this.feedStatus?.state === 'syncing';

    this.viewContainer.innerHTML = `
      <!-- LIQUID GLASS AUTONOMOUS FEED BANNER -->
      <div class="auto-feed-banner">
        <div class="auto-feed-left">
          <div class="auto-feed-badge-row">
            <span class="feed-pulse-indicator">
              <span class="pulse-dot"></span>
              ${isSyncing ? 'Syncing Now' : 'Auto-Feed Active'}
            </span>
            <span class="feed-status-text" id="feed-status-detail">
              ${this.feedStatus?.message || `Standby • ${this.tracks.length} songs ready in library`}
            </span>
          </div>
          <div class="auto-feed-title">Autonomous Cloud Feed (Spotify & YouTube Music)</div>
          <div class="auto-feed-desc">
            Trending songs are automatically fetched, converted to 320kbps / Lossless, and added to your playlists every 30 minutes. Zero manual work required.
          </div>
        </div>
        <div class="auto-feed-right">
          <button class="btn-sync-feed" id="btn-trigger-autofeed" ${isSyncing ? 'disabled' : ''}>
            ${isSyncing ? '<span class="sync-spin">🔄</span> Syncing Charts...' : '<span>⚡ Sync Latest Charts Now</span>'}
          </button>
        </div>
      </div>

      <h1 class="quick-play-header">Good evening</h1>

      <!-- Spotify 6 Quick-Play Liquid Glass Tiles -->
      <div class="quick-play-grid">
        ${quickTiles.map(t => `
          <div class="quick-play-tile" data-track-id="${t.id}">
            <img src="${t.cover}" class="tile-img" alt="">
            <span class="tile-text">${t.title}</span>
            <div class="tile-play-btn">
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="8,5 19,12 8,19"/></svg>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Category Filter Pills -->
      <div class="filter-row">
        <button class="chip-btn ${this.activeFilter === 'all' ? 'active' : ''}" data-filter="all">All Songs (${this.tracks.length})</button>
        <button class="chip-btn ${this.activeFilter === 'spotify' ? 'active' : ''}" data-filter="spotify">🔥 Spotify Global Top 50</button>
        <button class="chip-btn ${this.activeFilter === 'bollywood' ? 'active' : ''}" data-filter="bollywood">🎬 Bollywood Hits</button>
        <button class="chip-btn ${this.activeFilter === 'bangla' ? 'active' : ''}" data-filter="bangla">🇧🇩 Bangla Viral Hits</button>
        <button class="chip-btn ${this.activeFilter === 'punjabi' ? 'active' : ''}" data-filter="punjabi">🎧 Desi Hip-Hop & Punjabi</button>
        <button class="chip-btn ${this.activeFilter === 'lofi' ? 'active' : ''}" data-filter="lofi">☕ Lo-Fi Chill Beats</button>
        <button class="chip-btn ${this.activeFilter === 'hires' ? 'active' : ''}" data-filter="hires">💎 Hi-Res Lossless 24-bit</button>
        <button class="chip-btn ${this.activeFilter === 'classical' ? 'active' : ''}" data-filter="classical">🎻 Classical Masters</button>
      </div>

      <!-- Playlists Section -->
      <div class="section-header">
        <h2>Curated Playlists (Spotify & YouTube Music)</h2>
      </div>
      <div class="track-grid" style="margin-bottom: 40px;">
        ${this.playlists.map(pl => `
          <div class="track-card playlist-card" data-playlist-id="${pl.id}">
            <div class="card-cover-container">
              <img src="${pl.cover}" class="card-cover" alt="">
              <div class="card-play-overlay">
                <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
              </div>
            </div>
            <div class="card-title">${pl.name}</div>
            <div class="card-artist">${pl.description || `${pl.trackIds.length} tracks`}</div>
          </div>
        `).join('')}
      </div>

      <!-- Track Catalog Table -->
      <div class="section-header">
        <h2>All Songs (${filteredTracks.length})</h2>
      </div>
      ${this.renderTrackTable(filteredTracks)}
    `;

    document.getElementById('btn-trigger-autofeed')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-trigger-autofeed');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="sync-spin">🔄</span> Syncing Charts...`;
      }
      this.showToast('🚀 Initiating autonomous chart sync with Spotify & YouTube Music...', '⚡');
      try {
        await fetch('/api/auto-feed/sync', { method: 'POST' });
      } catch (err) {
        console.error('Trigger sync error:', err);
      }
    });
  }

  renderTrackTable(tracksList) {
    if (tracksList.length === 0) {
      return `<p style="color:var(--text-muted); padding: 24px 0;">No tracks in this category.</p>`;
    }

    return `
      <table class="track-table">
        <thead>
          <tr>
            <th class="track-num-cell">#</th>
            <th>Title</th>
            <th>Album</th>
            <th>Quality Specs</th>
            <th>Duration</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${tracksList.map((t, idx) => `
            <tr class="track-row ${this.currentTrack?.id === t.id ? 'playing' : ''}" data-track-id="${t.id}">
              <td class="track-num-cell">${idx + 1}</td>
              <td>
                <div class="row-track-info">
                  <img src="${t.cover}" alt="" class="row-cover">
                  <div class="row-text">
                    <span class="row-title">${t.title}</span>
                    <span class="row-artist">${t.artist}</span>
                  </div>
                </div>
              </td>
              <td class="row-album">${t.album}</td>
              <td class="row-specs">
                <span class="row-badge">
                  ${t.specs.sampleRate / 1000}kHz / ${t.specs.bitDepth}-bit
                </span>
              </td>
              <td>${this.formatTime(t.duration)}</td>
              <td class="row-actions">
                <button class="btn-icon btn-row-like ${t.isFavorite ? 'liked' : ''}" data-track-id="${t.id}" title="Favorite">
                  ♥
                </button>
                <button class="btn-icon btn-row-info" data-track-id="${t.id}" title="Audio Specs">
                  ℹ
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  renderSearchView() {
    const query = this.searchInput.value.trim().toLowerCase();
    const results = query
      ? this.tracks.filter(t =>
          t.title.toLowerCase().includes(query) ||
          t.artist.toLowerCase().includes(query) ||
          t.album.toLowerCase().includes(query) ||
          t.genre.toLowerCase().includes(query)
        )
      : this.tracks;

    this.viewContainer.innerHTML = `
      <div class="section-header">
        <h2>${query ? `Search Results for "${query}" (${results.length})` : 'Browse All Songs'}</h2>
      </div>
      ${this.renderTrackTable(results)}
    `;
  }

  renderLibraryView() {
    const favoriteTracks = this.tracks.filter(t => t.isFavorite);

    this.viewContainer.innerHTML = `
      <div class="section-header">
        <h2>Your Library</h2>
      </div>
      <div class="track-grid">
        <div class="track-card" id="card-liked-songs" style="background: rgba(30,215,96,0.15); border-color: rgba(30,215,96,0.4);">
          <div class="card-cover-container" style="display:flex;align-items:center;justify-content:center;background:#1ed760;">
            <span style="font-size:3.2rem;color:#000;">♥</span>
          </div>
          <div class="card-title" style="font-size:1.15rem;">Liked Songs</div>
          <div class="card-artist" style="color:var(--spotify-green); font-weight:700;">${favoriteTracks.length} tracks</div>
        </div>
        ${this.playlists.map(pl => `
          <div class="track-card playlist-card" data-playlist-id="${pl.id}">
            <div class="card-cover-container">
              <img src="${pl.cover}" class="card-cover">
            </div>
            <div class="card-title">${pl.name}</div>
            <div class="card-artist">${pl.trackIds.length} tracks</div>
          </div>
        `).join('')}
      </div>

      <div class="section-header" style="margin-top: 40px;">
        <h2>Liked Songs Spotlight</h2>
      </div>
      ${this.renderTrackTable(favoriteTracks)}
    `;

    document.getElementById('card-liked-songs')?.addEventListener('click', () => {
      this.renderLikedSongsView();
    });
  }

  renderPlaylistView(playlistId) {
    const pl = this.playlists.find(p => p.id === playlistId);
    if (!pl) return this.renderHomeView();

    const plTracks = (pl.trackIds || [])
      .map(id => this.tracks.find(t => t.id === id))
      .filter(Boolean);

    this.viewContainer.innerHTML = `
      <div class="quick-play-tile" style="padding: 24px; height: auto; margin-bottom: 32px; background: rgba(30,215,96,0.12); border-color: rgba(30,215,96,0.35);">
        <img src="${pl.cover}" style="width: 160px; height: 160px; border-radius: 12px; margin-right: 24px; box-shadow: 0 8px 24px rgba(0,0,0,0.6);" alt="">
        <div style="display:flex; flex-direction:column; gap:8px;">
          <span style="font-size:0.75rem; font-weight:800; color:var(--spotify-green); letter-spacing:1.5px;">PLAYLIST</span>
          <h1 style="font-size:2.2rem; font-weight:900;">${pl.name}</h1>
          <p style="color:var(--text-secondary); font-size:0.95rem;">${pl.description || 'Curated high fidelity playlist'}</p>
          <div style="margin-top:12px;">
            <button class="btn-primary" id="btn-play-all-playlist" style="width:auto; padding:12px 32px;">
              Play Playlist
            </button>
          </div>
        </div>
      </div>
      ${this.renderTrackTable(plTracks)}
    `;

    document.getElementById('btn-play-all-playlist')?.addEventListener('click', () => {
      if (plTracks.length > 0) this.selectTrack(plTracks[0], true);
    });
  }

  renderLikedSongsView() {
    const favoriteTracks = this.tracks.filter(t => t.isFavorite);
    this.viewContainer.innerHTML = `
      <div class="quick-play-tile" style="padding: 24px; height: auto; margin-bottom: 32px; background: rgba(30,215,96,0.12); border-color: rgba(30,215,96,0.35);">
        <div style="width: 160px; height: 160px; border-radius: 12px; margin-right: 24px; background: #1ed760; display:flex; align-items:center; justify-content:center; box-shadow: 0 8px 24px rgba(0,0,0,0.6);">
          <span style="font-size:4rem; color:#000;">♥</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <span style="font-size:0.75rem; font-weight:800; color:var(--spotify-green); letter-spacing:1.5px;">COLLECTION</span>
          <h1 style="font-size:2.2rem; font-weight:900;">Liked Songs</h1>
          <p style="color:var(--text-secondary); font-size:0.95rem;">${favoriteTracks.length} high-fidelity favorite songs</p>
          <div style="margin-top:12px;">
            <button class="btn-primary" id="btn-play-all-liked" style="width:auto; padding:12px 32px;">
              Play Favorites
            </button>
          </div>
        </div>
      </div>
      ${this.renderTrackTable(favoriteTracks)}
    `;

    document.getElementById('btn-play-all-liked')?.addEventListener('click', () => {
      if (favoriteTracks.length > 0) this.selectTrack(favoriteTracks[0], true);
    });
  }

  renderSidebarPlaylists() {
    const container = document.getElementById('sidebar-playlists-list');
    container.innerHTML = `
      <div class="sidebar-playlists-header">PLAYLISTS</div>
      ${this.playlists.map(p => `
        <div class="playlist-sidebar-link ${this.activePlaylistId === p.id ? 'active' : ''}" data-playlist-id="${p.id}">
          ${p.name}
        </div>
      `).join('')}
    `;
  }

  highlightActiveRow() {
    document.querySelectorAll('.track-row').forEach(row => {
      const id = row.getAttribute('data-track-id');
      if (id === this.currentTrack?.id) {
        row.classList.add('playing');
      } else {
        row.classList.remove('playing');
      }
    });
  }

  openSpecsModal(track) {
    if (!track) return;
    const content = document.getElementById('specs-modal-content');
    content.innerHTML = `
      <div class="spec-card">
        <div class="spec-label">Audio Container / Codec</div>
        <div class="spec-val" style="color:var(--spotify-green);">${track.specs.format}</div>
      </div>
      <div class="spec-card">
        <div class="spec-label">Sample Rate</div>
        <div class="spec-val" style="color:var(--spotify-green);">${track.specs.sampleRate.toLocaleString()} Hz</div>
      </div>
      <div class="spec-card">
        <div class="spec-label">Bit Depth</div>
        <div class="spec-val" style="color:#ffffff;">${track.specs.bitDepth}-Bit Pure PCM</div>
      </div>
      <div class="spec-card">
        <div class="spec-label">Audio Bitrate</div>
        <div class="spec-val">${track.specs.bitrate}</div>
      </div>
      <div class="spec-card">
        <div class="spec-label">Channels</div>
        <div class="spec-val">${track.specs.channels === 2 ? 'Stereo (2.0)' : 'Mono (1.0)'}</div>
      </div>
      <div class="spec-card">
        <div class="spec-label">Audio License</div>
        <div class="spec-val" style="font-size:0.95rem;">${track.license}</div>
      </div>
    `;
    this.specsModal.classList.add('active');
  }

  // -----------------------------------------------------------
  // Event Listeners
  // -----------------------------------------------------------
  setupEventListeners() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        this.currentView = item.getAttribute('data-view');
        this.render();
      });
    });

    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.nextBtn.addEventListener('click', () => this.playNext());
    this.prevBtn.addEventListener('click', () => this.playPrev());

    this.shuffleBtn.addEventListener('click', () => {
      this.isShuffle = !this.isShuffle;
      this.shuffleBtn.classList.toggle('active', this.isShuffle);
    });

    this.repeatBtn.addEventListener('click', () => {
      this.isRepeat = !this.isRepeat;
      this.repeatBtn.classList.toggle('active', this.isRepeat);
    });

    this.muteBtn.addEventListener('click', () => {
      this.audio.muted = !this.audio.muted;
      this.muteBtn.style.color = this.audio.muted ? '#ef4444' : 'var(--text-secondary)';
    });

    // Auto-Import Modal triggers
    const openAutoImport = () => {
      this.autoImportModal.classList.add('active');
      document.getElementById('auto-import-query').focus();
    };
    document.getElementById('btn-open-auto-import')?.addEventListener('click', openAutoImport);
    document.getElementById('btn-top-auto-import')?.addEventListener('click', openAutoImport);
    document.getElementById('btn-close-auto-import')?.addEventListener('click', () => {
      this.autoImportModal.classList.remove('active');
    });

    // Handle Auto-Import Form Submit
    document.getElementById('auto-import-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('auto-import-query');
      const submitBtn = document.getElementById('btn-submit-auto-import');
      const notice = document.getElementById('import-status-notice');
      const query = input.value.trim();
      if (!query) return;

      submitBtn.disabled = true;
      notice.style.display = 'block';
      notice.style.background = 'rgba(30,215,96,0.15)';
      notice.style.color = '#1ed760';
      notice.innerText = `Fetching "${query}" in 320kbps master quality...`;

      try {
        const res = await fetch('/api/import-youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        });
        const data = await res.json();
        if (data.success && data.track) {
          notice.innerText = `Successfully imported: ${data.track.title}!`;
          await this.fetchInitialData();
          this.render();
          this.selectTrack(data.track, true);
          setTimeout(() => {
            this.autoImportModal.classList.remove('active');
            input.value = '';
            notice.style.display = 'none';
          }, 1500);
        } else {
          notice.style.background = 'rgba(239,68,68,0.2)';
          notice.style.color = '#ef4444';
          notice.innerText = 'Import error: ' + (data.error || 'Failed to download track');
        }
      } catch (err) {
        notice.style.background = 'rgba(239,68,68,0.2)';
        notice.style.color = '#ef4444';
        notice.innerText = 'Network error: ' + err.message;
      } finally {
        submitBtn.disabled = false;
      }
    });

    document.getElementById('btn-audio-specs')?.addEventListener('click', () => {
      this.openSpecsModal(this.currentTrack);
    });
    document.getElementById('btn-close-specs')?.addEventListener('click', () => {
      this.specsModal.classList.remove('active');
    });

    document.getElementById('btn-open-upload')?.addEventListener('click', () => {
      this.uploadModal.classList.add('active');
    });
    document.getElementById('btn-close-upload')?.addEventListener('click', () => {
      this.uploadModal.classList.remove('active');
    });

    // Search
    this.searchInput.addEventListener('input', () => {
      if (this.searchInput.value.length > 0) {
        this.clearSearchBtn.style.display = 'block';
        this.currentView = 'search';
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelector('[data-view="search"]').classList.add('active');
      } else {
        this.clearSearchBtn.style.display = 'none';
      }
      this.render();
    });

    this.clearSearchBtn.addEventListener('click', () => {
      this.searchInput.value = '';
      this.clearSearchBtn.style.display = 'none';
      this.render();
    });

    document.getElementById('btn-open-create-playlist')?.addEventListener('click', async () => {
      const name = prompt('Enter a name for your new playlist:');
      if (!name) return;
      try {
        const res = await fetch('/api/playlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const newPl = await res.json();
        this.playlists.push(newPl);
        this.renderSidebarPlaylists();
        this.activePlaylistId = newPl.id;
        this.currentView = 'playlist';
        this.render();
      } catch (e) {
        console.error(e);
      }
    });

    document.getElementById('btn-view-liked')?.addEventListener('click', () => {
      this.renderLikedSongsView();
    });

    this.playerLikeBtn.addEventListener('click', async () => {
      if (!this.currentTrack) return;
      await this.toggleFavorite(this.currentTrack.id);
    });

    document.addEventListener('click', async (e) => {
      const chip = e.target.closest('.chip-btn');
      if (chip) {
        this.activeFilter = chip.getAttribute('data-filter');
        this.render();
        return;
      }

      const tile = e.target.closest('.quick-play-tile');
      if (tile && !e.target.closest('#btn-play-all-playlist') && !e.target.closest('#btn-play-all-liked')) {
        const trackId = tile.getAttribute('data-track-id');
        const track = this.tracks.find(t => t.id === trackId);
        if (track) this.selectTrack(track, true);
        return;
      }

      const card = e.target.closest('.track-card:not(.playlist-card)');
      if (card && !card.id) {
        const trackId = card.getAttribute('data-track-id');
        const track = this.tracks.find(t => t.id === trackId);
        if (track) this.selectTrack(track, true);
        return;
      }

      const plEl = e.target.closest('[data-playlist-id]');
      if (plEl) {
        this.activePlaylistId = plEl.getAttribute('data-playlist-id');
        this.currentView = 'playlist';
        this.render();
        this.renderSidebarPlaylists();
        return;
      }

      const row = e.target.closest('.track-row');
      if (row && !e.target.closest('.btn-icon')) {
        const trackId = row.getAttribute('data-track-id');
        const track = this.tracks.find(t => t.id === trackId);
        if (track) this.selectTrack(track, true);
        return;
      }

      const likeBtn = e.target.closest('.btn-row-like');
      if (likeBtn) {
        e.stopPropagation();
        const trackId = likeBtn.getAttribute('data-track-id');
        await this.toggleFavorite(trackId);
        return;
      }

      const infoBtn = e.target.closest('.btn-row-info');
      if (infoBtn) {
        e.stopPropagation();
        const trackId = infoBtn.getAttribute('data-track-id');
        const track = this.tracks.find(t => t.id === trackId);
        if (track) this.openSpecsModal(track);
        return;
      }
    });
  }

  async toggleFavorite(trackId) {
    try {
      const res = await fetch(`/api/favorites/${trackId}/toggle`, { method: 'POST' });
      const data = await res.json();
      const track = this.tracks.find(t => t.id === trackId);
      if (track) {
        track.isFavorite = data.isFavorite;
      }
      if (this.currentTrack?.id === trackId) {
        this.currentTrack.isFavorite = data.isFavorite;
        if (data.isFavorite) {
          this.playerLikeBtn.classList.add('liked');
          this.playerLikeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
        } else {
          this.playerLikeBtn.classList.remove('liked');
          this.playerLikeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
        }
      }
      this.render();
    } catch (e) {
      console.error(e);
    }
  }

  formatTime(secs) {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new SonoraApp();
});
