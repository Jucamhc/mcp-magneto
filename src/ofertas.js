import { PAIS_COLOMBIA, WEB_OFERTAS } from "./config.js";
import { SesionExpirada, api, decodificarHtml, textoPlano, tokenVigente } from "./http.js";

export const MODALIDAD = { remoto: "remote", hibrido: "hybrid", presencial: "onSite" };
export const CONTRATO = {
  fijo: 1,
  indefinido: 2,
  temporal: 3,
  obra_labor: 4,
  prestacion_servicios: 5,
  aprendizaje: 6,
};
const ORDEN = { relevancia: ["_score", "DESC"], recientes: ["publish_date", "DESC"] };

// Tipos de respuesta del cuestionario de filtro de Magneto.
const TIPO_PREGUNTA = { 0: "opcion_unica", 1: "opcion_multiple", 2: "texto_corto", 3: "texto_largo" };
const MAX_CARACTERES = { 2: 140, 3: 2500 };

const millones = (cop) => Math.round((cop / 1e6) * 10) / 10;

/** Rango salarial en millones COP [mínimo, máximo] o null si es a convenir. */
export function rangoSalario(oferta) {
  const min = oferta.minSalary || oferta.salary || 0;
  const max = oferta.maxSalary || 0;
  if (oferta.toAgree || (!min && !max)) return null;
  return [millones(min || max), millones(max && max >= min ? max : min)];
}

function textoSalario(r) {
  const rango = rangoSalario(r);
  if (!rango) return "A convenir";
  return rango[0] === rango[1] ? `$${rango[0]} millones` : `$${rango[0]} - $${rango[1]} millones`;
}

/** Magneto no publica la modalidad por oferta (isRemote también es true en híbridas): se infiere del texto. */
function modalidadDe(r, descripcion = "", pista = null) {
  if (pista) return pista;
  const t = `${r.title || ""}\n${descripcion}`.toLowerCase();
  if (/h[ií]brid/.test(t)) return "Híbrido";
  if (/remot|teletrabajo|home ?office|desde casa/.test(t)) return "Remoto";
  if (/presencial/.test(t)) return "Presencial";
  return r.isRemote ? "Remoto o híbrido (no especificado)" : "Presencial";
}

function resumenOferta(r, pistaModalidad = null) {
  return {
    id: r.id,
    slug: r.jobSlug,
    titulo: decodificarHtml(r.title).trim(),
    empresa: r.confidential ? "Empresa confidencial" : decodificarHtml(r.companyName),
    ciudad: (r.cities || []).join(", ") || null,
    modalidad: modalidadDe(r, "", pistaModalidad),
    salario: textoSalario(r),
    contrato: r.contractOrder?.name || null,
    publicada: r.publishDate ? r.publishDate.slice(0, 10) : null,
    vence: r.expirationDate ? r.expirationDate.slice(0, 10) : null,
    tiene_cuestionario: Boolean(r.hasPrefilterQuestionnaire),
    ya_postulado: Boolean(r.isApplied),
    url: `${WEB_OFERTAS}/${r.jobSlug}`,
  };
}

async function idUbicacion(ciudad) {
  if (!ciudad) return PAIS_COLOMBIA.ubicacion;
  const lista = await api(`/jobs/v1/public/locations?term=${encodeURIComponent(ciudad)}&country_id=${PAIS_COLOMBIA.id}`);
  const ciudadEncontrada = (lista || []).find((l) => l.type === "CITY") || (lista || [])[0];
  if (!ciudadEncontrada) throw new Error(`No encontré la ciudad "${ciudad}" en Magneto.`);
  return ciudadEncontrada.id;
}

