/**
 * Multi-platform media engine (YouTube, Twitter/X, TikTok + yt-dlp supported sites)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const socialApi = require('./socialApi');

const YTDLP = 'yt-dlp';
const DOWNLOADS_DIR = path.resolve(__dirname, '..', 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

function detectPlatform(rawUrl) {
  let host = '';
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\.|^m\./, '');
  } catch (_) {
    return 'generic';
  }

  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube';
  if (host === 'twitter.com' || host.endsWith('.twitter.com') || host === 'x.com') return 'twitter';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch') return 'facebook';
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) return 'vimeo';
  if (host === 'twitch.tv' || host.endsWith('.twitch.tv')) return 'twitch';
  if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') return 'reddit';
  if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) return 'soundcloud';
  return 'generic';
}

function sanitizeFilename(name) {
  return (name || '')
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 180) || 'media';
}

function extractYtdlpError(stderr) {
  const lines = stderr.split('\n').filter(l => l.includes('ERROR:'));
  if (!lines.length) return null;
  return lines[0].replace(/^ERROR:\s*\[[^\]]+\]\s*[^:]*:\s*/, '').trim();
}

function getInfoYtdlp(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-single-json',
      '--no-download',
      '--no-playlist',
      '--add-headers', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      url
    ];

    let stdout = '';
    let stderr = '';
    const proc = spawn(YTDLP, args, { windowsHide: true });

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      if (!stdout.trim()) {
        return reject(new Error(extractYtdlpError(stderr) || `yt-dlp exited with code ${code}`));
      }
      try {
        const firstLine = stdout.trim().split('\n')[0];
        resolve(JSON.parse(firstLine));
      } catch (e) {
        reject(new Error('Failed to parse media metadata: ' + e.message));
      }
    });

    proc.on('error', err => reject(new Error('yt-dlp not found: ' + err.message)));
  });
}

async function getInfo(url) {
  const platform = detectPlatform(url);

  if (platform === 'tiktok') {
    const info = await socialApi.resolveTikTok(url);
    return {
      title: info.title,
      uploader: info.uploader,
      thumbnail: info.thumbnail,
      duration: info.duration,
      webpage_url: url,
      formats: []
    };
  }

  if (platform === 'twitter') {
    try {
      const info = await socialApi.resolveTwitterFx(url);
      return {
        title: info.title,
        uploader: info.uploader,
        thumbnail: info.thumbnail,
        duration: info.duration,
        webpage_url: url,
        formats: []
      };
    } catch (_) {
      // Fall through to yt-dlp
    }
  }

  return getInfoYtdlp(url);
}

async function download(url, format = 'audio', quality = '720', onProgress) {
  const platform = detectPlatform(url);
  const isAudio = format === 'audio';

  if (platform === 'tiktok') {
    const info = await socialApi.resolveTikTok(url);
    const mediaUrl = isAudio && info.audioUrl ? info.audioUrl : info.videoUrl;
    if (!mediaUrl) throw new Error('TikTok resolver returned no media URL');
    const ext = isAudio && info.audioUrl ? 'mp3' : 'mp4';
    const safeTitle = sanitizeFilename(`${info.uploader} - ${info.title}`);
    const filename = `${safeTitle}.${ext}`;
    const filepath = path.join(DOWNLOADS_DIR, filename);
    const { size } = await socialApi.downloadFile(mediaUrl, filepath, {}, onProgress);
    return { title: info.title, filename, filepath, platform, format: ext, size };
  }

  if (platform === 'twitter' && !isAudio) {
    try {
      const resolved = await socialApi.resolveTwitterFx(url);
      const safeTitle = sanitizeFilename(`${resolved.uploader} - ${resolved.title}`);
      const filename = `${safeTitle}.mp4`;
      const filepath = path.join(DOWNLOADS_DIR, filename);
      const { size } = await socialApi.downloadFile(resolved.videoUrl, filepath, {}, onProgress);
      return { title: resolved.title, filename, filepath, platform, format: 'mp4', size };
    } catch (_) {
      // Fall through to yt-dlp
    }
  }

  return downloadYtdlp(url, format, quality, onProgress);
}

/**
 * Search YouTube by track query ("ytsearch1:Artist - Title") and save as MP3
 */
function downloadAudioSearch(searchQuery, safeBaseName, outputDir = DOWNLOADS_DIR, onProgress) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const targetName = `${sanitizeFilename(safeBaseName)}.mp3`;
    const targetPath = path.join(outputDir, targetName);
    const tmpName = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const outTemplate = path.join(outputDir, `${tmpName}.%(ext)s`);

    const args = [
      '--no-playlist',
      '--format', 'bestaudio[ext=m4a]/bestaudio/best',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--newline',
      '-o', outTemplate,
      `ytsearch1:${searchQuery}`
    ];

    let stderr = '';
    const proc = spawn(YTDLP, args, { windowsHide: true });

    proc.stdout.on('data', data => {
      if (!onProgress) return;
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/\[download\]\s+([\d.]+)%/);
        if (m) onProgress(parseFloat(m[1]));
      }
    });

    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      const produced = path.join(outputDir, `${tmpName}.mp3`);
      if (!fs.existsSync(produced)) {
        return reject(new Error(extractYtdlpError(stderr) || `Audio conversion failed (exit ${code})`));
      }

      try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        fs.renameSync(produced, targetPath);
      } catch (_) {}

      const finalPath = fs.existsSync(targetPath) ? targetPath : produced;
      resolve({
        filePath: finalPath,
        filename: path.basename(finalPath),
        bytes: fs.statSync(finalPath).size
      });
    });

    proc.on('error', err => reject(new Error('yt-dlp binary not found in PATH: ' + err.message)));
  });
}

