const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const pasteBtn = document.getElementById('paste-btn');
const submitBtn = document.getElementById('submit-btn');
const statusCard = document.getElementById('status-card');
const resultsContainer = document.getElementById('results-container');
const collectionHeader = document.getElementById('collection-header');
const trackList = document.getElementById('track-list');
const audioPlayer = document.getElementById('audio-player');
const heroTitle = document.getElementById('hero-title');
const heroSubtitle = document.getElementById('hero-subtitle');

// Social / video UI elements
const mediaCard = document.getElementById('media-card');
const mediaThumb = document.getElementById('media-thumb');
const platformBadge = document.getElementById('platform-badge');
const mediaTitle = document.getElementById('media-title');
const mediaMeta = document.getElementById('media-meta');
const formatToggle = document.getElementById('format-toggle');
const qualityGroup = document.getElementById('quality-group');
const qualitySelect = document.getElementById('quality-select');
const socialDownloadBtn = document.getElementById('social-download-btn');
const progressWrap = document.getElementById('progress-wrap');
const progressStatus = document.getElementById('progress-status');
const progressPct = document.getElementById('progress-pct');
const progressBar = document.getElementById('progress-bar');
const progressMeta = document.getElementById('progress-meta');

let activeTab = 'spotify';
let currentPlayingBtn = null;
let currentTracks = [];
let currentCollectionTitle = 'Spotify Collection';
let selectedFormat = 'audio';
let currentSocialUrl = '';
let pollTimer = null;
let batchRunning = false;

const TAB_CONFIG = {
  spotify: {
    title: 'Spotify Downloader',
    subtitle: 'Paste any Spotify track, playlist, or album link — or search by song name. Direct 320kbps MP3s without popups or limits.',
    placeholder: 'Search song or paste Spotify track, playlist, or album link…'
  },
  youtube: {
    title: 'YouTube Downloader',
    subtitle: 'Paste a YouTube link to download 1080p MP4 video or MP3 audio. No ads, no popups, no limits.',
    placeholder: 'Paste YouTube URL (youtube.com or youtu.be)…'
  },
  twitter: {
    title: 'Twitter / X Downloader',
    subtitle: 'Paste any Twitter or X.com post link containing a video or GIF.',
    placeholder: 'Paste Twitter / X post URL…'
  },
  tiktok: {
    title: 'TikTok Downloader',
    subtitle: 'Paste a TikTok video link to download without watermark (MP4 or MP3).',
    placeholder: 'Paste TikTok URL…'
  }
};

function switchTab(tab, keepInput = false) {
  if (!TAB_CONFIG[tab] || tab === activeTab) return;
  activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach(b => {
    const isSelected = b.dataset.tab === tab;
    b.classList.toggle('active', isSelected);
    b.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });

  const cfg = TAB_CONFIG[tab];
  heroTitle.textContent = cfg.title;
  heroSubtitle.textContent = cfg.subtitle;
  searchInput.placeholder = cfg.placeholder;

  clearOutputs();
  if (!keepInput) {
    searchInput.value = '';
    searchInput.focus();
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab, false));
});

function detectTabFromUrl(text) {
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const host = new URL(text).hostname.toLowerCase().replace(/^www\.|^m\./, '');
    if (host.endsWith('spotify.com') || host === 'spotify.link') return 'spotify';
    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube';
    if (host === 'twitter.com' || host.endsWith('.twitter.com') || host === 'x.com') return 'twitter';
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  } catch (_) {}
  return null;
}

function autoSwitchTabFromUrl(text) {
  const detected = detectTabFromUrl(text);
  if (detected && detected !== activeTab) {
    switchTab(detected, true);
  }
}

/**
 * Determine whether input is a non-Spotify HTTP(S) URL (YouTube, Twitter/X, TikTok, etc.)
 * vs a Spotify link (track/playlist/album) or song text search.
 */
function isSocialVideoUrl(text) {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const host = new URL(text).hostname.toLowerCase();
    return !host.endsWith('spotify.com') && host !== 'spotify.link';
  } catch (_) {
    return false;
  }
}

function clearOutputs() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  audioPlayer.pause();
  audioPlayer.src = '';
  currentPlayingBtn = null;
  currentTracks = [];
  batchRunning = false;

  setStatus('');
  resultsContainer.classList.add('hidden');
  trackList.innerHTML = '';
  collectionHeader.innerHTML = '';
  collectionHeader.classList.add('hidden');
  mediaCard.classList.add('hidden');
  progressWrap.classList.add('hidden');
}

