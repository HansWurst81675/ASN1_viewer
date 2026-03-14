const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('berApi', {
  openFileDialog: ()         => ipcRenderer.invoke('open-file-dialog'),
  openFilePath:   (p)        => ipcRenderer.invoke('open-file-path', p),
  getSchemaInfo:  ()         => ipcRenderer.invoke('get-schema-info'),

  onFileLoaded:   (cb) => ipcRenderer.on('file-loaded',   (_, d) => cb(d)),
  onFileError:    (cb) => ipcRenderer.on('file-error',    (_, m) => cb(m)),
  onExpandAll:    (cb) => ipcRenderer.on('expand-all',    ()     => cb()),
  onCollapseAll:  (cb) => ipcRenderer.on('collapse-all',  ()     => cb()),
});
