import { cargarPerfilMaestro } from "./perfil-maestro.js";
import { detalleDeOferta, preguntasDePostulacion } from "./ofertas.js";

const normalizar = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// Catálogo genérico de tecnologías y sus variantes en las ofertas. Las que aparecen en el perfil
// maestro cuentan como propias; el resto, como ajenas.
const TECNOLOGIAS = {
  React: /\breact(\.?js)?\b(?!\s*native)/,
  "React Native": /react\s*native/,
  "Vue.js": /\bvue(\.?js)?\b/,
  Angular: /\bangular\b(?!\s*js)/,
  AngularJS: /angular\s*js/,
  "Next.js": /\bnext\.?js\b/,
  Svelte: /\bsvelte\b/,
  TypeScript: /typescript|\bts\b/,
  JavaScript: /javascript|\bjs\b|es6/,
  "Node.js": /node(\.?js)?\b/,
  NestJS: /nest(\.?js)?\b/,
  Express: /\bexpress(\.?js)?\b/,
  PHP: /\bphp\b/,
  Laravel: /laravel/,
  Symfony: /symfony/,
  Yii: /\byii\b/,
  WordPress: /wordpress/,
  Expo: /\bexpo\b/,
  Java: /\bjava\b(?!\s*script)|spring/,
  ".NET / C#": /\.net|c#|csharp|asp\.net/,
  Python: /python|django|flask|fastapi/,
  Go: /\bgolang\b|\bgo\b(?=\s*(lang|developer|backend))/,
  "Flutter / Dart": /flutter|\bdart\b/,
  Kotlin: /kotlin/,
  Swift: /\bswift\b|ios nativo/,
  Ruby: /\bruby\b|rails/,
  Scala: /\bscala\b/,
  Rust: /\brust\b/,
  "C / C++": /\bc\+\+|\bc\b(?=\s*(y|and)\s*c\+\+)/,
  COBOL: /cobol|\bhost\b|mainframe|as\/?400/,
  "Salesforce / Apex": /salesforce|\bapex\b/,
  "SAP / ABAP": /\bsap\b|abap/,
  Solidity: /solidity|blockchain/,
  "Delphi / Visual Basic / Progress": /delphi|visual basic|\bprogress\b|\bvb6\b/,
  "Oracle Commerce": /oracle commerce|\bosf\b|\batg\b/,
  MySQL: /mysql/,
  PostgreSQL: /postgres/,
  "SQL Server": /sql server|t-?sql/,
  Oracle: /\boracle\b(?!\s*commerce)/,
  MongoDB: /mongo/,
  Redis: /\bredis\b/,
  "APIs REST": /\brest(ful)?\b|\bapis?\b/,
  GraphQL: /graphql/,
  Docker: /docker/,
  Kubernetes: /kubernetes|\bk8s\b/,
  AWS: /\baws\b|amazon web services/,
  Azure: /\bazure\b/,
  GCP: /\bgcp\b|google cloud/,
  Git: /\bgit\b|github|gitlab/,
  Linux: /linux/,
  "IA / LLM": /\bia\b|inteligencia artificial|\bllm|openai|claude|cursor|\bmcp\b/,
  Scrum: /scrum|agil/,
};

// Aparecen en casi cualquier oferta técnica: no definen el eje del cargo.
const GENERICAS = ["APIs REST", "Git", "Scrum", "JavaScript", "IA / LLM"];

const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Términos que el perfil maestro declara (aptitudes, tecnologías por experiencia y habilidades técnicas). */
function terminosDelPerfil(perfil) {
  const terminos = [
    ...Object.values(perfil.aptitudes || {}).flat(),
    ...(perfil.experiencia || []).flatMap((e) => e.tecnologias || []),
    ...(perfil.habilidades_clave?.tecnicas || []),
  ];
  return [...new Set(terminos.filter(Boolean).map(String))];
}

function clasificarTecnologias(perfil) {
  const terminos = terminosDelPerfil(perfil).map(normalizar);
  const propias = {};
  const ajenas = {};
  for (const [nombre, re] of Object.entries(TECNOLOGIAS)) {
    const declarada = terminos.some((t) => t === normalizar(nombre) || re.test(t));
    (declarada ? propias : ajenas)[nombre] = re;
  }
  // Términos cortos del perfil que el catálogo no conoce (p. ej. "Odoo", "Power BI").
  for (const t of terminos) {
    if (t.split(/\s+/).length > 2 || Object.values(propias).some((re) => re.test(t))) continue;
    propias[t] = new RegExp(`(^|[^a-z0-9])${escapar(t)}($|[^a-z0-9])`);
  }
  return { propias, ajenas };
}

