const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, fn) => ipcRenderer.on(channel, (_e, data) => fn(data));

contextBridge.exposeInMainWorld('api', {
  // relay
  sendCmd: cmd => ipcRenderer.send('cmd', cmd),
  onCmd: fn => on('cmd', fn),
  sendState: s => ipcRenderer.send('state', s),
  onState: fn => on('state', fn),
  sendOutputKey: k => ipcRenderer.send('output-key', k),
  onOutputKey: fn => on('output-key', fn),
  onOutputReady: fn => on('output-ready', fn),
  outputIsReady: () => ipcRenderer.invoke('output-is-ready'),
  takeOpenFiles: () => ipcRenderer.invoke('take-open-files'),
  onOpenFiles: fn => on('open-files', fn),
  outputSourceId: () => ipcRenderer.invoke('output-source-id'),

  // displays
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  onDisplays: fn => on('displays', fn),
  setOutputDisplay: id => ipcRenderer.send('set-output-display', id),
  toggleOutputFullscreen: () => ipcRenderer.send('toggle-output-fullscreen'),

  // settings + playlist
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (k, v) => ipcRenderer.send('set-setting', k, v),
  loadPlaylist: () => ipcRenderer.invoke('playlist-load'),
  savePlaylist: items => ipcRenderer.send('playlist-save', items),
  fileUrl: p => ipcRenderer.invoke('file-url', p),
  pickFiles: title => ipcRenderer.invoke('pick-files', title),
  pathForFile: f => webUtils.getPathForFile(f),
  openVideosFolder: () => ipcRenderer.send('open-videos-folder'),
  showInFolder: p => ipcRenderer.send('show-in-folder', p),

  // youtube
  downloadStart: (id, url) => ipcRenderer.send('download-start', { id, url }),
  downloadCancel: id => ipcRenderer.send('download-cancel', id),
  onDownload: fn => on('download', fn),
  updateYtdlp: () => ipcRenderer.invoke('ytdlp-update'),
  onYtdlpSetup: fn => on('ytdlp-setup', fn),
  resolveStream: (url, force) => ipcRenderer.invoke('stream-resolve', url, force),
  openExternal: url => ipcRenderer.send('open-external', url),
});
