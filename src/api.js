/**
 * Original Music Metadata Client
 * - Resolves Spotify Track, Album & Playlist links via Spotify's public embed page
 * - Resolves keyword track searches & 30s previews via Deezer's public catalog API
 */

const https = require('https');
const http = require('http');

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9'
};

function request(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 6) {
      return reject(new Error('Too many redirects'));
    }

    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const method = options.method || 'GET';

    const req = client.request(parsedUrl, {
      method,
      headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) }
    }, (res) => {
      if (options.followRedirects !== false && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).href;
        res.resume();
        return resolve(request(nextUrl, options, redirectCount + 1));
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (_) {}

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          finalUrl: url,
          buffer,
          text,
          json
        });
      });
    });

    req.setTimeout(20000, () => {
      req.destroy(new Error(`Request timed out: ${parsedUrl.hostname}`));
    });
    req.on('error', reject);

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

function pickThumbnail(entity) {
  const imgs = entity?.visualIdentity?.image;
  if (Array.isArray(imgs) && imgs.length > 0) {
    const sorted = [...imgs].sort((a, b) => (b.maxWidth || 0) - (a.maxWidth || 0));
    return sorted[0].url || '';
  }
  return entity?.coverArt?.sources?.url || '';
}

function parseSpotifyUrl(rawUrl) {
  const m = rawUrl.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?(track|album|playlist)\/([A-Za-z0-9]+)/i);
  if (!m) return null;
  return { kind: m[1].toLowerCase(), id: m[2] };
}

/**
 * Fetch track, album, or playlist metadata from Spotify Embed JSON
 */
async function resolveSpotifyUrl(url) {
  let targetUrl = url.trim();

  // Resolve short spotify.link redirects if provided
  if (/^https?:\/\/spotify\.link\//i.test(targetUrl)) {
    const resolved = await request(targetUrl, { followRedirects: true });
    targetUrl = resolved.finalUrl || targetUrl;
  }

  const parsed = parseSpotifyUrl(targetUrl);
  if (!parsed) {
    throw new Error('Unsupported Spotify URL. Provide a track, album, or playlist link.');
  }

  const embedUrl = `https://open.spotify.com/embed/${parsed.kind}/${parsed.id}`;
  const res = await request(embedUrl);
  if (res.statusCode !== 200) {
    throw new Error(`Spotify returned HTTP ${res.statusCode}`);
  }

  const nextMatch = res.text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!nextMatch) {
    throw new Error('Could not read metadata from Spotify');
  }

  const nextData = JSON.parse(nextMatch[1]);
  const entity = nextData?.props?.pageProps?.state?.data?.entity;
  if (!entity) {
    throw new Error('Spotify item not found or private');
  }

  const coverUrl = pickThumbnail(entity);

  if (parsed.kind === 'track' || entity.type === 'track') {
    const artist = Array.isArray(entity.artists)
      ? entity.artists.map(a => a.name).filter(Boolean).join(', ')
      : (entity.subtitle || 'Unknown Artist');
    const title = entity.title || entity.name || 'Unknown Track';

    return {
      type: 'track',
      items: [{
        title,
        artist,
        album: title,
        duration: Math.round((entity.duration || 0) / 1000),
        thumbnail: coverUrl,
        previewUrl: entity.audioPreview?.url || null
      }]
    };
  }

  const collectionTitle = entity.title || entity.name || 'Collection';
  const collectionArtist = entity.subtitle || 'Various Artists';
  const trackList = Array.isArray(entity.trackList) ? entity.trackList : [];

  const items = trackList.map(t => ({
    title: t.title || 'Unknown Track',
    artist: (t.subtitle || collectionArtist).replace(/\u00a0/g, ' '),
    album: parsed.kind === 'album' ? collectionTitle : (t.title || collectionTitle),
    duration: Math.round((t.duration || 0) / 1000),
    thumbnail: coverUrl,
    previewUrl: t.audioPreview?.url || null
  }));

  return {
    type: parsed.kind,
    meta: {
      title: collectionTitle,
      artist: collectionArtist,
      thumbnail: coverUrl
    },
    items
  };
}

/**
 * Search tracks by keywords via Deezer public API
 */
async function searchDeezer(query) {
  const res = await request(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=20`);
  if (res.statusCode !== 200 || !res.json) {
    throw new Error(`Catalog search failed (HTTP ${res.statusCode})`);
  }
  if (res.json.error) {
    throw new Error(res.json.error.message || 'Catalog search error');
  }

  const items = (res.json.data || []).map(t => ({
    title: t.title,
    artist: t.artist?.name || 'Unknown Artist',
    album: t.album?.title || t.title,
    duration: t.duration || 0,
    thumbnail: t.album?.cover_big || t.album?.cover_medium || t.album?.cover || '',
    previewUrl: t.preview || null
  }));

  return { type: 'search', items };
}

/**
 * Search by keywords or resolve a Spotify Track, Album, or Playlist URL
 */
async function search(query) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('Search query is required');
  }

  const cleanQuery = query.trim();
  if (/^https?:\/\/(open\.spotify\.com|spotify\.link)\//i.test(cleanQuery)) {
    return resolveSpotifyUrl(cleanQuery);
  }
  return searchDeezer(cleanQuery);
}

module.exports = {
  DEFAULT_HEADERS,
  request,
  search,
  resolveSpotifyUrl,
  searchDeezer
};
