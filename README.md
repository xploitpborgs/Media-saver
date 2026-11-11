# MediaSaver — Ad-Free Multi-Platform Media Downloader

A clean, self-contained Web UI and CLI downloader supporting **Spotify** (Tracks, Playlists, Albums & Search), **YouTube**, **Twitter / X**, and **TikTok**.

## Features

- **4 Platform Tabs + Smart URL Auto-Detection**: Paste any Spotify, YouTube, Twitter/X, or TikTok link and MediaSaver detects the platform automatically.
- **Spotify Track, Playlist & Album Support**: Fetches tracklists, 30-second audio previews, album artwork, and batch downloads with automatic ID3v2.3 metadata + cover art embedding.
- **Video & Audio Formats**: Download MP3 audio or MP4 video (`1080p`, `720p`, `480p`, `360p`) with real-time progress tracking.
- **Zero npm Dependencies**: Built on native Node.js (`http`, `https`, `fs`, `child_process`, `readline`) with `yt-dlp` and `ffmpeg`.
- **100% Ad-Free**: No popups, no redirects, no artificial limits.

---

## Requirements

- **Node.js** `>= 18.0.0`
- **yt-dlp** available in `PATH`
- **ffmpeg** available in `PATH` (for MP3 conversion and HD MP4 merging)

---

## Quick Start

### 1. Run the Web UI
```bash
npm run dev
```
Open [http://localhost:3333](http://localhost:3333) in your browser.

### 2. Run the Interactive CLI
```bash
npm run cli
```
Or pass a URL or search query directly:
```bash
node src/cli.js "Adele Hello"
node src/cli.js "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"
node src/cli.js "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

All downloaded files are saved to `downloads/`.

---

## Deploy Online (Docker: Railway / Render / Fly.io)

Vercel Serverless Functions do not include `yt-dlp` or `ffmpeg` binaries. Use the included [Dockerfile](Dockerfile) to host all 4 platforms cleanly:

- **Render:** Create a new **Blueprint** or **Web Service** from this GitHub repo — [render.yaml](render.yaml) auto-configures the Docker build and `/api/platforms` health check.
- **Railway:** Create a **New Project → Deploy from GitHub Repo** — Railway automatically builds `Dockerfile` with `node`, `yt-dlp`, and `ffmpeg`.
- **Fly.io:** Run `fly launch` in the project directory (uses `Dockerfile` automatically on port `3333`).
- **Local Docker:**
  ```bash
  docker build -t mediasaver .
  docker run -p 3333:3333 mediasaver
  ```

---

## Project Structure

```
mediasaver/
├── package.json
├── README.md
├── bin/
│   └── mediasaver          # CLI entry point
├── src/
│   ├── api.js              # Spotify Embed & Deezer catalog metadata client
│   ├── downloader.js       # MP3 downloader + ID3v2.3 & cover art tagger
│   ├── id3.js              # Zero-dependency ID3v2.3 binary tag writer
│   ├── socialApi.js        # Twitter/X (FxTwitter) & TikTok (TikWM) resolvers
│   ├── ytdlp.js            # Multi-platform download & conversion engine
│   ├── cli.js              # Interactive terminal client
│   └── server.js           # Native HTTP server & static UI host
├── public/
│   ├── index.html          # Main Web UI
│   ├── app.js              # Client logic, preview player & job polling
│   └── style.css           # Luxury burgundy dark theme
└── downloads/              # Output folder for saved MP3/MP4 files
```

---

## License

MIT