function downloadYtdlp(url, format = 'audio', quality = '720', onProgress) {
  return new Promise((resolve, reject) => {
    const platform = detectPlatform(url);
    const isAudio = format === 'audio';

    const tmpName = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const outTemplate = path.join(DOWNLOADS_DIR, `${tmpName}.%(ext)s`);

    const args = [
      '--no-playlist',
      '--no-simulate',
      '--print', 'before_dl:__META__:%(uploader)s\t%(title)s',
      '--add-headers', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      '--newline',
      '-o', outTemplate,
    ];

    if (isAudio) {
      args.push(
        '--format', 'bestaudio[ext=m4a]/bestaudio/best',
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0'
      );
    } else {
      const height = parseInt(quality, 10) || 720;
      args.push(
        '--format', `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}][ext=mp4]/best[height<=${height}]/best`,
        '--merge-output-format', 'mp4'
      );
    }

    args.push(url);

    let stderr = '';
    let resolvedPath = null;
    let parsedUploader = '';
    let parsedTitle = '';

    const proc = spawn(YTDLP, args, { windowsHide: true });

    proc.stdout.on('data', data => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith('__META__:')) {
          const [uploader, title] = line.slice(9).split('\t');
          parsedUploader = uploader && uploader !== 'NA' ? uploader : '';
          parsedTitle = title && title !== 'NA' ? title : '';
          continue;
        }

        const progressMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+(\S+)/);
        if (progressMatch && onProgress) {
          onProgress({
            status: 'downloading',
            percent: parseFloat(progressMatch[1]),
            size: progressMatch[2],
            speed: progressMatch[3],
            eta: progressMatch[4]
          });
        }

        const destMatch = line.match(/\[(?:download|ExtractAudio|Merger)\]\s+(?:Destination|Merging formats into):\s+"?(.+?)"?$/);
        if (destMatch) resolvedPath = destMatch[1].trim();
      }
    });

    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (onProgress) onProgress({ status: 'processing', percent: 100 });

      let finalPath = null;
      if (resolvedPath && fs.existsSync(resolvedPath)) {
        finalPath = resolvedPath;
      } else {
        const files = fs.readdirSync(DOWNLOADS_DIR)
          .filter(f => f.startsWith(tmpName) && !f.endsWith('.part'))
          .map(f => path.join(DOWNLOADS_DIR, f));
        if (files.length) finalPath = files[0];
      }

      if (!finalPath || !fs.existsSync(finalPath)) {
        return reject(new Error(extractYtdlpError(stderr) || `Download failed (exit ${code})`));
      }

      const ext = path.extname(finalPath);
      const rawName = parsedUploader && parsedTitle
        ? `${parsedUploader} - ${parsedTitle}`
        : (parsedTitle || path.basename(finalPath, ext));
      const cleanTitle = sanitizeFilename(rawName);
      const newPath = path.join(DOWNLOADS_DIR, `${cleanTitle}${ext}`);

      try {
        if (finalPath !== newPath) {
          if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
          fs.renameSync(finalPath, newPath);
        }
      } catch (_) {}

      const outputPath = fs.existsSync(newPath) ? newPath : finalPath;

      resolve({
        title: parsedTitle || cleanTitle,
        filename: path.basename(outputPath),
        filepath: outputPath,
        platform,
        format: ext.replace(/^\./, '') || (isAudio ? 'mp3' : 'mp4'),
        size: fs.statSync(outputPath).size
      });
    });

    proc.on('error', err => reject(new Error('yt-dlp binary not found in PATH: ' + err.message)));
  });
}

const PLATFORMS = {
  youtube:    { name: 'YouTube',    audioOk: true,  videoOk: true },
  twitter:    { name: 'Twitter/X',  audioOk: true,  videoOk: true },
  tiktok:     { name: 'TikTok',     audioOk: true,  videoOk: true },
  facebook:   { name: 'Facebook',   audioOk: false, videoOk: true },
  vimeo:      { name: 'Vimeo',      audioOk: true,  videoOk: true },
  twitch:     { name: 'Twitch',     audioOk: false, videoOk: true },
  reddit:     { name: 'Reddit',     audioOk: false, videoOk: true },
  soundcloud: { name: 'SoundCloud', audioOk: true,  videoOk: false },
  generic:    { name: 'Web',        audioOk: true,  videoOk: true }
};

module.exports = { detectPlatform, getInfo, download, downloadAudioSearch, sanitizeFilename, PLATFORMS, DOWNLOADS_DIR };
