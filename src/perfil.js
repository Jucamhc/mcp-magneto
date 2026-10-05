import fs from "node:fs";
import path from "node:path";
import { CARPETA_RESPALDOS, PORTAL, WEB_PERFIL } from "./config.js";
import { api } from "./http.js";
import { cargarPerfilMaestro, datoDePortal, resolverArchivo } from "./perfil-maestro.js";

const normalizar = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const LIMITE = { cargo: 120, descripcion_experiencia: 2000, descripcion_perfil: 2000, habilidades: 10 };

// Nivel de idiomas y habilidades en Magneto: 1 básico, 2 intermedio, 3 avanzado, 4 profesional/nativo.
const NIVELES = { 1: "Básico", 2: "Intermedio", 3: "Avanzado", 4: "Profesional / nativo" };
function nivelMagneto(texto) {
  const t = normalizar(texto);
  if (/nativ|bilingu|profesional|\bc2\b/.test(t)) return 4;
  if (/avanzad|fluid|\bc1\b|\bb2\b/.test(t)) return 3;
  if (/intermedi|\bb1\b/.test(t)) return 2;
  return 1;
}

// Tipo de estudio (catálogo /sign-up/v1/education/levels); Magneto lo exige junto al país para completar postulaciones.
function nivelEstudio(titulo) {
  const t = normalizar(titulo);
  if (/doctor|phd/.test(t)) return 9;
  if (/especializa|maestr|magister|master|mba/.test(t)) return 5;
  if (/^tecnolog/.test(t)) return 3;
  if (/^tecnic/.test(t)) return 2;
  if (/ingenier|licenciatura|profesional|administracion|contadur|derecho|medicina|psicolog|economia|b\.?sc/.test(t)) return 4;
  if (/bachiller/.test(t)) return 1;
  return null;
}

async function idPais(nombre) {
  if (!nombre) return null;
  const r = await api("/sign-up/v1/countries/active", { auth: "opcional" });
  return (r.rows || r || []).find((c) => normalizar(c.name) === normalizar(nombre))?.id ?? null;
}

const idDe = (v) => (v && typeof v === "object" ? v.id : v) ?? null;

const PASO = { descripcion: 15, habilidades: 16, foto: 19, idiomas: 20, experiencia: 37, preferencias: 47, borrar_experiencia: 63, formacion: 76, borrar_formacion: 77, certificacion: 60, borrar_certificacion: 67 };

const leerPerfilMagneto = () => api("/sign-up/v2/candidate/profile", { auth: true });

function guardarSeccion(cuerpo, paso) {
  return api("/sign-up/v2/candidate", { metodo: "PATCH", cuerpo: { ...cuerpo, step: paso }, auth: true, cabeceras: { "x-schema-response": "profile-v2" } });
}

function respaldar(perfil, seccion) {
  fs.mkdirSync(CARPETA_RESPALDOS, { recursive: true });
  const archivo = path.join(CARPETA_RESPALDOS, `${new Date().toISOString().replace(/[:.]/g, "-")}-${seccion}.json`);
  fs.writeFileSync(archivo, JSON.stringify(perfil, null, 2));
  return archivo;
}

const mes = (fecha) => (fecha ? String(fecha).slice(0, 7) : null);
const fechaMagneto = (fecha) => {
  if (!fecha) return null;
  const texto = String(fecha);
  return texto.length === 4 ? `${texto}-01-01` : `${texto.slice(0, 7)}-01`;
};

/* ---------------------------------------------------------------- lectura */

