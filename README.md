<p align="center">
  <img src="docs/icon.png" width="96" alt="">
</p>

<h1 align="center">Ma3madan Video Presenter</h1>

<p align="center">
  A two-screen video player for services, meetings, classes and events.<br>
  The controls stay on your laptop and the projector shows only the video, like PowerPoint's Presenter View.
</p>

<p align="center">
  <a href="https://github.com/michaelsaad/ma3madan-video-presenter/releases/latest"><b>⬇ Download for Windows</b></a>
</p>

![Screenshot](docs/screenshot.png)

## Why this app?

Showing a video to an audience usually looks like this:

- You download the YouTube video first, or play it straight from YouTube in a browser.
- The audience sees everything on your screen: the pause icon, the progress bar, the mouse cursor, YouTube's title bar, suggested videos at the end, sometimes ads.
- To pause, skip or change the volume, you have to click on the same screen everyone is watching.

Ma3madan Video Presenter keeps those two things apart. The projector only ever shows the video (or a clean black screen). Every control stays on your laptop, together with a live preview of exactly what the audience sees. You can pause, seek, fix the volume or get the next video ready, and none of it shows up on the big screen. The result is a smooth, professional flow from one video to the next.

It plays your own video files, and YouTube links either streamed directly or downloaded first. In both cases YouTube's page, ads and suggestions never reach the projector.

*Ma3madan* (المعمدان) means "the Baptist". The app was originally made for **St. John the Baptist Church in Qalyub, Al-Qalyubia, Egypt**. It's free for anyone to use, for anything.

## Features

- **Two screens.** The projector shows a clean, full-screen video: no controls, no mouse cursor, no pop-ups. Your laptop shows the controls and a live preview of the projector.
- **Local files.** MP4, MKV, WebM, MOV, plus MP3, M4A and WAV audio. Drag files in or use **Add videos**.
- **YouTube.**
  - **Stream** plays a link right away without downloading it. Quality drops automatically when the internet is slow, like on YouTube.
  - **Download** saves the video to your PC (up to 1080p) so it plays offline.
- **Black screen** (`B`) fades the projector to black at any moment.
- **Volume up to 200%**, like VLC, for quiet videos in a big hall.
- **Aspect ratio** (`A`): 16:9, 4:3, 2.35:1, stretch, zoom and more.
- **Playlist** that's saved between sessions, with auto-play next, loop, speed control and black-at-end.
- **Audio output picker** to send the sound to the projector's HDMI or to the hall's speakers.
- **English and Arabic** interface (Arabic is right-to-left).
- **Opens videos from Explorer** and can be set as the default video player.

## Install

1. Download **`Ma3madan-Video-Presenter-Setup-x.y.z.exe`** from the [latest release](https://github.com/michaelsaad/ma3madan-video-presenter/releases/latest).
2. Run it. Windows SmartScreen may warn you because the app isn't code-signed. Click **More info** → **Run anyway**.
3. Pick where to install it. No admin rights are needed. You'll get a desktop shortcut and a Start-menu entry.

Prefer not to install? Download **`Ma3madan-Video-Presenter-Portable-x.y.z.exe`** and run it from anywhere, even a USB stick. The portable version can't register itself as a video player.

Requirements: Windows 10 or 11 (64-bit). yt-dlp and FFmpeg are bundled, so there's nothing else to install.

## Using it with a projector

1. Connect the projector and press **`Win + P`**, then choose **Extend**. Don't choose Duplicate.
2. Open the app. It puts the video window on the second screen by itself. If you have more than one extra screen, pick the right one under **Output screen**.
3. Optional: under **Audio output**, choose where the sound should come out (for example the projector's HDMI).
4. Double-click a video in the playlist to play it on the projector.

With only one screen (for example, rehearsing on a laptop), the output opens as a small window in the corner. **Fullscreen** makes it fill the screen.

## YouTube: Stream or Download?

| | Stream | Download |
|---|---|---|
| Starts | in a few seconds | after the download finishes |
| Needs internet while playing | yes | no |
| Quality | adapts to your connection (starts at 720p) | up to 1080p |
| Best for | a good, steady connection | anything important, or weak Wi-Fi |

Downloads are saved to `Videos\Ma3madan Video Presenter`.

You can change a stream's quality from the **Quality** menu while it plays. **Auto** lowers it on its own when the connection can't keep up.

If YouTube links stop working one day, click **Update yt-dlp**. YouTube changes things from time to time and yt-dlp keeps up with them. Live streams aren't supported.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` / `K` | Play / pause |
| `←` `→` | Back / forward 5 s (`Shift` = 30 s) |
| `J` `L` | Back / forward 10 s |
| `↑` `↓` | Volume (up to 200%) |
| `M` | Mute |
| `B` | Black screen |
| `N` / `P` | Next / previous video |
| `A` | Cycle aspect ratio |
| `0`–`9` | Jump to 0%–90% |
| `Home` / `End` | Start / end |
| `Enter` | Play the selected video |
| `Shift` + `↑` `↓` | Move the playlist selection |
| `Delete` | Remove the selected video from the list |
| `F` | Output full-screen (single-screen mode) |
| `Ctrl + O` | Add videos |

Shortcuts also work while the projector window has focus.

## Make it your default video player

After installing, either:

- **Settings → Apps → Default apps → Ma3madan Video Presenter**, then choose it for `.mp4`, `.mkv` and the other types, or
- right-click a video → **Open with → Choose another app** → **Ma3madan Video Presenter**, and tick **Always**.

Windows doesn't let apps make themselves the default; you have to choose it once yourself.

## Build from source

You'll need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/michaelsaad/ma3madan-video-presenter.git
cd ma3madan-video-presenter
npm install
npm run fetch-tools   # downloads yt-dlp.exe into bin/
npm start             # run the app
npm run dist          # build the installer and the portable .exe into dist/
```

Other scripts:

- `npm test` runs an end-to-end self-test. It plays sample clips, checks controls, volume boost and aspect ratio, and saves screenshots. Set `VP_STREAM=<youtube url>` to also test streaming, including a simulated slow connection, or `VP_YT=<url>` to test downloading.
- `npm run icon` re-renders the app icon from `build/icon.svg`.

### How it works

| File | Role |
|---|---|
| `src/main.js` | Electron main process: windows, screens, settings, playlist, IPC |
| `src/control.html` · `control.js` · `control.css` | The operator window |
| `src/output.html` | The projector window: playback, Web Audio volume boost, aspect ratio, stream buffering and automatic quality |
| `src/youtube.js` | yt-dlp: downloads, and resolving stream formats into a quality ladder |
| `src/stream-proxy.js` | Local proxy that fetches YouTube streams in chunks, so they aren't throttled to playback speed |
| `src/i18n.js` | English and Arabic strings |
| `build/installer.nsh` | Registers the app under Windows Default apps |

The preview in the control window is a live capture of the projector window, so it always shows exactly what the audience sees.

## Third-party software

The Windows builds include:

- [Electron](https://www.electronjs.org/) (MIT)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense)
- [FFmpeg](https://ffmpeg.org/) (GPL), via [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static). The source code is available from ffmpeg.org.

Only use YouTube content you have the right to show, and follow YouTube's Terms of Service.

## License

Free to use for any person or organization, for any purpose: use it, copy it, change it and share it ([MIT License](LICENSE)).

The app is provided as is, without warranty of any kind, and may contain bugs. Please try it before relying on it at an important event. If you find a problem, [open an issue](https://github.com/michaelsaad/ma3madan-video-presenter/issues).

---

<p align="center">Developed by Michael Saad · © 2026</p>
