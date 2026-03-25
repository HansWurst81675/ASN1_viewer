const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('berApi', {
  // File ops
  openFileDialog:   ()             => ipcRenderer.invoke('open-file-dialog'),
  openFilePath:     (p)            => ipcRenderer.invoke('open-file-path', p),
  openFileBuffer:   (buf, name)    => ipcRenderer.invoke('open-file-buffer', buf, name),
  saveFileDialog:   (defaultPath)  => ipcRenderer.invoke('save-file-dialog', defaultPath),
  saveFile:         (p, buf)       => ipcRenderer.invoke('save-file', p, buf),
  exportTxt:        (p, txt)       => ipcRenderer.invoke('export-txt', p, txt),
  exportTxtFmt2:    (p, nodes)     => ipcRenderer.invoke('export-txt-fmt2', p, nodes),
  getSchemaInfo:    ()             => ipcRenderer.invoke('get-schema-info'),
  openExternal:     (url)          => shell.openExternal(url),
  fetchOsmTile:     (z, x, y)      => ipcRenderer.invoke('fetch-osm-tile', z, x, y),

  // Compare mode
  openFileDialogCompare: ()            => ipcRenderer.invoke('open-file-dialog-compare'),
  parseBerFile:          (p)           => ipcRenderer.invoke('parse-ber-file', p),
  parseBerBuffer:        (buf, name)   => ipcRenderer.invoke('parse-ber-buffer', buf, name),

  // Recent files
  getRecentFiles:   ()             => ipcRenderer.invoke('get-recent-files'),
  clearRecentFiles: ()             => ipcRenderer.invoke('clear-recent-files'),

  // Events from main
  onFileLoaded:     (cb) => ipcRenderer.on('file-loaded',    (_, d) => cb(d)),
  onFileError:      (cb) => ipcRenderer.on('file-error',     (_, m) => cb(m)),
  onExpandAll:      (cb) => ipcRenderer.on('expand-all',     ()     => cb()),
  onCollapseAll:    (cb) => ipcRenderer.on('collapse-all',   ()     => cb()),
  onSaveAs:         (cb) => ipcRenderer.on('save-as',        ()     => cb()),
  onExportTxt:      (cb) => ipcRenderer.on('export-txt-cmd', ()     => cb()),
  onRecentFilesUpdated: (cb) => ipcRenderer.on('recent-files-updated', (_, r) => cb(r)),
  onOpenRecent:         (cb) => ipcRenderer.on('open-recent', (_, p) => cb(p)),
});