export async function buscarOfertas({
  palabra,
  modalidad = "remoto",
  contrato = "todos",
  ciudad,
  salario_minimo_millones,
  orden = "relevancia",
  pagina = 1,
  por_pagina = 20,
}) {
  const p = new URLSearchParams();
  p.set("device", "desktop");
  p.set("paginator[page]", String(pagina));
  p.set("paginator[pageSize]", String([20, 30].includes(por_pagina) ? por_pagina : 20));
  p.set("filters[locations][0]", await idUbicacion(ciudad));
  if (MODALIDAD[modalidad]) p.set("filters[work_modality][0]", MODALIDAD[modalidad]);
  if (CONTRATO[contrato]) p.set("filters[contract_type_id][0]", String(CONTRATO[contrato]));
  const [campo, sentido] = ORDEN[orden] || ORDEN.relevancia;
  p.set("order[field]", campo);
  p.set("order[order]", sentido);
  if (palabra) {
    p.set("queries[0][field]", "all");
    p.set("queries[0][term]", palabra);
  }

  // Con sesión, la búsqueda indica si ya te postulaste; sin ella, se usa la pública.
  let datos;
  let conSesion = Boolean(tokenVigente());
  if (conSesion) {
    try {
      datos = await api(`/jobs/v1/jobs/search?${p}`, { auth: true });
    } catch (e) {
      if (!(e instanceof SesionExpirada)) throw e;
      conSesion = false;
    }
  }
  if (!datos) datos = await api(`/jobs/v1/public/jobs/search?${p}`);

  const pista = { remoto: "Remoto", hibrido: "Híbrido", presencial: "Presencial" }[modalidad] || null;
  let filas = datos.rows || [];
  let descartadas = 0;
  if (salario_minimo_millones) {
    const antes = filas.length;
    filas = filas.filter((r) => {
      const rango = rangoSalario(r);
      return rango && rango[1] >= salario_minimo_millones;
    });
    descartadas = antes - filas.length;
  }
  return {
    total: datos.totalRows ?? filas.length,
    pagina,
    con_sesion: conSesion,
    ...(salario_minimo_millones ? { descartadas_por_salario_o_a_convenir: descartadas } : {}),
    ofertas: filas.map((r) => resumenOferta(r, pista)),
  };
}

/** Acepta el id numérico, el slug (desarrollador-1084022) o la URL de la oferta. */
export function interpretarOferta(oferta) {
  const texto = String(oferta).trim();
  const slug = texto.includes("/") ? texto.split("?")[0].replace(/\/+$/, "").split("/").pop() : texto;
  const id = Number((slug.match(/(\d+)$/) || [])[1]);
  if (!id) throw new Error(`No reconozco la oferta "${oferta}". Usa el id, el slug o la URL que devuelve buscar-ofertas.`);
  return { id, slug: /^\d+$/.test(slug) ? null : slug };
}

