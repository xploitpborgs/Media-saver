#!/usr/bin/env node

const path = require('path');
const readline = require('readline');
const api = require('./api');
const downloader = require('./downloader');
const ytdlp = require('./ytdlp');

const DEFAULT_DOWNLOAD_DIR = path.resolve(__dirname, '..', 'downloads');

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function main() {
  console.log(`
==================================================
   MEDIASAVER CLI (Ad-Free & Unlimited)
   Spotify • YouTube • Twitter/X • TikTok
==================================================
  `);

  let query = process.argv.slice(2).join(' ');
  if (!query) {
    query = await prompt('Enter Spotify / YouTube / Twitter / TikTok URL or search keywords:\n> ');
  }

  if (!query) {
    console.log('No input provided. Exiting.');
    return;
  }

  // Handle non-Spotify social/video URLs via ytdlp/socialApi
  if (/^https?:\/\//i.test(query) && !/spotify\.com|spotify\.link/i.test(query)) {
    const platform = ytdlp.detectPlatform(query);
    console.log(`\n[*] Detected platform: ${platform.toUpperCase()}`);
    const fmt = (await prompt('Format — [1] MP3 Audio  [2] MP4 Video (default: 1): > ')) === '2' ? 'video' : 'audio';
    const quality = fmt === 'video' ? (await prompt('Max height [1080/720/480/360] (default: 720): > ')) || '720' : '0';
    console.log(`\n[*] Downloading to:\n    ${DEFAULT_DOWNLOAD_DIR}\n`);
    try {
      const res = await ytdlp.download(query, fmt, quality, (p) => {
        process.stdout.write(`\r[*] ${p.status || 'downloading'}: ${Math.round(p.percent || 0)}% ${p.speed || ''}`);
      });
      process.stdout.write('\r' + ' '.repeat(70) + '\r');
      console.log(`[DONE] Saved: ${res.filename} (${formatBytes(res.size)})`);
    } catch (err) {
      console.error(`\n[!] Error: ${err.message}`);
    }
    return;
  }

  console.log(`\n[*] Resolving metadata for: "${query}"...`);
  try {
    const data = await api.search(query);
    const type = data.type || 'search';
    const items = data.items || [];

    if (items.length === 0) {
      console.log('[-] No tracks found for this query.');
      return;
    }

    console.log(`[+] Found ${items.length} track(s) (Type: ${type.toUpperCase()}).`);
    if (data.meta) {
      console.log(`    Collection: "${data.meta.title}" by ${data.meta.artist || 'Various'}`);
    }

    let selectedTracks = [];

    if (type === 'track' || items.length === 1) {
      selectedTracks = [items[0]];
    } else if (type === 'album' || type === 'playlist') {
      console.log(`\nOptions:`);
      console.log(`  [1] Download ALL ${items.length} tracks`);
      console.log(`  [2] Select specific track number(s)`);
      const choice = await prompt('\nSelect option (default: 1): > ');
      if (choice === '2') {
        items.forEach((item, idx) => {
          console.log(`  [${idx + 1}] ${item.artist} - ${item.title} (${item.duration}s)`);
        });
        const trackNums = await prompt('\nEnter track numbers separated by commas (e.g. 1, 3, 5): > ');
        const indices = trackNums.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(i => i >= 0 && i < items.length);
        selectedTracks = indices.map(i => items[i]);
      } else {
        selectedTracks = items;
      }
    } else {
      // Search list
      console.log('\nTop Search Results:');
      items.slice(0, 10).forEach((item, idx) => {
        console.log(`  [${idx + 1}] ${item.artist} - ${item.title} (${item.duration}s)`);
      });
      const choice = await prompt('\nSelect track number to download (1-10, default: 1): > ');
      const idx = (parseInt(choice, 10) || 1) - 1;
      selectedTracks = [items[Math.max(0, Math.min(items.length - 1, idx))]];
    }

    console.log(`\n[*] Preparing to download ${selectedTracks.length} track(s) to:\n    ${DEFAULT_DOWNLOAD_DIR}\n`);

    for (let i = 0; i < selectedTracks.length; i++) {
      const track = selectedTracks[i];
      const count = `[${i + 1}/${selectedTracks.length}]`;
      console.log(`${count} Matching: ${track.artist} - ${track.title}...`);

      try {
        const result = await downloader.downloadTrack(track, DEFAULT_DOWNLOAD_DIR, (downloaded, total) => {
          const percent = total > 0 ? ` (${Math.round((downloaded / total) * 100)}%)` : '';
          process.stdout.write(`\r${count} Downloading: ${formatBytes(downloaded)}${percent}...`);
        });
        process.stdout.write('\r' + ' '.repeat(70) + '\r');
        console.log(`${count} [DONE] Saved: ${path.basename(result.filePath)} (${formatBytes(result.bytes)})\n`);
      } catch (err) {
        console.log(`\n${count} [ERROR] Failed to download: ${err.message}\n`);
      }
    }

    console.log('[*] All tasks finished! Check your downloads folder.');
  } catch (err) {
    console.error(`\n[!] Error: ${err.message}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = main;

