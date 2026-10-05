// Estándar del perfil maestro v1 (ver PERFIL-MAESTRO.md). Cada MCP de empleo incluye una copia idéntica
// de este archivo y de perfil-maestro.schema.json para instalarse por separado; si cambias uno, cópialo en los demás.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));

export const VERSION_ESTANDAR = 1;
export const RUTA_ESQUEMA = path.resolve(aqui, "..", "perfil-maestro.schema.json");
export const ESQUEMA = JSON.parse(fs.readFileSync(RUTA_ESQUEMA, "utf8"));

/** Ruta del perfil maestro: PERFIL_MAESTRO o ~/.perfil-maestro/perfil-maestro.json (compartida por todos los MCP). */
export function rutaPerfilMaestro() {
  return path.resolve(process.env.PERFIL_MAESTRO || path.join(os.homedir(), ".perfil-maestro", "perfil-maestro.json"));
}

/** Carpeta base de las rutas relativas del perfil (foto, cv_pdf). */
export function carpetaPerfilMaestro() {
  return path.resolve(process.env.RAIZ_ARCHIVOS || path.dirname(rutaPerfilMaestro()));
}

export function resolverArchivo(ruta) {
  return ruta ? path.resolve(carpetaPerfilMaestro(), ruta) : null;
}

export function existePerfilMaestro() {
  return fs.existsSync(rutaPerfilMaestro());
}

export const COMO_CREARLO =
  "No hay perfil maestro. Usa construir-perfil-maestro: pásale la URL de tu LinkedIn, o la ruta de tu CV en PDF y la de tu foto.";

export function cargarPerfilMaestro() {
  const ruta = rutaPerfilMaestro();
  if (!fs.existsSync(ruta)) {
    const e = new Error(`${COMO_CREARLO} (Se busca en ${ruta}; cámbialo con la variable PERFIL_MAESTRO.)`);
    e.estado = "sin_perfil_maestro";
    throw e;
  }
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validador = ajv.compile(ESQUEMA);

export function validarPerfilMaestro(perfil) {
  const valido = validador(perfil);
  return {
    valido,
    errores: valido ? [] : validador.errors.map((e) => `${e.instancePath || "(raíz)"} ${e.message}${e.params?.allowedValues ? `: ${e.params.allowedValues.join(", ")}` : ""}`),
  };
}

/** Dato propio de un portal: entrada.portales[portal][campo]. */
export function datoDePortal(entrada, portal, campo) {
  return entrada?.portales?.[portal]?.[campo];
}

/* ---------------------------------------------------------------- fuentes */

export async function extraerTextoPdf(ruta) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(ruta)));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const EXTENSIONES_FOTO = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const MAX_TEXTO = 60000;

function revisarArchivo(ruta, extensiones, nombre) {
  if (!ruta) return null;
  const absoluta = path.resolve(ruta);
  if (!fs.existsSync(absoluta)) return `No encontré ${nombre} en ${absoluta}.`;
  if (!extensiones.includes(path.extname(absoluta).toLowerCase())) return `${nombre} debe ser ${extensiones.join(", ")}.`;
  return null;
}

export const PASOS_PDF_LINKEDIN = [
  "Abre tu perfil de LinkedIn en el navegador (con tu sesión iniciada).",
  'Pulsa el botón "Más" (o "Recursos") debajo de tu nombre.',
  'Elige "Guardar en PDF": LinkedIn descarga tu perfil completo como PDF.',
  "Pásame la ruta de ese PDF en cv_pdf (y la de tu foto en foto).",
];

