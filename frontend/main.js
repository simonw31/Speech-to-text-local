const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let overlayWindow;
let dashboardWindow;
let tray = null;
let pythonProcess = null;

// --- LANCEMENT PYTHON ---
function startPythonBackend() {
    const pythonExecutable = path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe');
    const scriptPath = path.join(__dirname, '..', 'backend', 'server.py');

    pythonProcess = spawn(pythonExecutable, [scriptPath]);
    // On ne loggue plus rien pour éviter le bruit, sauf erreurs critiques
    pythonProcess.stderr.on('data', (data) => console.error(`[Python Err]: ${data}`));
}

// --- FENETRES ---
function createOverlay() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    overlayWindow = new BrowserWindow({
        width: 380, height: 120,
        x: (width / 2) - 190, y: height - 150,
        frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
        resizable: false, hasShadow: false, focusable: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    overlayWindow.loadFile('index.html');
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
}

function createDashboard() {
    if (dashboardWindow) {
        if (dashboardWindow.isMinimized()) dashboardWindow.restore();
        dashboardWindow.show();
        dashboardWindow.focus();
        return;
    }

    dashboardWindow = new BrowserWindow({
        width: 650, height: 520, title: "Handy FR",
        frame: false, backgroundColor: '#1e1e1e',
        resizable: false, minimizable: true,
        icon: path.join(__dirname, 'icon.png'), // Icône de la fenêtre aussi !
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    dashboardWindow.loadFile('dashboard.html');
    
    dashboardWindow.on('close', (e) => {
        if (!app.isQuitting) { e.preventDefault(); dashboardWindow.hide(); }
    });
}

function createTray() {
    // On charge l'image icon.png
    const iconPath = path.join(__dirname, 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    
    // Si l'image est trop grande, on la redimensionne proprement
    const trayIcon = icon.resize({ width: 16, height: 16 });

    tray = new Tray(trayIcon);
    
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Tableau de bord', click: createDashboard },
        { type: 'separator' },
        { label: 'Quitter', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('Handy FR');
    tray.setContextMenu(contextMenu);
    tray.on('click', createDashboard);
}

// --- APP LIFECYCLE ---
app.whenReady().then(() => {
    startPythonBackend();
    setTimeout(createOverlay, 300);
    setTimeout(createDashboard, 600);
    createTray();
});

app.on('will-quit', () => { if (pythonProcess) pythonProcess.kill(); });

// IPC
ipcMain.on('close-dashboard', () => { if (dashboardWindow) dashboardWindow.hide(); });
ipcMain.on('minimize-dashboard', () => { if (dashboardWindow) dashboardWindow.hide(); });
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if(win) win.setIgnoreMouseEvents(ignore, options);
});