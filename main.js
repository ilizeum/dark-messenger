const { app, BrowserWindow } = require("electron");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0b0f19",
  });

win.setMenu(null); 
win.loadURL("https://dark-messenger-production.up.railway.app");
}

app.whenReady().then(createWindow);