const INGLES_ALTO = /bilingue|ingles (avanzado|fluido|c1|b2)|english (advanced|fluent)|\bb2\b|\bc1\b|\bc2\b|100% ingles|nivel avanzado de ingles/;
const NIVEL_INGLES_ALTO = /avanzado|nativo|bilingue|fluido|\bc1\b|\bc2\b/;

export async function evaluarEncaje(oferta) {
  const o = await detalleDeOferta(oferta);
  if (o.estado) return o;
  const perfil = cargarPerfilMaestro();
  const pref = perfil.preferencias || {};
  const titulo = normalizar(o.titulo);
  const texto = normalizar(`${o.titulo}\n${o.descripcion}\n${(o.habilidades || []).join(", ")}`);

  const motivos = [];
  let veredicto = "encaja";
  const bajar = (a) => {
    if (a === "no_encaja" || (a === "encaja_parcial" && veredicto === "encaja")) veredicto = a;
  };

  // Modalidad: Magneto no la publica por oferta, se infiere del texto.
  if (/solo remoto/i.test(pref.modalidad || "")) {
    if (/^(presencial|h[ií]brido)$/i.test(o.modalidad)) {
      bajar("no_encaja");
      motivos.push(`Modalidad ${o.modalidad} en ${o.ciudad || "ciudad no indicada"}; solo buscas remoto.`);
    } else if (!/^remoto$/i.test(o.modalidad)) {
      bajar("encaja_parcial");
      motivos.push(`La oferta no aclara si es remota o híbrida (${o.ciudad || "sin ciudad"}): confírmalo.`);
    } else if (/asistir a (la )?oficina|vivir en|residir en|residencia en|area metropolitana/.test(texto)) {
      bajar("encaja_parcial");
      motivos.push("Es remota, pero la descripción menciona presencialidad o residencia en una ciudad: confírmalo.");
    }
  }

  // Salario según el tipo de contrato
  const prestacion = /prestaci/i.test(o.contrato || "");
  const minimoCop = prestacion ? pref.salario_minimo_prestacion_cop ?? pref.salario_minimo_laboral_cop : pref.salario_minimo_laboral_cop;
  if (minimoCop) {
    const minimo = minimoCop / 1e6;
    const tipo = prestacion ? "prestación de servicios" : "contrato laboral";
    const rango = o.rango_salario_millones;
    if (!rango) {
      motivos.push(`Salario a convenir; tu mínimo para ${tipo} es $${minimo} millones.`);
      bajar("encaja_parcial");
    } else if (rango[1] < minimo) {
      bajar("no_encaja");
      motivos.push(`Salario ${o.salario}, por debajo de tu mínimo de $${minimo} millones (${tipo}).`);
    } else if (rango[0] < minimo) {
      bajar("encaja_parcial");
      motivos.push(`Salario ${o.salario}: el rango toca tu mínimo de $${minimo} millones; negociable.`);
    }
  }

  // Stack (solo si el perfil declara tecnologías del catálogo)
  const { propias, ajenas } = clasificarTecnologias(perfil);
  const coincidencias = Object.entries(propias).filter(([, re]) => re.test(texto)).map(([n]) => n);
  const perfilTecnico = Object.keys(propias).some((n) => n in TECNOLOGIAS && !GENERICAS.includes(n));
  if (perfilTecnico) {
    const ajenasTitulo = Object.entries(ajenas).filter(([, re]) => re.test(titulo)).map(([n]) => n);
    const ajenasTexto = Object.entries(ajenas).filter(([, re]) => re.test(texto)).map(([n]) => n);
    const propiasTitulo = Object.entries(propias)
      .filter(([n, re]) => !GENERICAS.includes(n) && re.test(titulo))
      .map(([n]) => n);
    if (ajenasTitulo.length && !propiasTitulo.length) {
      bajar("no_encaja");
      motivos.push(`El cargo se centra en ${ajenasTitulo.join(", ")}, que no está en tu perfil.`);
    } else if (ajenasTitulo.length) {
      bajar("encaja_parcial");
      motivos.push(`El cargo combina ${propiasTitulo.join(", ")} con ${ajenasTitulo.join(", ")}, que no está en tu perfil.`);
    } else if (ajenasTexto.length) {
      bajar("encaja_parcial");
      motivos.push(`La descripción pide también ${ajenasTexto.join(", ")}, que no está en tu perfil.`);
    }
    if (!coincidencias.filter((c) => !GENERICAS.includes(c)).length) {
      bajar("encaja_parcial");
      motivos.push("No encontré tecnologías principales de tu perfil en la descripción.");
    }
  }

  // Inglés
  if (INGLES_ALTO.test(texto)) {
    const ingles = (perfil.idiomas || []).find((i) => /ingl|english/i.test(i.idioma || ""));
    if (!ingles) {
      bajar("encaja_parcial");
      motivos.push("Pide inglés avanzado o bilingüe y tu perfil maestro no declara inglés.");
    } else if (!NIVEL_INGLES_ALTO.test(normalizar(ingles.nivel))) {
      bajar("encaja_parcial");
      motivos.push(`Pide inglés avanzado o bilingüe; tu nivel declarado es ${ingles.nivel}.`);
    }
  }

  return {
    id: o.id,
    slug: o.slug,
    titulo: o.titulo,
    empresa: o.empresa,
    veredicto,
    motivos,
    coincidencias,
    modalidad: o.modalidad,
    ciudad: o.ciudad,
    salario: o.salario,
    contrato: o.contrato,
    tiene_cuestionario: o.tiene_cuestionario,
    url: o.url,
  };
}

