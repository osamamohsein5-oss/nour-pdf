const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nour", {
  openPdf: () => ipcRenderer.invoke("pdf:choose"),
  onPdfOpen: (callback) => {
    const listener = (_event, document) => callback(document);
    ipcRenderer.on("pdf:open", listener);
    return () => ipcRenderer.removeListener("pdf:open", listener);
  },
});

