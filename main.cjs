const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 850,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: "#10131a",
    title: "Nour PDF",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

async function openPdf() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "افتح ملف PDF",
    properties: ["openFile"],
    filters: [{ name: "ملفات PDF", extensions: ["pdf"] }],
  });
  if (result.canceled || !result.filePaths[0]) return;
  try {
    const filePath = result.filePaths[0];
    const bytes = await fs.readFile(filePath);
    mainWindow?.webContents.send("pdf:open", {
      name: path.basename(filePath),
      bytes: new Uint8Array(bytes),
    });
  } catch {
    dialog.showErrorBox("تعذر فتح الملف", "لم يتمكن نور PDF من قراءة هذا الملف.");
  }
}

function installMenu() {
  const template = [
    { label: "ملف", submenu: [
      { label: "فتح ملف PDF…", accelerator: "CmdOrCtrl+O", click: openPdf },
      { type: "separator" },
      { role: "quit", label: "خروج" },
    ] },
    { label: "عرض", submenu: [
      { role: "reload", label: "إعادة التحميل" },
      { type: "separator" },
      { role: "togglefullscreen", label: "ملء الشاشة" },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  installMenu();
  ipcMain.handle("pdf:choose", openPdf);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

