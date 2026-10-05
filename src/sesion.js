import fs from "node:fs";
import { CARPETA_DATOS, CHROME, LOGIN, PERFIL_CHROME } from "./config.js";
import { SesionExpirada, api, guardarToken, tokenVigente, venceSesion } from "./http.js";

export async function estadoDeSesion() {
  if (!tokenVigente()) {
    return { estado: "sesion_expirada", sesion: false, mensaje: "No hay sesión vigente (el token de Magneto dura 24 h). Usa iniciar-sesion." };
  }
  try {
    const [perfil, conteo] = await Promise.all([
      api("/sign-up/v2/candidate/profile", { auth: true }),
      api("/sign-up/v2/candidate/applications/count", { auth: true }).catch(() => null),
    ]);
    return {
      estado: "ok",
      sesion: true,
      vence: venceSesion(),
      hoja_de_vida: {
        completitud: perfil.profilePercent ?? null,
        abierto_a_ofertas: perfil.openToWork ?? null,
        cv_adjunto: Boolean(perfil.cv?.fileName || perfil.cv?.url),
        postulaciones: conteo?.countApplied ?? null,
      },
    };
  } catch (e) {
    if (e instanceof SesionExpirada) return { estado: "sesion_expirada", sesion: false, mensaje: e.message };
    throw e;
  }
}

function tokenDeCookies(cookies) {
  const cookie = cookies.find((c) => c.name === "access_token" && c.domain.endsWith("magneto365.com") && c.value.split(".").length === 3);
  if (!cookie) return null;
  try {
    const { exp } = JSON.parse(Buffer.from(cookie.value.split(".")[1], "base64url").toString("utf8"));
    return exp * 1000 > Date.now() + 5 * 60 * 1000 ? cookie.value : null;
  } catch {
    return null;
  }
}

/**
 * Abre un navegador con un perfil propio del MCP para que la persona inicie sesión a mano
 * (Magneto usa código por correo, Google, Microsoft o LinkedIn). Si el perfil ya tiene la sesión,
 * la ventana se cierra sola en unos segundos.
 */
export async function iniciarSesion({ esperaMaxSegundos = 300 } = {}) {
  if (!CHROME) {
    throw new Error("No encontré un navegador basado en Chromium (Chrome, Edge, Brave o Chromium). Instala uno o define CHROME_PATH con la ruta de su ejecutable.");
  }
  const puppeteer = (await import("puppeteer-core")).default;
  fs.mkdirSync(PERFIL_CHROME, { recursive: true });

  // Sin la bandera de automatización: con ella la página de login de Magneto no carga.
  const navegador = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir: PERFIL_CHROME,
    defaultViewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--no-first-run", "--no-default-browser-check", "--window-size=1100,850", "--disable-blink-features=AutomationControlled"],
  });

  let token = null;
  try {
    const pagina = await navegador.newPage();
    await pagina.bringToFront();
    try {
      await pagina.goto(LOGIN, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (e) {
      process.stderr.write(`[magneto] No cargó el login automáticamente (${e.message}). Escribe ${LOGIN} en la ventana.\n`);
    }
    for (const otra of await navegador.pages()) {
      if (otra !== pagina && otra.url() === "about:blank") await otra.close().catch(() => {});
    }
    process.stderr.write("[magneto] Ventana de inicio de sesión abierta.\n");

    const cliente = await pagina.createCDPSession();
    const limite = Date.now() + esperaMaxSegundos * 1000;
    while (Date.now() < limite && navegador.connected) {
      try {
        const { cookies } = await cliente.send("Network.getAllCookies");
        token = tokenDeCookies(cookies);
      } catch {
        // La página está navegando; se reintenta en la siguiente vuelta.
      }
      if (token) break;
      await new Promise((r) => setTimeout(r, 2500));
    }
  } finally {
    if (navegador.connected) await navegador.close();
  }

  if (!token) {
    return {
      estado: "sesion_expirada",
      sesion: false,
      mensaje: `No detecté el inicio de sesión en ${esperaMaxSegundos} s o se cerró la ventana. Vuelve a llamar a iniciar-sesion.`,
    };
  }
  guardarToken(token);
  const estado = await estadoDeSesion();
  return { ...estado, mensaje: estado.sesion ? `Sesión guardada en ${CARPETA_DATOS}.` : estado.mensaje };
}
