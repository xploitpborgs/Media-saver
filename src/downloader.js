const fs = require('fs');
const id3 = require('./id3');
const ytdlp = require('./ytdlp');

function sanitizeFilename(name) {
  return (name || 'track')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .trim()
    .slice(0, 150) || 'track';
}

/**
 * Download a track as MP3 using yt-dlp search + ffmpeg, then embed ID3v2.3 tags & cover art.
 */
async function downloadTrack(track, outputDir, onProgress = null) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const trackTitle = track.title || 'Unknown Title';
  const trackArtist = track.artist || 'Unknown Artist';
  const displayName = `${trackArtist} - ${trackTitle}`;
  const query = `${trackArtist} - ${trackTitle} audio`;

  const result = await ytdlp.downloadAudioSearch(query, displayName, outputDir, (pct) => {
    if (onProgress) onProgress(pct, 100);
  });

  await id3.tagMp3File(result.filePath, {
    title: track.title,
    artist: track.artist,
    album: track.album || track.title,
    thumbnailUrl: track.thumbnail
  });

  return {
    ...result,
    track,
    displayName
  };
}

module.exports = {
  sanitizeFilename,
  downloadTrack
};