searchInput.addEventListener('input', () => {
  autoSwitchTabFromUrl(searchInput.value.trim());
});

pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      searchInput.value = text.trim();
      autoSwitchTabFromUrl(text.trim());
      searchInput.focus();
    }
  } catch (err) {
    console.warn('Clipboard read failed:', err);
  }
});

formatToggle.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedFormat = btn.dataset.value;
    formatToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    qualityGroup.classList.toggle('hidden', selectedFormat === 'audio');
  });
});

function setStatus(msg, isError = false) {
  if (!msg) {
    statusCard.className = 'status-card hidden';
    statusCard.textContent = '';
    return;
  }
  statusCard.className = `status-card ${isError ? 'error' : ''}`;
  statusCard.textContent = msg;
}

function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Unified Form Submit: auto-routes Spotify (track/playlist/album/search) vs Social video URL
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;

  autoSwitchTabFromUrl(q);
  clearOutputs();
  const socialMode = activeTab !== 'spotify' || isSocialVideoUrl(q);

  submitBtn.disabled = true;
  submitBtn.querySelector('span').textContent = socialMode ? 'Fetching...' : 'Searching...';
  setStatus(socialMode ? 'Extracting media metadata...' : 'Resolving Spotify tracks, playlists & albums...');

  try {
    if (socialMode) {
      currentSocialUrl = q;
      const res = await fetch(`/api/info?url=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to inspect URL');

      setStatus('');
      renderSocialCard(data);
    } else {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to search tracks');

      const items = data.items || [];
      if (items.length === 0) {
        setStatus('No tracks found for this link or query.', true);
        return;
      }

      setStatus('');
      renderSpotifyResults(data);
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('span').textContent = 'Fetch';
  }
});

// ── Spotify Rendering (Track / Playlist / Album / Search) ───────────
function renderSpotifyResults(data) {
  const items = data.items || [];
  currentTracks = items;
  resultsContainer.classList.remove('hidden');

  const typeLabel = (data.type || 'track').toUpperCase();

  if (data.meta && (data.type === 'album' || data.type === 'playlist')) {
    currentCollectionTitle = data.meta.title || 'Spotify Collection';
    collectionHeader.classList.remove('hidden');
    collectionHeader.innerHTML = `
      <div class="collection-left">
        ${data.meta.thumbnail ? `<img src="${escapeHtml(data.meta.thumbnail)}" class="collection-thumb" alt="Cover">` : ''}
        <div class="collection-info">
          <span class="type-badge">${escapeHtml(typeLabel)}</span>
          <h2>${escapeHtml(data.meta.title)}</h2>
          <p>${escapeHtml(data.meta.artist || 'Collection')} &bull; ${items.length} Tracks</p>
        </div>
      </div>
      <button type="button" id="dl-all-btn" class="dl-all-btn">&#10515; Download All ZIP (${items.length})</button>
    `;
  } else {
    currentCollectionTitle = 'Spotify Collection';
    collectionHeader.classList.add('hidden');
  }

  items.forEach((track, index) => {
    const card = document.createElement('div');
    card.className = 'track-card';

    card.innerHTML = `
      <div class="track-main">
        ${track.thumbnail ? `<img src="${escapeHtml(track.thumbnail)}" class="track-thumb" alt="Art">` : ''}
        <div class="track-meta">
          <div class="track-title">${escapeHtml(track.title)}</div>
          <div class="track-artist">${escapeHtml(track.artist)} &bull; ${formatDuration(track.duration)}</div>
        </div>
      </div>
      <div class="track-actions">
        ${track.previewUrl ? `
          <button type="button" class="action-btn preview-btn" data-index="${index}">
            <span>&#9654;</span> Preview
          </button>
        ` : ''}
        <button type="button" class="action-btn dl-btn" data-index="${index}">
          <span>&#10515;</span> Download MP3
        </button>
      </div>
    `;

    trackList.appendChild(card);
  });

  attachSpotifyListeners();
}

async function convertAndDownloadTrack(track, btn) {
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<span>&#8987;</span> Converting...';

  try {
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: track.title,
        artist: track.artist,
        album: track.album,
        thumbnail: track.thumbnail,
        duration: track.duration
      })
    });

    const data = await res.json();
    if (!res.ok || !data.downloadUrl) {
      throw new Error(data.error || 'Conversion failed');
    }

    btn.innerHTML = '<span>&#10003;</span> Downloading...';
    triggerDownload(data.downloadUrl, data.filename || `${track.artist} - ${track.title}.mp3`);

    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }, 2500);
    return true;
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    throw err;
  }
}

function attachSpotifyListeners() {
  document.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const track = currentTracks[parseInt(btn.dataset.index, 10)];
      if (!track || !track.previewUrl) return;

      if (currentPlayingBtn === btn && !audioPlayer.paused) {
        audioPlayer.pause();
        btn.innerHTML = '<span>&#9654;</span> Preview';
        currentPlayingBtn = null;
        return;
      }

      if (currentPlayingBtn) {
        currentPlayingBtn.innerHTML = '<span>&#9654;</span> Preview';
      }

      audioPlayer.src = track.previewUrl;
      try {
        await audioPlayer.play();
        btn.innerHTML = '<span>&#9208;</span> Pause';
        currentPlayingBtn = btn;
      } catch (err) {
        setStatus(`Preview unavailable: ${err.message}`, true);
        btn.innerHTML = '<span>&#9654;</span> Preview';
        currentPlayingBtn = null;
      }

      audioPlayer.onended = () => {
        btn.innerHTML = '<span>&#9654;</span> Preview';
        currentPlayingBtn = null;
      };
    });
  });

  document.querySelectorAll('.dl-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const track = currentTracks[parseInt(btn.dataset.index, 10)];
      if (!track) return;
      try {
        await convertAndDownloadTrack(track, btn);
      } catch (err) {
        setStatus(`Failed to download "${track.title}": ${err.message}`, true);
      }
    });
  });

  const dlAllBtn = document.getElementById('dl-all-btn');
  if (dlAllBtn) {
    dlAllBtn.addEventListener('click', async () => {
      if (batchRunning || !currentTracks.length) return;
      batchRunning = true;
      dlAllBtn.disabled = true;
      dlAllBtn.textContent = 'Preparing ZIP…';
      setStatus('');

      progressWrap.classList.remove('hidden');
      progressStatus.textContent = `Starting batch download (0/${currentTracks.length})…`;
      progressPct.textContent = '0%';
      progressBar.style.width = '0%';
      progressMeta.textContent = 'Converting tracks & packaging ZIP archive…';

      try {
        const res = await fetch('/api/download-zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: currentCollectionTitle,
            items: currentTracks
          })
        });
        const data = await res.json();
        if (!res.ok || !data.jobId) throw new Error(data.error || 'Failed to start ZIP download');

        pollZipJob(data.jobId, dlAllBtn);
      } catch (err) {
        batchRunning = false;
        dlAllBtn.disabled = false;
        dlAllBtn.innerHTML = `&#10515; Download All ZIP (${currentTracks.length})`;
        progressStatus.textContent = 'Error';
        setStatus(`Batch download failed: ${err.message}`, true);
      }
    });
  }
}