const REGLAS = [
  "Usa SOLO datos que aparezcan en las fuentes o que el usuario confirme. No inventes empresas, fechas, cargos, títulos, niveles de idioma ni salarios.",
  "Fechas en AAAA-MM (o AAAA si solo hay año). Empleo actual: fin null.",
  "Si dos fuentes no coinciden, o falta un dato importante (ciudad, país, nivel de inglés, preferencias, salario), anótalo en pendientes_de_confirmar en vez de suponerlo.",
  "Las tecnologías de cada empleo van en experiencia[].tecnologias; los logros, uno por elemento en logros_es.",
  "No llenes seguridad_social ni preferencias salariales salvo que el usuario las dé.",
  "Muestra el JSON al usuario y resuelvan juntos los pendientes antes de llamar guardar-perfil-maestro.",
];

/**
 * Prepara la construcción del perfil maestro. No guarda nada: devuelve qué falta o el material
 * (texto de las fuentes + esquema + reglas) para que el asistente arme el JSON y lo confirme con el usuario.
 */
export async function construirPerfilMaestro({ linkedin_url, cv_pdf, foto, texto, desde_portal } = {}, { portal, borradorDesdePortal } = {}) {
  if (existePerfilMaestro()) {
    return { estado: "ya_existe", archivo: rutaPerfilMaestro(), mensaje: "Ya hay un perfil maestro; edítalo, revísalo con ver-perfil-maestro o reemplázalo con guardar-perfil-maestro (sobrescribir: true)." };
  }
  const pdfs = [cv_pdf].flat().filter(Boolean);

  if (!linkedin_url && !pdfs.length && !texto && !desde_portal) {
    return {
      estado: "requiere_fuente",
      mensaje: "Para crear tu perfil maestro necesito una de estas fuentes:",
      opciones: [
        { opcion: "linkedin", pide: "La URL de tu perfil de LinkedIn (p. ej. https://www.linkedin.com/in/tu-usuario/)." },
        { opcion: "pdf", pide: "La ruta de tu CV en PDF (puedes pasar varios) y la ruta de tu foto de perfil." },
        ...(borradorDesdePortal ? [{ opcion: "portal", pide: `Usar lo que ya tienes en ${portal} (desde_portal: true).` }] : []),
      ],
      instrucciones: "Pregúntale al usuario cuál prefiere y vuelve a llamar con linkedin_url, o con cv_pdf y foto.",
    };
  }

  if (linkedin_url && !/^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\/[^/?#]+/i.test(linkedin_url)) {
    return { estado: "error", mensaje: "La URL de LinkedIn debe tener la forma https://www.linkedin.com/in/tu-usuario/." };
  }

  const problemas = [...pdfs.map((p) => revisarArchivo(p, [".pdf"], "el CV")), revisarArchivo(foto, EXTENSIONES_FOTO, "la foto")].filter(Boolean);
  if (problemas.length) return { estado: "error", mensaje: problemas.join(" ") };

  if (desde_portal && borradorDesdePortal) {
    const borrador = await borradorDesdePortal();
    if (linkedin_url) borrador.datos_personales = { ...borrador.datos_personales, linkedin: linkedin_url };
    return {
      estado: "borrador",
      borrador,
      foto: foto ? path.resolve(foto) : null,
      reglas: REGLAS,
      siguiente_paso: "Muestra el borrador, completa con el usuario lo que falte y guárdalo con guardar-perfil-maestro (perfil, foto, cv_pdf).",
    };
  }

  // LinkedIn bloquea la lectura automática de perfiles: el contenido llega como PDF exportado o como texto.
  if (linkedin_url && !pdfs.length && !texto) {
    return {
      estado: "requiere_pdf_de_linkedin",
      linkedin_url,
      mensaje: "LinkedIn no permite leer perfiles de forma automática. Exporta tu perfil a PDF (dos clics) y pásame su ruta.",
      pasos: PASOS_PDF_LINKEDIN,
      alternativa: "Si el asistente tiene una herramienta de LinkedIn que ya leyó tu perfil, pasa ese contenido en texto.",
      tambien: "Si tienes tu CV en PDF, pásalo junto con tu foto: se combinan ambas fuentes.",
    };
  }

  const fuentes = [];
  for (const p of pdfs) fuentes.push({ fuente: path.basename(p), texto: await extraerTextoPdf(path.resolve(p)) });
  if (texto) fuentes.push({ fuente: linkedin_url ? "LinkedIn (texto)" : "texto", texto: String(texto) });
  const vacias = fuentes.filter((f) => f.texto.length < 200).map((f) => f.fuente);
  let total = 0;
  for (const f of fuentes) {
    f.texto = f.texto.slice(0, Math.max(0, MAX_TEXTO - total));
    total += f.texto.length;
  }

  return {
    estado: "estructurar",
    archivo_destino: rutaPerfilMaestro(),
    fuentes,
    avisos: vacias.length ? [`Casi no saqué texto de: ${vacias.join(", ")}. Si es un PDF escaneado (imagen), exporta uno con texto.`] : [],
    datos_conocidos: { linkedin: linkedin_url || "", foto: foto ? path.resolve(foto) : "" },
    esquema: ESQUEMA,
    reglas: REGLAS,
    siguiente_paso: "Arma el perfil maestro siguiendo el esquema y las reglas, muéstraselo al usuario y, cuando lo apruebe, llama guardar-perfil-maestro con perfil, foto y cv_pdf.",
  };
}

/** Valida y guarda el perfil; copia la foto y el CV junto al perfil. Nunca sobrescribe sin sobrescribir: true (y respalda). */
export function guardarPerfilMaestro({ perfil, foto, cv_pdf, sobrescribir = false } = {}) {
  const ruta = rutaPerfilMaestro();
  const carpeta = path.dirname(ruta);
  if (fs.existsSync(ruta) && !sobrescribir) {
    return { estado: "ya_existe", archivo: ruta, mensaje: "Ya hay un perfil maestro. Usa sobrescribir: true solo si el usuario lo confirmó (se respalda el actual)." };
  }
  if (!perfil || typeof perfil !== "object") return { estado: "error", mensaje: "Falta perfil (objeto JSON)." };
  const problemas = [revisarArchivo(foto, EXTENSIONES_FOTO, "la foto"), revisarArchivo(cv_pdf, [".pdf"], "el CV")].filter(Boolean);
  if (problemas.length) return { estado: "error", mensaje: problemas.join(" ") };

  const final = structuredClone(perfil);
  final.$schema = pathToFileURL(RUTA_ESQUEMA).href;
  final.version = VERSION_ESTANDAR;
  final.actualizado = new Date().toISOString().slice(0, 10);
  final.datos_personales ||= {};

  const { valido, errores } = validarPerfilMaestro(final);
  if (!valido) return { estado: "invalido", errores, mensaje: "Corrige estos campos y vuelve a llamar." };

  fs.mkdirSync(carpeta, { recursive: true });
  let respaldo = null;
  if (fs.existsSync(ruta)) {
    fs.mkdirSync(path.join(carpeta, "respaldos"), { recursive: true });
    respaldo = path.join(carpeta, "respaldos", `${new Date().toISOString().replace(/[:.]/g, "-")}-perfil-maestro.json`);
    fs.copyFileSync(ruta, respaldo);
  }
  if (foto) {
    const nombre = `foto${path.extname(foto).toLowerCase()}`;
    fs.copyFileSync(path.resolve(foto), path.join(carpeta, nombre));
    final.datos_personales.foto = nombre;
  }
  if (cv_pdf) {
    fs.mkdirSync(path.join(carpeta, "cv"), { recursive: true });
    const nombre = path.join("cv", path.basename(cv_pdf));
    fs.copyFileSync(path.resolve(cv_pdf), path.join(carpeta, nombre));
    if (!final.cv_pdf) final.cv_pdf = nombre.split(path.sep).join("/");
  }
  fs.writeFileSync(ruta, JSON.stringify(final, null, 2) + "\n");
  return { estado: "guardado", archivo: ruta, respaldo, pendientes_de_confirmar: final.pendientes_de_confirmar || [] };
}

export function verPerfilMaestro() {
  const perfil = cargarPerfilMaestro();
  const { valido, errores } = validarPerfilMaestro(perfil);
  const foto = resolverArchivo(perfil.datos_personales?.foto);
  return {
    archivo: rutaPerfilMaestro(),
    valido,
    errores,
    nombre: perfil.datos_personales?.nombre,
    experiencias: (perfil.experiencia || []).length,
    formacion: (perfil.formacion || []).length,
    certificaciones: (perfil.certificaciones || []).length,
    idiomas: (perfil.idiomas || []).map((i) => `${i.idioma} ${i.nivel}`),
    foto: foto ? { ruta: foto, existe: fs.existsSync(foto) } : null,
    pendientes_de_confirmar: perfil.pendientes_de_confirmar || [],
    perfil,
  };
}

/* ---------------------------------------------------------------- herramientas MCP */

/**
 * Registra en un McpServer las herramientas estándar del perfil maestro.
 * z: la instancia de zod del servidor. portal / borradorDesdePortal: opcionales, para ofrecer un borrador con los datos del portal.
 */
export function registrarHerramientasPerfilMaestro(servidor, { z, portal, borradorDesdePortal } = {}) {
  const responder = async (fn) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await fn(), null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ estado: e.estado || "error", mensaje: e.message }, null, 2) }] };
    }
  };

  servidor.registerTool(
    "construir-perfil-maestro",
    {
      description:
        "Crea el perfil maestro (fuente única de tus datos para todos los MCP de empleo) cuando aún no existe. Sin argumentos, indica qué pedirle al usuario: la URL de su LinkedIn, o su CV en PDF y su foto. Con un PDF devuelve el texto extraído, el esquema estándar y las reglas para armar el JSON; con solo la URL de LinkedIn explica cómo exportar el perfil a PDF. No guarda nada: eso lo hace guardar-perfil-maestro tras la confirmación del usuario.",
      inputSchema: {
        linkedin_url: z.string().optional().describe("URL del perfil de LinkedIn (https://www.linkedin.com/in/usuario/)."),
        cv_pdf: z.union([z.string(), z.array(z.string())]).optional().describe("Ruta (o rutas) de CV en PDF, incluido el PDF exportado de LinkedIn."),
        foto: z.string().optional().describe("Ruta de la foto de perfil (JPG, PNG, GIF o WEBP)."),
        texto: z.string().optional().describe("Contenido del perfil ya obtenido por otra herramienta (p. ej. un MCP de LinkedIn)."),
        ...(borradorDesdePortal ? { desde_portal: z.boolean().optional().describe(`Armar un borrador con lo que ya hay en ${portal}.`) } : {}),
      },
    },
    (a) => responder(() => construirPerfilMaestro(a || {}, { portal, borradorDesdePortal }))
  );

  servidor.registerTool(
    "guardar-perfil-maestro",
    {
      description:
        "Valida el perfil maestro contra el esquema estándar y lo guarda (por defecto en ~/.perfil-maestro/perfil-maestro.json). Copia la foto y el CV junto al perfil. Llamar solo después de que el usuario apruebe el contenido. No sobrescribe uno existente salvo sobrescribir: true (y lo respalda).",
      inputSchema: {
        perfil: z.record(z.string(), z.any()).describe("Perfil maestro completo según el esquema."),
        foto: z.string().optional().describe("Ruta de la foto a copiar junto al perfil."),
        cv_pdf: z.string().optional().describe("Ruta del CV en PDF a copiar junto al perfil."),
        sobrescribir: z.boolean().optional().describe("true solo si el usuario confirmó reemplazar el perfil existente."),
      },
    },
    (a) => responder(() => guardarPerfilMaestro(a || {}))
  );

  servidor.registerTool(
    "ver-perfil-maestro",
    {
      description: "Muestra el perfil maestro, dónde está, si cumple el esquema estándar y qué queda pendiente de confirmar.",
      inputSchema: {},
    },
    () => responder(() => verPerfilMaestro())
  );
}