async function leerOferta(oferta) {
  const { id, slug } = interpretarOferta(oferta);
  if (tokenVigente()) {
    try {
      return await api(`/jobs/v1/jobs/${id}`, { auth: true });
    } catch (e) {
      if (e.status === 404) return null;
      if (!(e instanceof SesionExpirada)) throw e;
    }
  }
  if (!slug) {
    const error = new Error("Sin sesión, Magneto solo da el detalle con el slug de la oferta (p. ej. desarrollador-backend-1088350). Usa el slug de buscar-ofertas o inicia sesión.");
    error.estado = "requiere_slug";
    throw error;
  }
  try {
    return await api(`/jobs/v1/public/jobs/${encodeURIComponent(slug)}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function detalleDeOferta(oferta) {
  const r = await leerOferta(oferta);
  if (!r || !r.id) return { estado: "vencida", oferta, mensaje: "La oferta no existe o ya no está publicada." };
  const descripcion = textoPlano(r.description);
  return {
    ...resumenOferta(r),
    modalidad: modalidadDe(r, descripcion),
    descripcion,
    habilidades: (r.skills || []).map((s) => s.name),
    experiencia_meses: r.experienceMonthsNumber ?? null,
    educacion: (r.educationLevel || []).map((e) => e.name),
    sectores: (r.sectors || []).map((s) => s.name),
    preguntas_frecuentes: (r.faqs || []).map((f) => ({ pregunta: f.question || f.title, respuesta: f.answer })),
    se_puede_postular: r.canApply !== false,
    rango_salario_millones: rangoSalario(r),
  };
}

function leerPreguntas(cuestionario) {
  return (cuestionario?.questionnaires || []).flatMap((c) =>
    (c.questions || []).map((q) => ({
      cuestionario_id: c.id,
      pregunta_id: q.id,
      pregunta: decodificarHtml(q.titleQuestion).trim(),
      tipo: TIPO_PREGUNTA[q.answerType] || `desconocido_${q.answerType}`,
      ...(MAX_CARACTERES[q.answerType] ? { max_caracteres: MAX_CARACTERES[q.answerType] } : {}),
      ...((q.possibleAnswers || []).length ? { opciones: q.possibleAnswers.map((o) => ({ id: o.id, texto: decodificarHtml(o.titleAnswer).trim() })) } : {}),
      _tipo: q.answerType,
    }))
  );
}

/** Lee cómo se postula a la oferta (requiere sesión). No envía nada. */
export async function preguntasDePostulacion(oferta) {
  const { id } = interpretarOferta(oferta);
  const r = await api(`/jobs/v1/jobs/${id}`, { auth: true }).catch((e) => {
    if (e.status === 404) return null;
    throw e;
  });
  if (!r || !r.id) return { estado: "vencida", id, mensaje: "La oferta no existe o ya no está publicada." };
  const base = { id, titulo: decodificarHtml(r.title).trim(), empresa: r.confidential ? "Empresa confidencial" : r.companyName, url: `${WEB_OFERTAS}/${r.jobSlug}` };

  if (r.isApplied) return { ...base, estado: "already_applied", mensaje: "Ya estás postulado a esta oferta." };
  if (r.canApply === false) return { ...base, estado: "expired", mensaje: "Magneto no permite postular a esta oferta (cerrada o no disponible)." };

  // Algunas ofertas exigen campos extra del registro antes de postular.
  if (r.templateId) {
    const faltantes = await api("/sign-up-forms/v1/schema/apply", { metodo: "POST", cuerpo: { id }, auth: true }).catch(() => []);
    if (Array.isArray(faltantes) && faltantes.length) {
      return {
        ...base,
        estado: "needs_review",
        mensaje: "La empresa exige completar datos adicionales del registro antes de postular. Hazlo desde la web de la oferta.",
        campos: faltantes,
      };
    }
  }

  let preguntas = [];
  let yaRespondido = false;
  if (r.hasPrefilterQuestionnaire) {
    const { isAlreadyAnswered } = await api(`/jobs/v1/questionnaire/already-answered/${id}`, { auth: true }).catch(() => ({ isAlreadyAnswered: false }));
    yaRespondido = Boolean(isAlreadyAnswered);
    if (!yaRespondido) preguntas = leerPreguntas(await api(`/jobs/v1/questionnaire/${id}`, { auth: true }));
  }

  return {
    ...base,
    estado: "listo",
    tipo: preguntas.length ? "con_cuestionario" : "directa",
    cuestionario_ya_respondido: yaRespondido,
    preguntas: preguntas.map(({ _tipo, ...p }) => p),
    instrucciones: preguntas.length
      ? "Todas las preguntas son obligatorias. Propón respuestas con proponer-respuestas, revísalas con el usuario y envíalas en postular-a-oferta."
      : "No hay preguntas. Tras la confirmación del usuario, usa postular-a-oferta.",
  };
}

function armarCuestionarios(preguntas, respuestas) {
  const porId = new Map((respuestas || []).map((r) => [Number(r.pregunta_id), r.respuesta]));
  const faltan = [];
  const invalidas = [];
  const cuestionarios = new Map();

  for (const p of preguntas) {
    const valor = porId.get(p.pregunta_id);
    const texto = Array.isArray(valor) ? valor : valor === undefined || valor === null ? "" : String(valor).trim();
    if (!texto.length) {
      faltan.push(p.pregunta);
      continue;
    }
    let respuesta;
    if (p._tipo === 2 || p._tipo === 3) {
      const limpio = String(texto);
      if (limpio.length > p.max_caracteres) {
        invalidas.push(`"${p.pregunta}": máximo ${p.max_caracteres} caracteres (tiene ${limpio.length}).`);
        continue;
      }
      respuesta = { id: p.pregunta_id, type: p._tipo, openAnswer: limpio };
    } else {
      const elegidas = (Array.isArray(texto) ? texto : p._tipo === 1 ? String(texto).split(/\s*[;|]\s*/) : [texto]).map((t) => String(t).trim());
      const opciones = elegidas.map((t) => (p.opciones || []).find((o) => String(o.id) === t || o.texto.toLowerCase() === t.toLowerCase()));
      if (opciones.some((o) => !o) || (p._tipo === 0 && opciones.length !== 1)) {
        invalidas.push(`"${p.pregunta}": elige ${p._tipo === 0 ? "una opción" : "opciones"} de: ${(p.opciones || []).map((o) => o.texto).join(" | ")}.`);
        continue;
      }
      respuesta = { id: p.pregunta_id, type: p._tipo, answer: opciones.map((o) => ({ id: o.id, titleAnswer: o.texto })) };
    }
    if (!cuestionarios.has(p.cuestionario_id)) cuestionarios.set(p.cuestionario_id, { id: p.cuestionario_id, questions: [] });
    cuestionarios.get(p.cuestionario_id).questions.push(respuesta);
  }
  return { faltan, invalidas, cuestionarios: [...cuestionarios.values()] };
}

/**
 * Envía la postulación (y las respuestas del cuestionario de filtro, si lo hay) en una sola petición.
 * Exige la confirmación "POSTULAR <id>"; nunca se reintenta.
 */
export async function postularAOferta({ oferta, confirmacion, respuestas = [] }) {
  const { id } = interpretarOferta(oferta);
  if (String(confirmacion || "").trim() !== `POSTULAR ${id}`) {
    return { estado: "error", id, mensaje: `Falta la confirmación explícita del usuario: confirmacion debe ser exactamente "POSTULAR ${id}".` };
  }

  const r = await api(`/jobs/v1/jobs/${id}`, { auth: true }).catch((e) => {
    if (e.status === 404) return null;
    throw e;
  });
  if (!r || !r.id) return { estado: "expired", id, mensaje: "La oferta no existe o ya no está publicada." };
  if (r.isApplied) return { estado: "already_applied", id, mensaje: "Ya estabas postulado a esta oferta." };
  if (r.canApply === false) return { estado: "expired", id, mensaje: "Magneto no permite postular a esta oferta." };

  const cuerpo = {
    jobId: id,
    suggestedByMatcher: false,
    sourceOrigins: { isPublicJobsite: false },
    utmPayload: { utm_source: "direct", utm_medium: "none", conversion_channel: "web_desktop", refferer: "direct" },
  };

  if (r.hasPrefilterQuestionnaire) {
    const { isAlreadyAnswered } = await api(`/jobs/v1/questionnaire/already-answered/${id}`, { auth: true }).catch(() => ({ isAlreadyAnswered: false }));
    if (!isAlreadyAnswered) {
      const preguntas = leerPreguntas(await api(`/jobs/v1/questionnaire/${id}`, { auth: true }));
      const { faltan, invalidas, cuestionarios } = armarCuestionarios(preguntas, respuestas);
      if (faltan.length || invalidas.length) {
        return {
          estado: "needs_review",
          id,
          mensaje: "El cuestionario está incompleto o tiene respuestas inválidas. No se envió nada.",
          faltan,
          invalidas,
        };
      }
      cuerpo.questionnaires = cuestionarios;
    }
  }

  let respuesta;
  try {
    respuesta = await api("/jobs/v1/jobs/apply", { metodo: "POST", cuerpo, auth: true });
  } catch (e) {
    if (e.estado === "sesion_expirada") throw e;
    return { estado: "error", id, mensaje: `${e.message}. No se reintenta: revisa en la web si quedó registrada.`, detalle: e.datos ?? null };
  }

  const datos = respuesta?.data ?? respuesta ?? {};
  if (datos.applicationId) {
    return { estado: "submitted", id, titulo: decodificarHtml(r.title).trim(), id_postulacion: datos.applicationId, mensaje: "Postulación enviada." };
  }
  if (datos.missingFields || datos.level !== undefined) {
    return {
      estado: "needs_review",
      id,
      mensaje: "Magneto dejó la postulación como preseleccionada: tu hoja de vida no tiene los datos mínimos que pide la oferta. Complétalos y vuelve a postular.",
      nivel: datos.level ?? null,
      campos_faltantes: datos.missingFields || [],
    };
  }
  return { estado: "needs_review", id, mensaje: "Magneto respondió sin confirmar la postulación. Revisa mis-postulaciones o la web.", respuesta: datos };
}

export async function misPostulaciones({ pagina = 1 } = {}) {
  const [contadores, lista] = await Promise.all([
    api("/jobs/v2/my-processes/counters", { auth: true }).catch(() => null),
    api(`/jobs/v2/my-processes?page=${pagina}`, { auth: true }),
  ]);
  const filas = lista?.rows || [];
  return {
    total: lista?.totalRows ?? filas.length,
    pagina,
    procesos_activos: contadores?.process ?? null,
    postulaciones: filas.map((p) => ({
      id: p.vacantId ?? p.jobId ?? p.id,
      titulo: decodificarHtml(p.title || p.vacantName || p.jobTitle || ""),
      empresa: p.confidential ? "Empresa confidencial" : p.companyName || p.company || null,
      estado: p.stateName || p.status || p.state || null,
      fecha: (p.applicationDate || p.createdAt || p.date || "").slice(0, 10) || null,
      url: p.jobSlug ? `${WEB_OFERTAS}/${p.jobSlug}` : null,
    })),
    ...(filas.length ? {} : { mensaje: "No hay postulaciones registradas en Magneto." }),
  };
}
