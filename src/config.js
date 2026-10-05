import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const API = "https://api.magneto365.com";
export const WEB_OFERTAS = "https://www.magneto365.com/co/empleos";
export const WEB_PERFIL = "https://web.magneto365.com";
export const LOGIN = "https://login.magneto365.com/candidates";
export const PAIS_COLOMBIA = { id: 47, ubicacion: "C47" };

// Sesión, caché y respaldos en la carpeta del usuario (fuera de carpetas sincronizadas).
export const CARPETA_DATOS = process.env.MAGNETO_DATA_DIR || path.join(os.homedir(), ".magneto");
export const ARCHIVO_SESION = path.join(CARPETA_DATOS, "sesion.json");
export const PERFIL_CHROME = path.join(CARPETA_DATOS, "chrome-profile");
export const CARPETA_RESPALDOS = path.join(CARPETA_DATOS, "respaldos");

export const PORTAL = "magneto";

// Cualquier navegador basado en Chromium sirve para el inicio de sesión manual.
export const CHROME =
  process.env.CHROME_PATH ||
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/usr/bin/brave-browser",
  ].find((ruta) => fs.existsSync(ruta));

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