/* ---------------------------------------------------------------- respuestas al cuestionario */

const PALABRAS_VACIAS = new Set("de la el los las un una y o en con por para que tu tus su sus como cual cuál cuanto cuánto tienes tiene es al del se lo".split(" "));
const palabras = (t) => normalizar(t).split(/[^a-z0-9]+/).filter((p) => p.length > 2 && !PALABRAS_VACIAS.has(p));

/** Respuesta frecuente del perfil cuya clave o texto comparte más palabras con la pregunta. */
function respuestaFrecuente(perfil, pregunta) {
  const objetivo = new Set(palabras(pregunta));
  let mejor = null;
  for (const [clave, valor] of Object.entries(perfil.respuestas_frecuentes || {})) {
    const delaClave = palabras(clave.replace(/_/g, " "));
    const coinciden = delaClave.filter((p) => objetivo.has(p)).length;
    if (coinciden < Math.min(2, delaClave.length)) continue;
    const puntos = coinciden * 2 + palabras(valor).filter((p) => objetivo.has(p)).length * 0.25;
    if (!mejor || puntos > mejor.puntos) mejor = { clave, valor, puntos };
  }
  return mejor;
}

function salarioPropuesto(perfil, contrato) {
  const pref = perfil.preferencias || {};
  const prestacion = /prestaci/i.test(contrato || "");
  const cop = prestacion ? pref.salario_minimo_prestacion_cop ?? pref.salario_minimo_laboral_cop : pref.salario_minimo_laboral_cop;
  return cop ? `$${cop.toLocaleString("es-CO")} COP mensuales${prestacion ? " (prestación de servicios)" : ""}` : "";
}

