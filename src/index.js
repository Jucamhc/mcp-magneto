#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PORTAL } from "./config.js";
import { evaluarEncaje, proponerRespuestas } from "./encaje.js";
import { buscarOfertas, detalleDeOferta, misPostulaciones, postularAOferta, preguntasDePostulacion } from "./ofertas.js";
import { registrarHerramientasPerfilMaestro } from "./perfil-maestro.js";
import { actualizarPerfil, borradorDesdeMagneto, compararPerfil, listarMisCv, subirCv, subirFoto, verMiPerfil } from "./perfil.js";
import { estadoDeSesion, iniciarSesion } from "./sesion.js";

const servidor = new McpServer({ name: "mcp-magneto", version: "0.1.0" });

function responder(datos) {
  return { content: [{ type: "text", text: JSON.stringify(datos, null, 2) }] };
}

function herramienta(nombre, descripcion, esquema, funcion) {
  servidor.registerTool(nombre, { description: descripcion, inputSchema: esquema }, async (args) => {
    try {
      return responder(await funcion(args || {}));
    } catch (e) {
      return responder({ estado: e.estado || "error", mensaje: e.message });
    }
  });
}

const oferta = z.union([z.string(), z.number()]).describe("Id, slug (p. ej. desarrollador-backend-1088350) o URL de la oferta, tal como lo devuelve buscar-ofertas.");

/* Sesión */

herramienta(
  "estado-de-sesion",
  "Indica si hay una sesión vigente de Magneto (el token dura 24 h) y el estado de la hoja de vida. Nunca muestra tokens ni cookies.",
  {},
  () => estadoDeSesion()
);

herramienta(
  "iniciar-sesion",
  "Abre un navegador basado en Chromium (Chrome, Edge, Brave o Chromium) en el login de Magneto para que el usuario entre a mano (código por correo, Google, Microsoft o LinkedIn). Si el navegador del MCP ya tenía la sesión, se renueva sola en segundos. Guarda el token en la carpeta de datos del MCP y cierra la ventana.",
  { espera_max_segundos: z.number().int().min(30).max(900).optional().describe("Tiempo máximo de espera (por defecto 300 s).") },
  ({ espera_max_segundos }) => iniciarSesion({ esperaMaxSegundos: espera_max_segundos })
);

/* Búsqueda */

herramienta(
  "buscar-ofertas",
  "Busca ofertas en Magneto (magneto365.com, Colombia). Funciona sin sesión; con sesión indica si ya te postulaste. Magneto no publica la modalidad por oferta: el filtro de modalidad es del portal y en el detalle se infiere del texto.",
  {
    palabra: z.string().min(2).optional().describe('Palabra clave, p. ej. "desarrollador", "react", "full stack".'),
    modalidad: z.enum(["remoto", "hibrido", "presencial", "todas"]).optional().describe("Por defecto: remoto."),
    contrato: z.enum(["todos", "indefinido", "fijo", "prestacion_servicios", "obra_labor", "temporal", "aprendizaje"]).optional(),
    ciudad: z.string().optional().describe("Ciudad de Colombia (p. ej. Cali). Por defecto, todo el país."),
    salario_minimo_millones: z.number().min(0).optional().describe("Deja solo ofertas cuyo salario máximo alcance este valor (millones COP). Excluye 'a convenir'."),
    orden: z.enum(["relevancia", "recientes"]).optional(),
    pagina: z.number().int().min(1).optional(),
    por_pagina: z.union([z.literal(20), z.literal(30)]).optional(),
  },
  (a) => buscarOfertas(a)
);

herramienta(
  "detalle-de-oferta",
  "Devuelve la descripción completa de una oferta: requisitos, habilidades, salario, contrato, modalidad inferida, ciudad y si tiene cuestionario de filtro.",
  { oferta },
  ({ oferta: o }) => detalleDeOferta(o)
);

herramienta(
  "evaluar-encaje",
  "Compara la oferta con el perfil maestro y sus preferencias (modalidad, salario mínimo según tipo de contrato, tecnologías declaradas y nivel de inglés) y devuelve encaja, encaja_parcial o no_encaja con los motivos.",
  { oferta },
  ({ oferta: o }) => evaluarEncaje(o)
);

/* Postulación */