function pollZipJob(jobId, dlAllBtn) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${encodeURIComponent(jobId)}`);
      const data = await res.json();

      if (data.progress) {
        const pct = Math.min(100, Math.round(data.progress.percent || 0));
        const cur = data.progress.current || 0;
        const tot = data.progress.total || currentTracks.length;
        progressPct.textContent = `${pct}%`;
        progressBar.style.width = `${pct}%`;

        if (data.status === 'processing') {
          progressStatus.textContent = 'Packaging ZIP archive…';
          dlAllBtn.textContent = 'Zipping…';
        } else {
          progressStatus.textContent = `Converting (${cur}/${tot})…`;
          dlAllBtn.textContent = `Converting ${cur}/${tot}…`;
        }
        progressMeta.textContent = data.progress.currentTrack || '';
      }

      if (data.status === 'done' && data.result) {
        clearInterval(pollTimer);
        pollTimer = null;
        batchRunning = false;
        dlAllBtn.disabled = false;
        dlAllBtn.innerHTML = `&#10515; Download All ZIP (${currentTracks.length})`;

        const sizeMb = (data.result.size / (1024 * 1024)).toFixed(2);
        const failNote = data.result.failed ? ` (${data.result.failed} skipped)` : '';
        progressPct.textContent = '100%';
        progressBar.style.width = '100%';
        progressStatus.textContent = `Ready: ${data.result.filename}`;
        progressMeta.textContent = `${data.result.downloaded} track(s) • ${sizeMb} MB${failNote}`;

        triggerDownload(data.result.downloadUrl, data.result.filename);
      } else if (data.status === 'error') {
        clearInterval(pollTimer);
        pollTimer = null;
        batchRunning = false;
        dlAllBtn.disabled = false;
        dlAllBtn.innerHTML = `&#10515; Download All ZIP (${currentTracks.length})`;
        progressStatus.textContent = 'Error';
        setStatus(`Batch download failed: ${data.error}`, true);
      }
    } catch (err) {
      clearInterval(pollTimer);
      pollTimer = null;
      batchRunning = false;
      dlAllBtn.disabled = false;
      dlAllBtn.innerHTML = `&#10515; Download All ZIP (${currentTracks.length})`;
      setStatus(`Polling error: ${err.message}`, true);
    }
  }, 700);
}