function proponerUna(p, perfil, oferta, tecnologias) {
  const q = normalizar(p.pregunta);
  const dp = perfil.datos_personales || {};
  const pref = perfil.preferencias || {};
  const anios = perfil.anios_experiencia || {};
  const frecuente = respuestaFrecuente(perfil, p.pregunta);
  const resultado = (respuesta, clasificacion, fuente) => ({ respuesta, clasificacion, fuente });

  if (/salari|aspiracion|expectativa|pretension|remuneracion/.test(q)) {
    return resultado(salarioPropuesto(perfil, oferta.contrato), "requiere_confirmacion", "preferencias del perfil maestro (salario mínimo)");
  }
  if (/ingles|english/.test(q)) {
    const ingles = (perfil.idiomas || []).find((i) => /ingl|english/i.test(i.idioma || ""));
    return ingles
      ? resultado(`Inglés ${ingles.nivel}${ingles.nota ? `: ${ingles.nota}` : ""}.`, "respaldada", "idiomas del perfil maestro")
      : resultado("", "sin_respaldo", "El perfil maestro no declara inglés.");
  }
  if (/vives|resides|residencia|ciudad|ubicad|hibrid|presencial|traslad|reubic|desplaz/.test(q)) {
    const partes = [
      dp.ciudad ? `Vivo en ${dp.ciudad}${dp.pais ? `, ${dp.pais}` : ""}.` : "",
      pref.modalidad ? `Busco modalidad ${pref.modalidad.toLowerCase()}.` : "",
      pref.acepta_reubicacion === false ? "No tengo disponibilidad para reubicarme." : pref.acepta_reubicacion ? "Tengo disponibilidad para reubicarme." : "",
    ].filter(Boolean);
    return resultado(frecuente?.valor || partes.join(" "), "requiere_confirmacion", frecuente ? `respuestas_frecuentes.${frecuente.clave}` : "datos personales y preferencias");
  }
  if (/experi|\banos\b|años/.test(q)) {
    const enPregunta = Object.entries(TECNOLOGIAS)
      .filter(([n, re]) => !GENERICAS.includes(n) && re.test(q))
      .map(([n]) => n);
    const total = anios.desarrollo_total || anios.total;
    const general = total ? `${total} años de experiencia en desarrollo de software${anios.infraestructura_ti ? `, además de ${anios.infraestructura_ti} años en infraestructura TI` : ""}.` : "";
    if (!enPregunta.length) return resultado(general, general ? "respaldada" : "sin_respaldo", "anios_experiencia del perfil maestro");

    const propiasEnPregunta = enPregunta.filter((n) => n in tecnologias.propias);
    const ajenasEnPregunta = enPregunta.filter((n) => !(n in tecnologias.propias));
    // Claves específicas de anios_experiencia (p. ej. "react": "3", "node_nestjs": "2-3") que coinciden con la pregunta.
    const especificas = Object.entries(anios).filter(
      ([clave]) => !/^(desarrollo_total|total|infraestructura_ti)$/.test(clave) && clave.split("_").some((p) => p.length > 1 && new RegExp(`\\b${escapar(p)}`).test(q))
    );
    if (!propiasEnPregunta.length) {
      return resultado("", "sin_respaldo", `El perfil maestro no declara ${ajenasEnPregunta.join(", ")}: pregúntale al usuario, no lo supongas.`);
    }
    const texto = especificas.length
      ? `${especificas.map(([, v]) => v)[0]} años con ${propiasEnPregunta.join(" y ")}.`
      : general;
    const nota = ajenasEnPregunta.length ? ` También pregunta por ${ajenasEnPregunta.join(", ")}, que el perfil no declara.` : "";
    return resultado(texto, "requiere_confirmacion", `${especificas.length ? "anios_experiencia" : "Solo hay años totales"}; confirma los años con ${propiasEnPregunta.join(", ")}.${nota}`);
  }
  if (frecuente) return resultado(frecuente.valor, "respaldada", `respuestas_frecuentes.${frecuente.clave}`);
  return resultado("", "sin_respaldo", "No hay datos en el perfil maestro para responderla: pregúntale al usuario.");
}

/** Propone respuestas para el cuestionario de filtro a partir del perfil maestro. Nunca envía nada. */
export async function proponerRespuestas(oferta) {
  const evaluacion = await evaluarEncaje(oferta);
  if (evaluacion.estado) return evaluacion;
  const formulario = await preguntasDePostulacion(evaluacion.id);
  if (formulario.estado !== "listo") return { ...formulario, veredicto: evaluacion.veredicto, motivos: evaluacion.motivos };
  const perfil = cargarPerfilMaestro();
  const tecnologias = clasificarTecnologias(perfil);

  const respuestas = formulario.preguntas.map((p) => {
    const propuesta = proponerUna(p, perfil, evaluacion, tecnologias);
    let respuesta = propuesta.respuesta;
    if (p.max_caracteres && respuesta.length > p.max_caracteres) respuesta = respuesta.slice(0, p.max_caracteres - 1).trimEnd() + "…";
    if (p.opciones) {
      const elegida = p.opciones.find((o) => respuesta && normalizar(respuesta).includes(normalizar(o.texto)));
      respuesta = elegida ? elegida.texto : "";
      if (!elegida) propuesta.clasificacion = "requiere_confirmacion";
    }
    return {
      pregunta_id: p.pregunta_id,
      pregunta: p.pregunta,
      tipo: p.tipo,
      ...(p.opciones ? { opciones: p.opciones.map((o) => o.texto) } : {}),
      ...(p.max_caracteres ? { max_caracteres: p.max_caracteres } : {}),
      respuesta,
      clasificacion: propuesta.clasificacion,
      fuente: propuesta.fuente,
    };
  });

  return {
    id: evaluacion.id,
    titulo: evaluacion.titulo,
    empresa: evaluacion.empresa,
    veredicto: evaluacion.veredicto,
    motivos: evaluacion.motivos,
    tipo: formulario.tipo,
    respuestas,
    aviso:
      "Clasificación: respaldada (sale del perfil maestro), requiere_confirmacion (el usuario debe validarla) o sin_respaldo (falta el dato: pregúntalo, no lo inventes). Nada se envía sin la confirmación del usuario.",
  };
}
