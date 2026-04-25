const { app, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadURL("https://dark-messenger-production.up.railway.app");
}

app.whenReady().then(() => {
  createWindow();

  autoUpdater.autoDownload = true;
  autoUpdater.checkForUpdates();
});


// 🔥 ОБНОВЛЕНИЯ → отправка в UI

autoUpdater.on("update-available", () => {
  win.webContents.send("update_available");
});

autoUpdater.on("download-progress", (progress) => {
  win.webContents.send("update_progress", Math.round(progress.percent));
});

autoUpdater.on("update-downloaded", () => {
  win.webContents.send("update_downloaded");

  // автоустановка
  setTimeout(() => {
    autoUpdater.quitAndInstall();
  }, 2000);
});