// ── Social Media Card & Job Polling ─────────────────────────────────
function renderSocialCard(data) {
  mediaThumb.src = data.thumbnail || '';
  mediaThumb.style.display = data.thumbnail ? 'block' : 'none';
  platformBadge.textContent = (data.platformInfo && data.platformInfo.name) || data.platform || 'WEB';
  mediaTitle.textContent = data.title || 'Untitled Media';
  const dur = data.duration ? formatDuration(data.duration) : '';
  mediaMeta.textContent = [data.uploader, dur].filter(Boolean).join(' • ') || 'Ready to download';

  if (data.platform === 'twitter' || data.platform === 'tiktok') {
    selectedFormat = 'video';
    formatToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.value === 'video'));
    qualityGroup.classList.remove('hidden');
  }

  mediaCard.classList.remove('hidden');
  socialDownloadBtn.disabled = false;
}

socialDownloadBtn.addEventListener('click', async () => {
  if (!currentSocialUrl) return;
  socialDownloadBtn.disabled = true;
  progressWrap.classList.remove('hidden');
  progressStatus.textContent = 'Starting download…';
  progressPct.textContent = '0%';
  progressBar.style.width = '0%';
  progressMeta.textContent = '';

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentSocialUrl,
        format: selectedFormat,
        quality: qualitySelect.value
      })
    });
    const data = await res.json();
    if (!res.ok || !data.jobId) throw new Error(data.error || 'Failed to start download job');

    pollJob(data.jobId);
  } catch (err) {
    progressStatus.textContent = 'Download failed';
    setStatus(`Error: ${err.message}`, true);
    socialDownloadBtn.disabled = false;
  }
});

function pollJob(jobId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${encodeURIComponent(jobId)}`);
      const data = await res.json();

      if (data.progress) {
        const pct = Math.min(100, Math.round(data.progress.percent || 0));
        progressPct.textContent = `${pct}%`;
        progressBar.style.width = `${pct}%`;
        progressStatus.textContent = data.status === 'processing' ? 'Converting / Merging…' : 'Downloading…';
        const parts = [data.progress.size, data.progress.speed, data.progress.eta ? `ETA ${data.progress.eta}` : ''].filter(Boolean);
        progressMeta.textContent = parts.join(' • ');
      }

      if (data.status === 'done' && data.result) {
        clearInterval(pollTimer);
        pollTimer = null;
        progressPct.textContent = '100%';
        progressBar.style.width = '100%';
        progressStatus.textContent = `Ready: ${data.result.filename}`;
        progressMeta.textContent = `${(data.result.size / (1024 * 1024)).toFixed(2)} MB`;
        socialDownloadBtn.disabled = false;

        triggerDownload(data.result.downloadUrl, data.result.filename);
      } else if (data.status === 'error') {
        clearInterval(pollTimer);
        pollTimer = null;
        progressStatus.textContent = 'Error';
        setStatus(`Download failed: ${data.error}`, true);
        socialDownloadBtn.disabled = false;
      }
    } catch (err) {
      clearInterval(pollTimer);
      pollTimer = null;
      setStatus(`Polling error: ${err.message}`, true);
      socialDownloadBtn.disabled = false;
    }
  }, 600);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}
