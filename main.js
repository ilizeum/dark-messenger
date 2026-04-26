const { app, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Callibri",
    autoHideMenuBar: true,

    // Иконка приложения
    icon: path.join(__dirname, "assets", "icon.ico"),

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

// Чтобы приложение нормально открывалось на macOS
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Чтобы приложение закрывалось на Windows/Linux
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// 🔥 ОБНОВЛЕНИЯ → отправка в UI

autoUpdater.on("update-available", () => {
  if (win) {
    win.webContents.send("update_available");
  }
});

autoUpdater.on("download-progress", (progress) => {
  if (win) {
    win.webContents.send("update_progress", Math.round(progress.percent));
  }
});

autoUpdater.on("update-downloaded", () => {
  if (win) {
    win.webContents.send("update_downloaded");
  }

  // автоустановка
  setTimeout(() => {
    autoUpdater.quitAndInstall();
  }, 2000);
});