export async function verMiPerfil() {
  const p = await leerPerfilMagneto();
  return {
    completitud: p.profilePercent ?? null,
    nombre: [p.firstName, p.lastName].filter(Boolean).join(" "),
    cargo_o_profesion: p.titleOrProfession || null,
    ciudad: p.city?.name || null,
    nivel_educativo: p.educationLevel?.name || null,
    salario_aspirado: p.salary ? `${p.salary.toLocaleString("es-CO")} ${p.currencyPay?.shortName || ""} ${p.salaryFrequency?.name || ""}`.trim() : null,
    disponibilidad: {
      abierto_a_ofertas: p.openToWork ?? null,
      remoto: p.availableToRemoteWork ?? null,
      hibrido: p.availableToHybridWork ?? null,
      viajar: p.availableToTravel ?? null,
      reubicarse: p.availableToMove ?? null,
    },
    descripcion: p.profileDescription || null,
    experiencia: (p.experiences || []).map((e) => ({
      id: e.id,
      cargo: e.position,
      empresa: e.company,
      inicio: mes(e.startDate),
      fin: e.atPresent ? null : mes(e.endDate),
      actual: Boolean(e.atPresent),
      ciudad: e.city?.name || null,
      descripcion: e.description || "",
    })),
    formacion: (p.studies || []).map((s) => ({
      id: s.id,
      titulo: s.title,
      institucion: s.institute,
      profesion: s.profession,
      inicio: mes(s.startDate),
      fin: s.inProgress ? null : mes(s.endDate),
      en_curso: Boolean(s.inProgress),
    })),
    habilidades: (p.skills || []).map((s) => ({ id: s.id, nombre: s.name, nivel: NIVELES[s.level] || null })),
    idiomas: (p.languages || []).map((l) => ({ id: l.id, idioma: l.name, nivel: NIVELES[l.level] || l.level })),
    certificaciones: (p.certifications || []).length,
    redes: (p.socialMediaLinks || []).map((r) => r.url || r.link || r),
    foto: Boolean(p.profileImage?.url || p.profileImageFileName),
    cv: p.cv?.fileName ? { archivo: p.cv.fileName } : null,
    editar_en_la_web: `${WEB_PERFIL}/profile/resume`,
  };
}

export async function listarMisCv() {
  const p = await leerPerfilMagneto();
  return {
    cv: p.cv?.fileName ? [{ archivo: p.cv.fileName, actualizado: p.cv.updatedAt || null }] : [],
    nota: "Magneto guarda un solo CV por candidato: subir otro reemplaza el actual.",
  };
}

/* ---------------------------------------------------------------- comparación con el perfil maestro */