herramienta(
  "preguntas-de-postulacion",
  "Lee cómo se postula a la oferta (requiere sesión): si ya estás postulado, si exige datos extra y las preguntas del cuestionario de filtro con sus opciones y límites. No envía nada.",
  { oferta },
  ({ oferta: o }) => preguntasDePostulacion(o)
);

herramienta(
  "proponer-respuestas",
  "Propone respuestas al cuestionario de filtro a partir del perfil maestro y las clasifica (respaldada, requiere_confirmacion, sin_respaldo). Nunca inventa datos ni envía nada.",
  { oferta },
  ({ oferta: o }) => proponerRespuestas(o)
);

herramienta(
  "postular-a-oferta",
  'Envía la postulación con las respuestas del cuestionario (si lo hay) en una sola petición. Exige la confirmación explícita del usuario para ESA oferta: confirmacion debe ser exactamente "POSTULAR <id>". Una oferta a la vez, sin reintentos automáticos.',
  {
    oferta,
    confirmacion: z.string().describe('Exactamente "POSTULAR <id numérico>", solo después de que el usuario aprobó la oferta y las respuestas.'),
    respuestas: z
      .array(
        z.object({
          pregunta_id: z.number().int(),
          respuesta: z.union([z.string(), z.array(z.string())]).describe("Texto; en preguntas de opción, el texto o id de la opción (varias en opción múltiple)."),
        })
      )
      .optional()
      .describe("Respuestas aprobadas por el usuario para todas las preguntas de preguntas-de-postulacion."),
  },
  (a) => postularAOferta(a)
);

herramienta(
  "mis-postulaciones",
  "Lista tus procesos (postulaciones) en Magneto con su estado.",
  { pagina: z.number().int().min(1).optional() },
  (a) => misPostulaciones(a)
);

/* Perfil maestro (estándar compartido: construir, guardar y ver) */

registrarHerramientasPerfilMaestro(servidor, { z, portal: PORTAL, borradorDesdePortal: borradorDesdeMagneto });

/* Hoja de vida en Magneto */

herramienta(
  "ver-mi-perfil",
  "Lee tu hoja de vida actual en Magneto: descripción, experiencia, formación, habilidades, idiomas, disponibilidad, foto y CV.",
  {},
  () => verMiPerfil()
);

herramienta(
  "comparar-perfil",
  "Compara tu hoja de vida de Magneto con el perfil maestro y lista lo que falta, lo desactualizado, lo que sobra y lo que conviene corregir en la web.",
  {},
  () => compararPerfil()
);

herramienta(
  "actualizar-perfil",
  "Actualiza una sección de la hoja de vida desde el perfil maestro. Sin aplicar devuelve el plan exacto (antes → después) para mostrarlo al usuario; con aplicar=true respalda en ~/.magneto/respaldos/ y guarda. Solo borra los ids indicados en eliminar_ids.",
  {
    seccion: z.enum(["descripcion", "idiomas", "habilidades", "experiencia", "formacion", "preferencias"]),
    aplicar: z.boolean().optional().describe("false (por defecto) = solo plan. true = guardar, tras la confirmación del usuario."),
    eliminar_ids: z.array(z.number().int()).optional().describe("Ids de entradas sobrantes que el usuario confirmó borrar."),
  },
  (a) => actualizarPerfil(a)
);

herramienta(
  "subir-foto",
  "Sube la foto indicada en datos_personales.foto del perfil maestro (JPG o PNG, máx. 5 MB) como foto de perfil. Sin aplicar solo muestra lo que haría.",
  { aplicar: z.boolean().optional() },
  (a) => subirFoto(a)
);

herramienta(
  "subir-cv",
  "Sube el CV en PDF del perfil maestro (cv_pdf: una ruta, o un objeto con varias versiones). Magneto guarda un solo CV: reemplaza el actual. Sin aplicar solo muestra lo que haría.",
  {
    version: z.string().optional().describe("Clave de cv_pdf cuando hay varias versiones; por defecto la primera."),
    aplicar: z.boolean().optional(),
  },
  (a) => subirCv(a)
);

herramienta("listar-mis-cv", "Muestra el CV adjunto en Magneto.", {}, () => listarMisCv());

await servidor.connect(new StdioServerTransport());
