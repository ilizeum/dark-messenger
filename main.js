const { app, BrowserWindow } = require("electron");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0b0f19",
  });

win.setMenu(null); 
win.loadURL("https://30gzwl-2a02-2168-a966-7700-6c89-e7d6-1dcb-463a.ru.tuna.am");
}

app.whenReady().then(createWindow);