function claveEmpresa(nombre) {
  return normalizar(nombre).split(/[-(|,]/)[0].trim();
}

function descripcionExperiencia(e) {
  const logros = (e.logros_es || []).map((l) => `- ${l}`).join("\n");
  let texto = [e.descripcion_empresa ? `${e.descripcion_empresa}.` : "", logros, (e.tecnologias || []).length ? `Tecnologías: ${e.tecnologias.join(", ")}.` : ""]
    .filter(Boolean)
    .join("\n");
  if (texto.length > LIMITE.descripcion_experiencia) texto = texto.slice(0, LIMITE.descripcion_experiencia - 1).trimEnd() + "…";
  return texto;
}

function cargoMagneto(e) {
  const cargo = String(e.cargo || "");
  const conOficial = e.cargo_oficial && normalizar(e.cargo_oficial) !== normalizar(cargo) ? `${cargo} (cargo oficial: ${e.cargo_oficial})` : cargo;
  return (conOficial.length <= LIMITE.cargo ? conOficial : cargo).slice(0, LIMITE.cargo);
}

function experienciaDeseada(e) {
  return {
    position: cargoMagneto(e),
    company: e.empresa,
    description: descripcionExperiencia(e),
    atPresent: !e.fin,
    startDate: fechaMagneto(e.inicio),
    endDate: e.fin ? fechaMagneto(e.fin) : null,
  };
}

function emparejarExperiencias(maestro, actuales) {
  const usadas = new Set();
  return (maestro || []).map((m) => {
    const actual = actuales.find((a) => !usadas.has(a.id) && claveEmpresa(a.company) === claveEmpresa(m.empresa) && mes(a.startDate) === mes(fechaMagneto(m.inicio)))
      || actuales.find((a) => !usadas.has(a.id) && claveEmpresa(a.company) === claveEmpresa(m.empresa));
    if (actual) usadas.add(actual.id);
    return { maestro: m, actual: actual || null };
  });
}

function diferenciasExperiencia(actual, deseada) {
  const cambios = [];
  if (normalizar(actual.position) !== normalizar(deseada.position)) cambios.push(`cargo: "${actual.position}" → "${deseada.position}"`);
  if (mes(actual.startDate) !== mes(deseada.startDate)) cambios.push(`inicio: ${mes(actual.startDate)} → ${mes(deseada.startDate)}`);
  if (Boolean(actual.atPresent) !== deseada.atPresent) cambios.push(`trabajo actual: ${Boolean(actual.atPresent)} → ${deseada.atPresent}`);
  if (!deseada.atPresent && mes(actual.endDate) !== mes(deseada.endDate)) cambios.push(`fin: ${mes(actual.endDate)} → ${mes(deseada.endDate)}`);
  if (normalizar(actual.description) !== normalizar(deseada.description)) cambios.push("descripción");
  return cambios;
}

function formacionDeseada(f, paisId = null) {
  const titulo = f.titulo_es || f.titulo || "";
  return {
    institute: f.institucion,
    profession: titulo,
    title: titulo,
    inProgress: !f.fin || f.graduado === false,
    startDate: fechaMagneto(f.inicio),
    endDate: f.fin && f.graduado !== false ? fechaMagneto(f.fin) : null,
    studyType: nivelEstudio(titulo),
    countryId: paisId,
  };
}

function diferenciasEstudio(actual, deseada) {
  const cambios = [];
  if (mes(actual.startDate) !== mes(deseada.startDate) || Boolean(actual.inProgress) !== deseada.inProgress || (!deseada.inProgress && mes(actual.endDate) !== mes(deseada.endDate))) {
    cambios.push(`fechas: ${mes(actual.startDate)}–${actual.inProgress ? "en curso" : mes(actual.endDate)} → ${mes(deseada.startDate)}–${deseada.inProgress ? "en curso" : mes(deseada.endDate)}`);
  }
  if (!idDe(actual.studyType) && deseada.studyType) cambios.push(`tipo de estudio: vacío → ${deseada.studyType}`);
  if (!idDe(actual.country) && deseada.countryId) cambios.push(`país: vacío → ${deseada.countryId}`);
  return cambios;
}

/** Mismo título y misma institución, admitiendo abreviaturas ("I.U." por "Institución Universitaria"). */
function mismoEstudio(estudio, institucion, titulo) {
  if (normalizar(estudio.title) !== normalizar(titulo)) return false;
  const a = normalizar(estudio.institute).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((p) => p.length > 3);
  const b = new Set(normalizar(institucion).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((p) => p.length > 3));
  return !a.length || !b.size || a.filter((p) => b.has(p)).length >= Math.min(2, a.length, b.size);
}

function habilidadesDeseadas(perfil) {
  const lista = [...(perfil.habilidades_clave?.tecnicas || []), ...Object.values(perfil.aptitudes || {}).flat()];
  const unicas = [];
  for (const h of lista) if (h && !unicas.some((u) => normalizar(u) === normalizar(h))) unicas.push(h);
  return unicas.slice(0, LIMITE.habilidades);
}

export async function compararPerfil() {
  const perfil = cargarPerfilMaestro();
  const p = await leerPerfilMagneto();
  const pref = perfil.preferencias || {};
  const faltan = [];
  const desactualizado = [];
  const sobra = [];
  const sugerencias = [];

  if (!p.profileDescription) faltan.push("descripcion: el perfil no tiene descripción (actualizar-perfil seccion=descripcion).");
  else if (perfil.resumen?.es && normalizar(p.profileDescription) !== normalizar(perfil.resumen.es)) desactualizado.push("descripcion: difiere del resumen del perfil maestro.");

  const idiomasMg = (p.languages || []).map((l) => normalizar(l.name));
  for (const i of perfil.idiomas || []) {
    if (/espa/i.test(i.idioma) && /nativ/i.test(i.nivel || "")) continue;
    const actual = (p.languages || []).find((l) => normalizar(l.name) === normalizar(i.idioma));
    if (!actual) faltan.push(`idiomas: ${i.idioma} (${i.nivel}).`);
    else if (actual.level !== nivelMagneto(i.nivel)) desactualizado.push(`idiomas: ${i.idioma} está como ${NIVELES[actual.level]}; en el perfil maestro es ${i.nivel}.`);
  }
  if (!idiomasMg.length && !(perfil.idiomas || []).length) faltan.push("idiomas: ninguno registrado.");

  const deseadas = habilidadesDeseadas(perfil).map(normalizar);
  const actuales = (p.skills || []).map((s) => normalizar(s.name));
  const faltanHab = habilidadesDeseadas(perfil).filter((h) => !actuales.includes(normalizar(h)));
  if (faltanHab.length) faltan.push(`habilidades: ${faltanHab.join(", ")}.`);
  for (const s of p.skills || []) if (!deseadas.includes(normalizar(s.name))) sobra.push(`habilidad (id ${s.id}): "${s.name}"`);

  const parejas = emparejarExperiencias(perfil.experiencia, p.experiences || []);
  for (const { maestro, actual } of parejas) {
    if (!actual) faltan.push(`experiencia: ${maestro.cargo} en ${maestro.empresa} (${maestro.inicio} – ${maestro.fin || "actual"}).`);
    else {
      const cambios = diferenciasExperiencia(actual, experienciaDeseada(maestro));
      if (cambios.length) desactualizado.push(`experiencia (id ${actual.id}) ${maestro.empresa}: ${cambios.join("; ")}.`);
      if (actual.city?.name && maestro.ubicacion && !normalizar(maestro.ubicacion).includes(normalizar(actual.city.name))) {
        sugerencias.push(`experiencia (id ${actual.id}) ${maestro.empresa}: la ciudad es "${actual.city.name}" y el perfil maestro dice "${maestro.ubicacion}"; corrígela en la web.`);
      }
    }
  }
  const emparejadas = new Set(parejas.filter((x) => x.actual).map((x) => x.actual.id));
  for (const e of p.experiences || []) if (!emparejadas.has(e.id)) sobra.push(`experiencia (id ${e.id}): ${e.position} en ${e.company}`);

  const paisFormacion = (perfil.formacion || []).length ? await idPais(perfil.datos_personales?.pais) : null;
  for (const f of perfil.formacion || []) {
    const actual = (p.studies || []).find((s) => mismoEstudio(s, f.institucion, f.titulo_es || f.titulo));
    const deseada = formacionDeseada(f, paisFormacion);
    if (!actual && f.mostrar_en_cv === false) continue;
    if (!actual) faltan.push(`formacion: ${deseada.title} – ${f.institucion}.`);
    else {
      const cambios = diferenciasEstudio(actual, deseada);
      if (cambios.length) desactualizado.push(`formacion (id ${actual.id}) ${deseada.title}: ${cambios.join("; ")}.`);
    }
  }
  for (const s of p.studies || []) {
    const esta = (perfil.formacion || []).some((f) => mismoEstudio(s, f.institucion, f.titulo_es || f.titulo));
    if (!esta) sobra.push(`formacion (id ${s.id}): ${s.title} – ${s.institute}`);
  }

  const certMg = (p.certifications || []).map((c) => normalizar(c.name));
  const faltanCert = (perfil.certificaciones || []).filter((c) => !certMg.includes(normalizar(c.nombre))).map((c) => c.nombre);
  if (faltanCert.length) faltan.push(`certificaciones: ${faltanCert.join(", ")} (actualizar-perfil seccion=certificaciones).`);

  if (pref.acepta_reubicacion === false && p.availableToMove) desactualizado.push("preferencias: Magneto dice que aceptas reubicarte y el perfil maestro dice que no (actualizar-perfil seccion=preferencias).");
  if (/solo remoto/i.test(pref.modalidad || "") && p.availableToHybridWork) desactualizado.push("preferencias: Magneto dice que aceptas trabajo híbrido y buscas solo remoto (actualizar-perfil seccion=preferencias).");
  const cargo = datoDePortal(perfil, PORTAL, "cargo");
  if (cargo && normalizar(cargo) !== normalizar(p.titleOrProfession)) desactualizado.push(`preferencias: cargo "${p.titleOrProfession}" → "${cargo}".`);
  if (!p.openToWork) sugerencias.push("abierto a ofertas está desactivado: actívalo en la web para que te encuentren los reclutadores.");
  if (pref.salario_minimo_laboral_cop && p.salary && p.salary !== pref.salario_minimo_laboral_cop) {
    sugerencias.push(`salario aspirado: Magneto tiene ${p.salary.toLocaleString("es-CO")} y tu mínimo laboral es ${pref.salario_minimo_laboral_cop.toLocaleString("es-CO")}.`);
  }
  if (!p.cv?.fileName) faltan.push("cv: no hay hoja de vida en PDF adjunta (subir-cv).");
  if (!p.profileImage?.url && !p.profileImageFileName) faltan.push("foto: sin foto de perfil (subir-foto).");

  return {
    completitud: p.profilePercent ?? null,
    faltan,
    desactualizado,
    sobra,
    sugerencias,
    secciones_actualizables: ["descripcion", "idiomas", "habilidades", "experiencia", "formacion", "certificaciones", "preferencias"],
    nota: "preferencias cambia cargo, salario, remoto, híbrido, viajar y cambio de domicilio; el resto del formulario se reenvía igual. Ciudad de cada experiencia, datos personales y 'abierto a ofertas' se editan en la web.",
  };
}

/* ---------------------------------------------------------------- actualización */

async function idsIdiomas() {
  const lista = await api("/sign-up/v1/languages", { auth: true });
  return new Map((lista || []).map((l) => [normalizar(l.name), l]));
}

/**
 * Plan y aplicación por sección. Sin aplicar devuelve el antes → después; con aplicar=true respalda y guarda.
 * Solo borra lo indicado en eliminar_ids.
 */
export async function actualizarPerfil({ seccion, aplicar = false, eliminar_ids = [] }) {
  const perfil = cargarPerfilMaestro();
  const p = await leerPerfilMagneto();
  const borrar = new Set((eliminar_ids || []).map(Number));
  const operaciones = [];

  if (seccion === "descripcion") {
    let texto = String(datoDePortal(perfil, PORTAL, "descripcion") || perfil.resumen?.es || "").trim();
    if (!texto) return { estado: "error", mensaje: "El perfil maestro no tiene resumen.es." };
    if (texto.length > LIMITE.descripcion_perfil) texto = texto.slice(0, LIMITE.descripcion_perfil - 1).trimEnd() + "…";
    if (normalizar(texto) !== normalizar(p.profileDescription)) operaciones.push({ accion: "actualizar", paso: PASO.descripcion, antes: p.profileDescription || "", despues: texto, cuerpo: { profileDescription: texto } });
  }

  if (seccion === "idiomas") {
    const catalogo = await idsIdiomas();
    const actuales = p.languages || [];
    const lista = actuales.filter((l) => !borrar.has(Number(l.id))).map((l) => ({ id: l.id, languageId: l.languageId, name: l.name, level: l.level }));
    const noEncontrados = [];
    for (const i of perfil.idiomas || []) {
      if (/espa/i.test(i.idioma) && /nativ/i.test(i.nivel || "")) continue;
      const item = catalogo.get(normalizar(i.idioma));
      if (!item) {
        noEncontrados.push(i.idioma);
        continue;
      }
      const existente = lista.find((l) => l.languageId === item.id);
      if (existente) existente.level = nivelMagneto(i.nivel);
      else lista.push({ languageId: item.id, name: item.name, level: nivelMagneto(i.nivel) });
    }
    const antes = actuales.map((l) => `${l.name} (${NIVELES[l.level]})`);
    const despues = lista.map((l) => `${l.name} (${NIVELES[l.level]})`);
    if (JSON.stringify(antes) !== JSON.stringify(despues)) operaciones.push({ accion: "actualizar", paso: PASO.idiomas, antes, despues, cuerpo: { languages: lista } });
    if (noEncontrados.length) operaciones.push({ accion: "aviso", mensaje: `No encontré en el catálogo de Magneto: ${noEncontrados.join(", ")}.` });
  }

  if (seccion === "habilidades") {
    const actuales = p.skills || [];
    const conservadas = actuales.filter((s) => !borrar.has(Number(s.id))).map((s) => ({ id: s.id, name: s.name, level: s.level }));
    const nuevas = habilidadesDeseadas(perfil).filter((h) => !conservadas.some((s) => normalizar(s.name) === normalizar(h)));
    const espacio = Math.max(0, LIMITE.habilidades - conservadas.length);
    const lista = [...conservadas, ...nuevas.slice(0, espacio).map((name) => ({ name, level: 4 }))];
    if (nuevas.length > espacio) {
      operaciones.push({ accion: "aviso", mensaje: `Magneto admite ${LIMITE.habilidades} habilidades; no caben: ${nuevas.slice(espacio).join(", ")}. Indica en eliminar_ids las actuales que sobran.` });
    }
    const antes = actuales.map((s) => s.name);
    const despues = lista.map((s) => s.name);
    if (JSON.stringify(antes) !== JSON.stringify(despues)) operaciones.push({ accion: "actualizar", paso: PASO.habilidades, antes, despues, cuerpo: { skills: lista } });
  }

  if (seccion === "experiencia") {
    const actuales = p.experiences || [];
    for (const { maestro, actual } of emparejarExperiencias(perfil.experiencia, actuales)) {
      const deseada = experienciaDeseada(maestro);
      if (!actual) {
        operaciones.push({ accion: "crear", paso: PASO.experiencia, despues: `${deseada.position} en ${deseada.company} (${mes(deseada.startDate)} – ${mes(deseada.endDate) || "actual"})`, cuerpo: { experiences: [deseada] } });
        continue;
      }
      if (borrar.has(Number(actual.id))) continue;
      const cambios = diferenciasExperiencia(actual, deseada);
      if (cambios.length) {
        operaciones.push({
          accion: "actualizar",
          paso: PASO.experiencia,
          id: actual.id,
          antes: `${actual.position} en ${actual.company}`,
          despues: cambios,
          cuerpo: { experiences: [{ id: actual.id, ...deseada, company: actual.company }] },
        });
      }
    }
    for (const e of actuales.filter((x) => borrar.has(Number(x.id)))) {
      operaciones.push({ accion: "eliminar", paso: PASO.borrar_experiencia, id: e.id, antes: `${e.position} en ${e.company}`, cuerpo: { experiences: [e], clearSection: "experiences" } });
    }
  }

  if (seccion === "formacion") {
    const actuales = p.studies || [];
    const paisFormacion = await idPais(perfil.datos_personales?.pais);
    for (const f of perfil.formacion || []) {
      const deseada = formacionDeseada(f, paisFormacion);
      if (f.mostrar_en_cv === false && !actuales.some((s) => mismoEstudio(s, deseada.institute, deseada.title))) {
        operaciones.push({ accion: "aviso", mensaje: `No se agrega "${deseada.title}" porque tiene mostrar_en_cv: false en el perfil maestro.` });
        continue;
      }
      const actual = actuales.find((s) => mismoEstudio(s, deseada.institute, deseada.title));
      if (!actual) {
        operaciones.push({ accion: "crear", paso: PASO.formacion, despues: `${deseada.title} – ${deseada.institute} (${mes(deseada.startDate)} – ${deseada.inProgress ? "en curso" : mes(deseada.endDate)})`, cuerpo: { studies: [deseada] } });
        continue;
      }
      if (borrar.has(Number(actual.id))) continue;
      const cambios = diferenciasEstudio(actual, deseada);
      if (cambios.length) {
        const { country, studyType, ...resto } = actual;
        operaciones.push({
          accion: "actualizar",
          paso: PASO.formacion,
          id: actual.id,
          titulo: deseada.title,
          cambios,
          cuerpo: {
            studies: [{ ...resto, ...deseada, id: actual.id, studyType: deseada.studyType ?? idDe(studyType), countryId: deseada.countryId ?? idDe(country) }],
          },
        });
      }
    }
    for (const s of actuales.filter((x) => borrar.has(Number(x.id)))) {
      operaciones.push({ accion: "eliminar", paso: PASO.borrar_formacion, id: s.id, antes: `${s.title} – ${s.institute}`, cuerpo: { studies: [s], clearSection: "studies" } });
    }
  }

  if (seccion === "certificaciones") {
    const actuales = p.certifications || [];
    for (const c of perfil.certificaciones || []) {
      if (actuales.some((a) => normalizar(a.name) === normalizar(c.nombre))) continue;
      const deseada = {
        name: c.nombre,
        institution: c.emisor || "",
        expeditionDate: c.fecha ? fechaMagneto(c.fecha) : null,
        ...(c.url || c.credencial ? { credentialUrl: c.url || c.credencial } : {}),
      };
      operaciones.push({ accion: "crear", paso: PASO.certificacion, despues: `${deseada.name} – ${deseada.institution}${c.fecha ? ` (${c.fecha})` : ""}`, cuerpo: { certifications: [deseada] } });
    }
    for (const c of actuales.filter((x) => borrar.has(Number(x.id)))) {
      operaciones.push({ accion: "eliminar", paso: PASO.borrar_certificacion, id: c.id, antes: `${c.name} – ${c.institution}`, cuerpo: { certifications: [c], clearSection: "certifications" } });
    }
  }

  if (seccion === "preferencias") {
    const pref = perfil.preferencias || {};
    const soloRemoto = /solo remoto/i.test(pref.modalidad || "");
    const deseado = {
      titleOrProfession: datoDePortal(perfil, PORTAL, "cargo") || p.titleOrProfession,
      salary: pref.salario_minimo_laboral_cop || p.salary,
      availableToRemoteWork: /remot/i.test(pref.modalidad || "") ? true : Boolean(p.availableToRemoteWork),
      availableToHybridWork: soloRemoto ? false : Boolean(p.availableToHybridWork),
      availableToMove: typeof pref.acepta_reubicacion === "boolean" ? pref.acepta_reubicacion : Boolean(p.availableToMove),
      availableToTravel: typeof pref.puede_viajar === "boolean" ? pref.puede_viajar : Boolean(p.availableToTravel),
    };
    const etiquetas = {
      titleOrProfession: "cargo",
      salary: "salario mínimo",
      availableToRemoteWork: "remoto",
      availableToHybridWork: "híbrido",
      availableToMove: "cambio de domicilio",
      availableToTravel: "disponible para viajar",
    };
    const diferencias = Object.keys(deseado)
      .filter((k) => (k.startsWith("available") ? Boolean(p[k]) : p[k]) !== deseado[k])
      .map((k) => `${etiquetas[k]}: ${JSON.stringify(k.startsWith("available") ? Boolean(p[k]) : p[k])} → ${JSON.stringify(deseado[k])}`);
    if (diferencias.length) {
      // El formulario de Preferencias se envía completo: lo que no cambia se reenvía tal como está.
      const cuerpo = {
        ...deseado,
        currencyPayId: p.currencyPay?.id,
        salaryFrequencyId: p.salaryFrequency?.id,
        candidateSectors: (p.sectors || []).map((s) => s.id),
        educationLevelId: p.educationLevel?.id,
        workCityId: (p.workCity || p.city)?.id,
        internshipType: p.internshipType?.id ?? 0,
        ...(p.disability ? { disability: p.disability } : {}),
        candidateJourneys: (p.journeys || []).map((j) => j.id),
      };
      const faltan = ["currencyPayId", "salaryFrequencyId", "educationLevelId", "workCityId"].filter((k) => !cuerpo[k]);
      if (faltan.length) return { estado: "needs_review", seccion, mensaje: `Completa primero en la web las preferencias sin dato (${faltan.join(", ")}).` };
      operaciones.push({ accion: "actualizar", paso: PASO.preferencias, antes: "Preferencias actuales", despues: diferencias, cuerpo });
    }
  }

  const cambios = operaciones.filter((o) => o.accion !== "aviso");
  const avisos = operaciones.filter((o) => o.accion === "aviso").map((o) => o.mensaje);
  const plan = cambios.map(({ cuerpo, paso, ...resto }) => resto);
  if (!cambios.length) return { estado: "sin_cambios", seccion, avisos, mensaje: "La sección ya coincide con el perfil maestro." };
  if (!aplicar) {
    return { estado: "plan", seccion, plan, avisos, siguiente_paso: "Muestra el plan al usuario. Si lo aprueba, vuelve a llamar con aplicar=true (y eliminar_ids para lo que confirme borrar)." };
  }

  const respaldo = respaldar(p, seccion);
  const resultados = [];
  for (const o of cambios) {
    try {
      await guardarSeccion(o.cuerpo, o.paso);
      resultados.push({ accion: o.accion, id: o.id ?? null, estado: "ok" });
    } catch (e) {
      resultados.push({ accion: o.accion, id: o.id ?? null, estado: "error", mensaje: e.message });
      if (e.estado === "sesion_expirada") break;
    }
  }
  return { estado: resultados.every((r) => r.estado === "ok") ? "guardado" : "parcial", seccion, respaldo, resultados, avisos, verifica_con: "comparar-perfil" };
}

/* ---------------------------------------------------------------- archivos */

const TIPOS_FOTO = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

export async function subirFoto({ aplicar = false } = {}) {
  const perfil = cargarPerfilMaestro();
  const ruta = resolverArchivo(perfil.datos_personales?.foto);
  if (!ruta || !fs.existsSync(ruta)) return { estado: "error", mensaje: `No encontré la foto del perfil maestro (datos_personales.foto${ruta ? `: ${ruta}` : ""}).` };
  const tipo = TIPOS_FOTO[path.extname(ruta).toLowerCase()];
  if (!tipo) return { estado: "error", mensaje: "La foto debe ser JPG o PNG." };
  const tamano = fs.statSync(ruta).size;
  if (tamano > 5 * 1024 * 1024) return { estado: "error", mensaje: "La foto supera 5 MB." };
  if (!aplicar) return { estado: "plan", archivo: ruta, tamano_kb: Math.round(tamano / 1024), mensaje: "Con aplicar=true reemplaza la foto de perfil de Magneto." };

  const datosUrl = `data:${tipo};base64,${fs.readFileSync(ruta).toString("base64")}`;
  await guardarSeccion({ profileImageFileName: datosUrl, originalFileName: path.basename(ruta) }, PASO.foto);
  const p = await leerPerfilMagneto();
  return { estado: p.profileImage?.url || p.profileImageFileName ? "guardado" : "needs_review", mensaje: "Foto enviada. Revisa en la web que se vea bien (Magneto la recorta en círculo)." };
}

export async function subirCv({ version, aplicar = false } = {}) {
  const perfil = cargarPerfilMaestro();
  const cv = perfil.cv_pdf;
  const relativa = typeof cv === "string" ? cv : cv && (version ? cv[version] : Object.values(cv)[0]);
  const ruta = resolverArchivo(relativa);
  if (!ruta || !fs.existsSync(ruta)) return { estado: "error", mensaje: `No encontré el CV del perfil maestro (cv_pdf${ruta ? `: ${ruta}` : ""}).` };
  if (path.extname(ruta).toLowerCase() !== ".pdf") return { estado: "error", mensaje: "El CV debe ser PDF." };
  const tamano = fs.statSync(ruta).size;
  if (tamano > 10 * 1024 * 1024) return { estado: "error", mensaje: "El CV supera 10 MB." };
  const actual = (await leerPerfilMagneto()).cv?.fileName || null;
  if (!aplicar) return { estado: "plan", archivo: ruta, tamano_kb: Math.round(tamano / 1024), reemplaza: actual, mensaje: "Con aplicar=true sube el PDF (Magneto guarda uno solo y reemplaza el actual)." };

  const formulario = new FormData();
  formulario.append("file", new Blob([fs.readFileSync(ruta)], { type: "application/pdf" }), path.basename(ruta));
  await api("/sign-up/v1/candidate/upload-cv", { metodo: "PUT", formulario, auth: true });
  const p = await leerPerfilMagneto();
  return { estado: p.cv?.fileName ? "guardado" : "needs_review", cv: p.cv?.fileName || null };
}

/* ---------------------------------------------------------------- borrador del perfil maestro */

export async function borradorDesdeMagneto() {
  const v = await verMiPerfil();
  const p = await leerPerfilMagneto();
  return {
    datos_personales: { nombre: v.nombre, ciudad: v.ciudad || "", pais: "Colombia", correo: p.email || "", telefono: p.phone || "" },
    resumen: { es: v.descripcion || "" },
    experiencia: v.experiencia.map((e) => ({ empresa: e.empresa, cargo: e.cargo, inicio: e.inicio, fin: e.fin, logros_es: e.descripcion ? e.descripcion.split(/\n+/).map((l) => l.replace(/^[-•]\s*/, "")).filter(Boolean) : [] })),
    formacion: v.formacion.map((f) => ({ institucion: f.institucion, titulo_es: f.titulo, inicio: f.inicio, fin: f.fin, graduado: !f.en_curso })),
    idiomas: v.idiomas.map((i) => ({ idioma: i.idioma, nivel: i.nivel })),
    habilidades_clave: { tecnicas: v.habilidades.map((h) => h.nombre) },
    preferencias: {
      acepta_reubicacion: v.disponibilidad.reubicarse ?? undefined,
      salario_minimo_laboral_cop: p.salary || undefined,
    },
    pendientes_de_confirmar: ["Revisar fechas, logros, tecnologías y preferencias: Magneto no guarda todos los datos del estándar."],
  };
}
