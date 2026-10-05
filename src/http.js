import fs from "node:fs";
import { API, ARCHIVO_SESION, CARPETA_DATOS, USER_AGENT, WEB_PERFIL } from "./config.js";

export class SesionExpirada extends Error {
  constructor(mensaje = "La sesión de Magneto no existe o venció. Usa iniciar-sesion.") {
    super(mensaje);
    this.estado = "sesion_expirada";
  }
}

export class ErrorApi extends Error {
  constructor(mensaje, status, datos) {
    super(mensaje);
    this.estado = status === 429 ? "limite_de_peticiones" : "error";
    this.status = status;
    this.datos = datos;
  }
}

/* ---------------------------------------------------------------- sesión (token JWT) */

function leerJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function leerSesion() {
  if (!fs.existsSync(ARCHIVO_SESION)) return null;
  try {
    const sesion = JSON.parse(fs.readFileSync(ARCHIVO_SESION, "utf8"));
    return sesion?.token ? sesion : null;
  } catch {
    return null;
  }
}

/** Token vigente (con 5 min de margen) o null. */
export function tokenVigente() {
  const sesion = leerSesion();
  if (!sesion) return null;
  const exp = leerJwt(sesion.token)?.exp;
  if (!exp || exp * 1000 - Date.now() < 5 * 60 * 1000) return null;
  return sesion.token;
}

export function guardarToken(token) {
  const datos = leerJwt(token);
  if (!datos?.exp) throw new Error("El token de Magneto no tiene el formato esperado.");
  fs.mkdirSync(CARPETA_DATOS, { recursive: true });
  fs.writeFileSync(ARCHIVO_SESION, JSON.stringify({ token, expira: new Date(datos.exp * 1000).toISOString() }, null, 2), { mode: 0o600 });
  return new Date(datos.exp * 1000).toISOString();
}

export function venceSesion() {
  const sesion = leerSesion();
  const exp = sesion && leerJwt(sesion.token)?.exp;
  return exp ? new Date(exp * 1000).toISOString() : null;
}

/* ---------------------------------------------------------------- peticiones */

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Llama a la API de Magneto. auth=true exige sesión (Bearer); auth="opcional" la usa si existe.
 * Solo las lecturas (GET) se reintentan una vez ante 429; los envíos nunca se reintentan.
 */
export async function api(ruta, { metodo = "GET", cuerpo, auth = false, cabeceras = {}, formulario } = {}) {
  const token = auth ? tokenVigente() : null;
  if (auth === true && !token) throw new SesionExpirada();

  const url = ruta.startsWith("http") ? ruta : `${API}${ruta.startsWith("/") ? "" : "/"}${ruta}`;
  const opciones = {
    method: metodo,
    headers: {
      Accept: "application/json",
      "Accept-Language": "es-CO",
      "User-Agent": USER_AGENT,
      Origin: WEB_PERFIL,
      Referer: `${WEB_PERFIL}/`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
      ...cabeceras,
    },
    body: formulario || (cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined),
  };

  for (let intento = 0; ; intento++) {
    const r = await fetch(url, opciones);
    const texto = await r.text();
    let datos = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      datos = texto;
    }
    if (r.ok) return datos;
    if (r.status === 401 || (r.status === 403 && token)) throw new SesionExpirada();
    if (r.status === 429 && metodo === "GET" && intento === 0) {
      await esperar((Number(r.headers.get("retry-after")) || 4) * 1000);
      continue;
    }
    const mensaje = (datos && typeof datos === "object" && (datos.message || datos.error)) || `HTTP ${r.status}`;
    throw new ErrorApi(
      r.status === 429 ? "Magneto limitó las peticiones (429). Espera un minuto antes de seguir." : `Magneto respondió ${r.status}: ${mensaje}`,
      r.status,
      datos
    );
  }
}

/* ---------------------------------------------------------------- texto */

export function decodificarHtml(texto) {
  return String(texto ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function textoPlano(html) {
  return decodificarHtml(
    String(html ?? "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
