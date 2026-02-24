/* eslint-disable no-useless-catch */
import { app, BrowserWindow, Menu } from 'electron';
import * as path from 'path';
import * as url from 'url';
import * as http from 'http';
import { Api } from './api';
import { AppMenu } from './menu';

const fixPath = require('fix-path');
const {
    setupTitlebar,
    attachTitlebarToWindow,
} = require('custom-electron-titlebar/main');
const contextMenu = require('electron-context-menu');
const Store = require('electron-store');
const store = new Store();

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const WINDOW_BOUNDS = 'WINDOW_BOUNDS';

fixPath();
setupTitlebar();
let win: BrowserWindow | null = null;
const args = process.argv.slice(1),
    serve = args.some((val) => val === '--serve');

const api = new Api(store);
contextMenu();
require('@electron/remote/main').initialize();

function createWindow(): BrowserWindow {
    // Create the browser window.
    win = new BrowserWindow({
        width: 1000,
        height: 800,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            allowRunningInsecureContent: serve ? true : false,
            contextIsolation: false,
            webSecurity: false,
        },
        backgroundColor: '#111111',
        resizable: true,
        darkTheme: true,
        icon: path.join(__dirname, '../dist/assets/icons/icon.png'),
        titleBarStyle: 'hidden',
        frame: false,
        minWidth: 400,
        minHeight: 500,
        title: 'IPTVnator',
        ...store.get(WINDOW_BOUNDS),
    });
    attachTitlebarToWindow(win);

    require('@electron/remote/main').enable(win.webContents);

    const showWhenReady = () => {
        if (!win) return;
        win.show();
        try {
            const shouldOpenDevTools =
                serve && process.env.e2e !== 'true' && process.env.OPEN_DEVTOOLS !== 'false';
            if (shouldOpenDevTools) {
                win.webContents.openDevTools({ mode: 'detach' });
            }
        } catch {}
    };

    if (serve) {
        const targets = ['http://127.0.0.1:4200', 'http://localhost:4200'];
        const tryLoad = (index = 0) => {
            const target = targets[index % targets.length];
            const req = http.get(target, (res) => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
                    win?.loadURL(target).then(showWhenReady).catch(() => {
                        setTimeout(() => tryLoad(index + 1), 700);
                    });
                } else {
                    setTimeout(() => tryLoad(index + 1), 700);
                }
                res.resume();
            });
            req.on('error', () => setTimeout(() => tryLoad(index + 1), 700));
            req.setTimeout(2000, () => {
                req.destroy();
                setTimeout(() => tryLoad(index + 1), 700);
            });
        };
        tryLoad();

        // Dev heartbeat: if dev-server drops after initial load, auto-retry
        let hbFails = 0;
        const hb = setInterval(() => {
            if (!win) return;
            const current = win.webContents.getURL();
            if (!current || current === 'about:blank') return;
            if (!current.includes('localhost:4200') && !current.includes('127.0.0.1:4200')) return;
            const pingUrl = current.startsWith('http://127.0.0.1') ? 'http://127.0.0.1:4200/favicon.ico' : 'http://localhost:4200/favicon.ico';
            const req = http.get(pingUrl, (res) => {
                hbFails = 0;
                res.resume();
            });
            req.on('error', () => {
                hbFails += 1;
                if (hbFails >= 2) {
                    const target = current.includes('127.0.0.1') ? 'http://127.0.0.1:4200' : 'http://localhost:4200';
                    win?.loadURL(target).catch(() => void 0);
                }
            });
            req.setTimeout(800, () => {
                req.destroy();
                hbFails += 1;
            });
        }, 2000);

        win.on('closed', () => clearInterval(hb));
    } else {
        win.loadURL(
            url.format({
                pathname: path.join(__dirname, '../dist/index.html'),
                protocol: 'file:',
                slashes: true,
            })
        ).then(showWhenReady);
    }

    win.webContents.on('did-fail-load', () => {
        if (!serve) return;
        setTimeout(() => {
            try {
                const current = win?.webContents.getURL();
                if (!current || current === 'about:blank') {
                    win?.reload();
                }
            } catch {}
        }, 1000);
    });

    win.webContents.on('dom-ready', () => {
        try {
            const script = `
              (function(){
                var t = setInterval(function(){
                  document.querySelectorAll('.cet-container[aria-hidden="true"]').forEach(function(el){
                    el.removeAttribute('aria-hidden');
                  });
                }, 300);
                setTimeout(function(){ clearInterval(t); }, 5000);
              })();
            `;
            win?.webContents.executeJavaScript(script);
        } catch {}
    });

    win.on('close', () => {
        if (win) store.set(WINDOW_BOUNDS, win.getNormalBounds());
    });

    // Emitted when the window is closed.
    win.on('closed', () => {
        // Dereference the window object, usually you would store window
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        win = null;

        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    return win;
}

/**
 * Creates hidden window for EPG worker
 * Hidden window is used as an additional thread to avoid blocking of the UI by long operations
 */
function createEpgWorkerWindow() {
    const window = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    window.loadFile('./electron/epg-worker.html');
    if (serve) {
        window.webContents.openDevTools();
    }

    window.once('ready-to-show', () => {
        api.setEpgWorkerWindow(window);
    });

    return window;
}

try {
    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    // Added 400 ms to fix the black background issue while using transparent window. More details at https://github.com/electron/electron/issues/15947
    app.on('ready', () => {
        // create main window and set menu
        const win = createWindow();
        const menu = new AppMenu(win);
        Menu.setApplicationMenu(menu.getMenu());
        api.setMainWindow(win);
        
        // create hidden window for epg worker
        createEpgWorkerWindow();
    });

    // Quit when all windows are closed.
    app.on('window-all-closed', () => {
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    app.on('activate', () => {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (win === null) {
            win = createWindow();
            const menu = new AppMenu(win);
            Menu.setApplicationMenu(menu.getMenu());
            api.setMainWindow(win);
        }
    });

    app.on('before-quit', () => {
        if (win) store.set(WINDOW_BOUNDS, win.getNormalBounds());
    });
} catch (e) {
    // Catch Error
    throw e;
}
