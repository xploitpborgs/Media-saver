const http = require('http');
const fs = require('fs');
const path = require('path');
const api = require('./api');
const downloader = require('./downloader');
const { detectPlatform, getInfo, download, PLATFORMS, DOWNLOADS_DIR } = require('./ytdlp');

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3333;
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MAX_BODY_BYTES = 1024 * 1024;
const JOB_TTL_MS = 60 * 60 * 1000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const jobs = new Map();

function pruneOldJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff && (job.status === 'done' || job.status === 'error')) {
      jobs.delete(id);
    }
  }
}

function sendJson(res, statusCode, data) {
  if (res.headersSent) return;
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        return reject(new Error('Request body too large'));
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    // ── Spotify / Deezer Search & URL Resolution ────────────────────
    if (pathname === '/api/search' && req.method === 'GET') {
      const q = reqUrl.searchParams.get('q');
      if (!q || !q.trim()) return sendJson(res, 400, { error: 'Query parameter q is required' });
      const data = await api.search(q);
      return sendJson(res, 200, data);
    }

    // ── Spotify Track MP3 Conversion (with ID3 + Cover Art) ─────────
    if (pathname === '/api/convert' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.title) return sendJson(res, 400, { error: 'Track title is required' });

      const result = await downloader.downloadTrack(body, DOWNLOADS_DIR);
      return sendJson(res, 200, {
        success: true,
        filename: result.filename,
        size: result.bytes,
        downloadUrl: `/downloads/${encodeURIComponent(result.filename)}`
      });
    }

    // ── Social API: Extract metadata without downloading ────────────
    if (pathname === '/api/info' && req.method === 'GET') {
      const url = reqUrl.searchParams.get('url');
      if (!url) return sendJson(res, 400, { error: 'url parameter is required' });

      const platform = detectPlatform(url);
      const platformInfo = PLATFORMS[platform];

      try {
        const info = await getInfo(url);
        return sendJson(res, 200, {
          success: true,
          platform,
          platformInfo,
          title: info.title,
          uploader: info.uploader || info.channel || info.creator || '',
          thumbnail: info.thumbnail,
          duration: info.duration,
          webpage_url: info.webpage_url || url
        });
      } catch (err) {
        return sendJson(res, 422, { error: err.message, platform, platformInfo });
      }
    }

    // ── Social API: Start async download job ────────────────────────
    if (pathname === '/api/download' && req.method === 'POST') {
      pruneOldJobs();
      const body = await parseBody(req);
      const { url, format = 'audio', quality = '720' } = body;

      if (!url) return sendJson(res, 400, { error: 'url is required' });
      if (!['audio', 'video'].includes(format)) {
        return sendJson(res, 400, { error: 'format must be audio or video' });
      }

      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const job = {
        id: jobId,
        url,
        format,
        quality,
        platform: detectPlatform(url),
        status: 'starting',
        progress: { percent: 0, speed: '', eta: '' },
        result: null,
        error: null,
        createdAt: Date.now()
      };
      jobs.set(jobId, job);

      download(url, format, quality, (progress) => {
        job.status = progress.status || 'downloading';
        job.progress = progress;
      }).then(result => {
        job.status = 'done';
        job.result = result;
      }).catch(err => {
        job.status = 'error';
        job.error = err.message;
      });

      return sendJson(res, 202, { jobId, status: 'starting' });
    }

    // ── Social API: Poll job status ─────────────────────────────────
    if (pathname.startsWith('/api/status/') && req.method === 'GET') {
      const jobId = pathname.replace('/api/status/', '');
      const job = jobs.get(jobId);
      if (!job) return sendJson(res, 404, { error: 'Job not found' });

      const response = {
        jobId,
        status: job.status,
        platform: job.platform,
        progress: job.progress,
        error: job.error
      };

      if (job.status === 'done' && job.result) {
        response.result = {
          title: job.result.title,
          filename: job.result.filename,
          format: job.result.format,
          size: job.result.size,
          downloadUrl: `/downloads/${encodeURIComponent(job.result.filename)}`
        };
      }
      return sendJson(res, 200, response);
    }

    // ── Serve completed downloads ───────────────────────────────────
    if (pathname.startsWith('/downloads/') && req.method === 'GET') {
      const filename = decodeURIComponent(pathname.replace('/downloads/', ''));
      if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      const filePath = path.join(DOWNLOADS_DIR, filename);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404);
        return res.end('File not found');
      }
      const ext = path.extname(filename).toLowerCase();
      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store'
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    // ── Supported platforms ─────────────────────────────────────────
    if (pathname === '/api/platforms' && req.method === 'GET') {
      return sendJson(res, 200, PLATFORMS);
    }

    // ── Static files ────────────────────────────────────────────────
    const cleanRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_DIR, cleanRel);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      return fs.createReadStream(filePath).pipe(res);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

function startServer(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(port, () => {
    console.log(`
==================================================
   MediaSaver Web UI Running!
   Spotify • YouTube • Twitter/X • TikTok
   URL: http://localhost:${port}
   Theme: Luxury Burgundy (100% Ad-Free)
==================================================
    `);
  });
}

startServer(DEFAULT_PORT);
