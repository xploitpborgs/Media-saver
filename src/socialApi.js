/**
 * Direct media resolvers:
 * - Twitter/X: Public FxTwitter embed JSON API
 * - TikTok: Public TikWM API (watermark-free MP4 + MP3)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function httpRequest(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 6) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(url); } catch (_) { return reject(new Error('Invalid URL')); }

    const client = parsed.protocol === 'https:' ? https : http;
    const method = options.method || 'GET';
    const req = client.request(parsed, {
      method,
      headers: { 'User-Agent': UA, ...(options.headers || {}) }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        const nextMethod = (res.statusCode === 307 || res.statusCode === 308) ? method : 'GET';
        return resolve(httpRequest(next, {
          method: nextMethod,
          headers: options.headers,
          body: nextMethod === 'GET' ? undefined : options.body
        }, redirectCount + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, buffer, text, json });
      });
    });
    req.setTimeout(25000, () => req.destroy(new Error(`Request timed out: ${parsed.hostname}`)));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function downloadFile(url, destPath, extraHeaders = {}, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 6) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(url); } catch (_) { return reject(new Error('Invalid download URL')); }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, { headers: { 'User-Agent': UA, ...extraHeaders } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        return resolve(downloadFile(next, destPath, extraHeaders, onProgress, redirectCount + 1));
      }
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`Upstream returned HTTP ${res.statusCode}`));
      }

      const total = parseInt(res.headers['content-length'], 10) || 0;
      let received = 0;
      const out = fs.createWriteStream(destPath);

      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress && total > 0) {
          onProgress({
            status: 'downloading',
            percent: Math.round((received / total) * 100),
            size: `${(total / (1024 * 1024)).toFixed(2)}MiB`,
            speed: '',
            eta: ''
          });
        }
      });

      res.pipe(out);
      out.on('finish', () => {
        out.close(() => resolve({ filepath: destPath, size: received }));
      });
      out.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    req.setTimeout(45000, () => {
      fs.unlink(destPath, () => {});
      req.destroy(new Error('Download timed out'));
    });
    req.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Resolve Twitter/X video metadata via FxTwitter API
 */
async function resolveTwitterFx(tweetUrl) {
  const m = tweetUrl.match(/(?:twitter\.com|x\.com)\/([^/]+)\/status\/(\d+)/i);
  if (!m) throw new Error('Invalid Twitter/X status URL');
  const [, user, id] = m;

  const res = await httpRequest(`https://api.fxtwitter.com/${encodeURIComponent(user)}/status/${id}`, {
    headers: { 'User-Agent': 'MediaSaver/1.0' }
  });
  if (res.statusCode !== 200 || !res.json || !res.json.tweet) {
    throw new Error(`Tweet not found or unavailable (HTTP ${res.statusCode})`);
  }

  const tweet = res.json.tweet;
  const videos = tweet.media && tweet.media.videos ? tweet.media.videos : [];
  if (!videos.length) {
    throw new Error('No video found in this tweet');
  }

  const video = videos[0];
  return {
    title: (tweet.text || `Tweet ${id}`).replace(/https?:\/\/t\.co\/\S+/g, '').trim() || `Tweet ${id}`,
    uploader: `@${tweet.author?.screen_name || user}`,
    thumbnail: video.thumbnail_url || '',
    duration: video.duration || 0,
    videoUrl: video.url
  };
}

/**
 * Resolve TikTok video/audio via TikWM public API
 */
async function resolveTikTok(tiktokUrl) {
  const res = await httpRequest(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
  if (res.statusCode !== 200 || !res.json || res.json.code !== 0 || !res.json.data) {
    throw new Error(res.json?.msg || `TikTok resolver failed (HTTP ${res.statusCode})`);
  }
  const d = res.json.data;
  return {
    title: d.title || `TikTok ${d.id}`,
    uploader: d.author?.nickname || d.author?.unique_id || 'TikTok Creator',
    thumbnail: d.cover || d.origin_cover || '',
    duration: d.duration || 0,
    videoUrl: d.hdplay || d.play,
    audioUrl: d.music
  };
}

module.exports = {
  resolveTwitterFx,
  resolveTikTok,
  downloadFile
};
