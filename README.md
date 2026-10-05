# mcp-magneto

Servidor MCP para [Magneto](https://www.magneto365.com) (magneto365.com, Colombia). Con él puedes:

- Buscar ofertas, ver su detalle y evaluar si encajan con tu perfil.
- Responder el cuestionario de filtro y postular, una oferta a la vez y con tu confirmación explícita.
- Mantener tu hoja de vida al día a partir de un archivo único con tus datos: el **perfil maestro**.

Funciona con cualquier cuenta de candidato de Magneto. Ningún dato personal está escrito en el código: todo sale del perfil maestro o de la hoja de vida que ya tengas en Magneto.

> **Proyecto no oficial.** No está afiliado a Magneto ni respaldado por ella. Usa la API interna que consume su web, que puede cambiar sin aviso y romper alguna herramienta. Cada quien es responsable de usarlo de acuerdo con los términos de uso de Magneto. Las postulaciones son reales y no se pueden deshacer.

## Instalación

Requisitos: Node.js 20 o superior y un navegador basado en Chromium (Chrome, Edge, Brave o Chromium), que solo se usa para iniciar sesión.

```bash
git clone https://github.com/Jucamhc/mcp-magneto.git
cd mcp-magneto
npm install
```

Es autónomo: incluye el estándar del perfil maestro (`src/perfil-maestro.js`, `perfil-maestro.schema.json` y [`PERFIL-MAESTRO.md`](PERFIL-MAESTRO.md)). Los demás MCP de empleo traen la misma copia, así que todos comparten el mismo perfil.

Regístralo en tu cliente MCP (por ejemplo `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "magneto": {
      "command": "node",
      "args": ["/ruta/a/mcp-magneto/src/index.js"],
      "env": { "PERFIL_MAESTRO": "/ruta/a/mi/perfil-maestro.json" }
    }
  }
}
```

### Variables de entorno (todas opcionales)

| Variable | Por defecto | Para qué |
|---|---|---|
| `PERFIL_MAESTRO` | `~/.perfil-maestro/perfil-maestro.json` | Ruta de tu perfil maestro (la misma para todos los MCP) |
| `RAIZ_ARCHIVOS` | carpeta del perfil maestro | Base para las rutas relativas de `foto` y `cv_pdf` |
| `MAGNETO_DATA_DIR` | `~/.magneto` | Sesión (token), perfil del navegador y respaldos |
| `CHROME_PATH` | se detecta | Ruta del ejecutable del navegador si no está en la ubicación habitual |

La sesión y los respaldos quedan en `~/.magneto/`, fuera de carpetas sincronizadas. El MCP nunca muestra tokens, cookies ni credenciales.

## Primeros pasos

1. `iniciar-sesion`: abre el navegador en el login de Magneto. Entras a mano (código por correo, Google, Microsoft o LinkedIn) y el MCP guarda el token. El token dura 24 horas; como el navegador del MCP conserva tu sesión, volver a llamar a `iniciar-sesion` la renueva sola en unos segundos.
2. Si aún no tienes perfil maestro, `construir-perfil-maestro` te pide una fuente: la URL de tu LinkedIn, tu CV en PDF con tu foto, o lo que ya tienes en Magneto (`desde_portal: true`). Cuando lo apruebes, `guardar-perfil-maestro` lo valida y lo guarda.
3. `comparar-perfil`: muestra qué falta, qué está desactualizado y qué sobra en Magneto frente al perfil maestro.
4. `actualizar-perfil` por sección: primero sin `aplicar`, para ver el plan antes → después; luego con `aplicar: true`.

## Flujo de postulación

1. `buscar-ofertas` → `detalle-de-oferta` → `evaluar-encaje`.
2. `preguntas-de-postulacion`: indica si ya estás postulado y lista las preguntas del cuestionario de filtro (todas obligatorias).
3. `proponer-respuestas`: propone respuestas con el perfil maestro y las clasifica en `respaldada`, `requiere_confirmacion` o `sin_respaldo`. Las dos últimas se resuelven con el usuario: nunca se inventan.
4. `postular-a-oferta` con `confirmacion: "POSTULAR <id>"` y las respuestas aprobadas. En Magneto el cuestionario y la postulación van en la misma petición.

Estados de respuesta: `submitted`, `already_applied`, `needs_review` (cuestionario incompleto, datos extra exigidos o postulación que quedó como preseleccionada por perfil incompleto), `expired`, `sesion_expirada`, `limite_de_peticiones` y `error`.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `estado-de-sesion`, `iniciar-sesion` | Sesión |
| `buscar-ofertas`, `detalle-de-oferta` | Búsqueda (sin sesión; con sesión indica si ya te postulaste) |
| `evaluar-encaje` | Compara la oferta con tus preferencias (modalidad, salario según contrato, tecnologías declaradas e inglés) |
| `preguntas-de-postulacion`, `proponer-respuestas` | Lee el cuestionario de filtro y propone respuestas con datos del perfil maestro |
| `postular-a-oferta` | Exige `confirmacion: "POSTULAR <id>"`. Una a la vez, sin reintentos |
| `mis-postulaciones` | Tus procesos en Magneto |
| `construir-perfil-maestro`, `guardar-perfil-maestro`, `ver-perfil-maestro` | Herramientas estándar del perfil maestro |
| `ver-mi-perfil`, `comparar-perfil`, `actualizar-perfil` | Hoja de vida. Secciones: `descripcion`, `idiomas`, `habilidades`, `experiencia`, `formacion`, `certificaciones`, `preferencias` |
| `subir-foto`, `subir-cv`, `listar-mis-cv` | Foto y CV (Magneto guarda un solo CV) |

Las ofertas se identifican por id, slug (`desarrollador-backend-1088350`) o URL. Sin sesión, Magneto solo da el detalle con el slug.

Toda escritura respalda antes lo que había (en `~/.magneto/respaldos/`) y solo borra los ids que pases en `eliminar_ids`. La sección `preferencias` cambia cargo, salario mínimo, remoto, híbrido, viajar y cambio de domicilio; el resto del formulario (sector, nivel de estudios, ciudad, jornadas) se reenvía tal como está. Datos personales, ciudad de cada experiencia y "abierto a ofertas" se editan en la web.

## Perfil maestro

Campos que usa Magneto (ver `perfil-maestro.ejemplo.json`):

| Campo | Uso |
|---|---|
| `resumen.es` | Descripción del perfil (máx. 2.000 caracteres). Para fijar otra, usa `portales.magneto.descripcion` |
| `experiencia[]` | `empresa`, `cargo` (máx. 120), `inicio`/`fin` (`AAAA-MM`, `fin: null` = actual), `descripcion_empresa`, `logros_es[]`, `tecnologias[]` |
| `formacion[]` | `institucion`, `titulo_es`, `inicio`, `fin`, `graduado`, `nivel` opcional ("Universitaria", "Tecnológica", "Técnico", "Especialización"…). Sin `nivel`, el tipo de estudio se deduce del título; el país sale de `datos_personales.pais`. Los cursos van en `certificaciones` y los estudios sin terminar no se suben (Magneto no tiene ese estado) |
| `certificaciones[]` | `nombre`, `emisor`, `fecha` (`AAAA-MM`), `url` opcional |
| `habilidades_clave.tecnicas`, `aptitudes` | Habilidades (Magneto admite 10) |
| `idiomas[]` | `idioma` y `nivel` (Básico, Intermedio, Avanzado, Nativo) |
| `anios_experiencia` | `total` y años por área o herramienta (p. ej. `"react": "3"`, `"contabilidad": 3`, `"nomina": 2`) para responder cuestionarios |
| `preferencias` | `modalidad` ("Solo remoto", "Presencial", "Híbrido", "Remoto o híbrido"), `salario_minimo_laboral_cop`, `salario_minimo_prestacion_cop`, `acepta_reubicacion`, `puede_viajar` |
| `portales.magneto.cargo` | Cargo en el que buscas empleo (Preferencias de Magneto) |
| `respuestas_frecuentes` | Respuestas reutilizables: se proponen cuando su clave o su texto coinciden con la pregunta |
| `datos_personales.foto`, `cv_pdf` | Foto (JPG o PNG) y CV en PDF |

### Perfiles de cualquier área

El MCP no asume una profesión. Probado con perfiles de desarrollo, auxiliar contable (presencial) y ejecutivo comercial (híbrido):

- `buscar-ofertas` sin `modalidad` usa la del perfil: "Solo remoto" filtra remoto; presencial o híbrido sin reubicación busca en tu ciudad.
- `evaluar-encaje` revisa ciudad (presencial o híbrida en otra ciudad), salario según contrato, inglés y, si el perfil declara 3 o más tecnologías de software, el stack; en los demás perfiles busca tus habilidades y herramientas en la descripción.
- `proponer-respuestas` responde experiencia con tu cargo y tus años (y elige la opción de rango que corresponde, p. ej. "Más de 3 años"), compara mínimos en meses en preguntas sí/no, y usa tu formación y habilidades en preguntas de título o conocimientos. Lo que el perfil no sabe (vehículo, licencia, disponibilidad de turnos…) queda `sin_respaldo`; agrégalo en `respuestas_frecuentes` con claves de dos o más palabras (p. ej. `"licencia_conduccion": "Sí, B1 vigente"`).

Límite: solo Colombia (búsqueda en `C47`, salarios en COP).

## Referencia técnica

Magneto no tiene API pública para candidatos; la web usa `https://api.magneto365.com` con un JWT en `Authorization: Bearer` (cookie `access_token` de `.magneto365.com`, válida 24 h). Las lecturas se reintentan una vez si hay 429; los envíos nunca.

### Ofertas (`/jobs`)

| Uso | Endpoint |
|---|---|
| Búsqueda pública / con sesión | `GET /jobs/v1/public/jobs/search` / `GET /jobs/v1/jobs/search` |
| Detalle público (slug) / con sesión (id) | `GET /jobs/v1/public/jobs/<slug>` / `GET /jobs/v1/jobs/<id>` |
| Ubicaciones | `GET /jobs/v1/public/locations?term=&country_id=47` (Colombia: `C47`, ciudades `CT…`) |
| Cuestionario | `GET /jobs/v1/questionnaire/<id>` y `GET /jobs/v1/questionnaire/already-answered/<id>` |
| Postular | `POST /jobs/v1/jobs/apply` con `{jobId, suggestedByMatcher, sourceOrigins, utmPayload, questionnaires?}` |
| Mis procesos | `GET /jobs/v2/my-processes?page=` y `/jobs/v2/my-processes/counters` |
| Datos extra exigidos | `POST /sign-up-forms/v1/schema/apply` con `{id}` (ofertas con `templateId`) |

Parámetros de búsqueda: `paginator[page]`, `paginator[pageSize]` (20 o 30), `filters[locations][0]`, `filters[work_modality][0]` (`remote`, `hybrid`, `onSite`), `filters[contract_type_id][0]` (1 fijo, 2 indefinido, 3 temporal, 4 obra o labor, 5 prestación de servicios, 6 aprendizaje), `order[field]` (`_score` o `publish_date`), `queries[0][field]=all`, `queries[0][term]`.

Respuestas del cuestionario: `questionnaires: [{id, questions: [{id, type, openAnswer} | {id, type, answer: [{id, titleAnswer}]}]}]`. Tipos: 0 opción única, 1 opción múltiple, 2 texto corto (140), 3 texto largo (2.500). Si la respuesta trae `applicationId`, la postulación quedó enviada; si trae `level` y `missingFields`, quedó preseleccionada por perfil incompleto.

### Hoja de vida (`/sign-up`)

Lectura: `GET /sign-up/v2/candidate/profile`. Escritura: `PATCH /sign-up/v2/candidate` con `{...sección, step}` y la cabecera `x-schema-response: profile-v2`.

| Sección | `step` | Cuerpo |
|---|---|---|
| Descripción | 15 | `{profileDescription}` |
| Habilidades | 16 | `{skills: [{id?, name, level}]}` (lista completa) |
| Foto | 19 | `{profileImageFileName, originalFileName}` |
| Idiomas | 20 | `{languages: [{id?, languageId, name, level}]}` (lista completa; catálogo en `/sign-up/v1/languages`) |
| Experiencia | 37 / borrar 63 | `{experiences: [{id?, position, company, description, atPresent, startDate, endDate}]}`; borrar añade `clearSection: "experiences"` |
| Preferencias | 47 | `{titleOrProfession, salary, currencyPayId, salaryFrequencyId, candidateSectors, educationLevelId, workCityId, availableTo{Move,RemoteWork,Travel,HybridWork}, internshipType, candidateJourneys}`; enviar `disability` solo si existe (con `null` responde 502) |
| Certificaciones | 60 / borrar 67 | `{certifications: [{id?, name, institution, expeditionDate, credentialUrl?, attachmentUrl?}]}`; borrar añade `clearSection: "certifications"` |
| Redes y enlaces / hobbies | 24 / 25 | `{socialMediaLinks}` / `{hobbies}` (no usados por el MCP) |
| Formación | 76 / borrar 77 | `{studies: [{id?, institute, profession, title, inProgress, startDate, endDate, studyType, countryId}]}`; `studyType` es un id de `/sign-up/v1/education/levels` y `countryId` de `/sign-up/v1/countries/active`. Sin ambos, Magneto deja las postulaciones como preaplicación (`missingFields: studies:<id>`). Borrar añade `clearSection: "studies"` |

Niveles de idiomas y habilidades: 1 básico, 2 intermedio, 3 avanzado, 4 profesional o nativo. Fechas `AAAA-MM-DD`. CV: `PUT /sign-up/v1/candidate/upload-cv` (multipart, campo `file`).

## Pendiente de verificar

- La subida de foto sale del código de la web, pero aún no se ha probado contra una cuenta real (el CV y las secciones de la hoja de vida sí).
- Ofertas con `templateId` (datos extra del registro), preguntas de opción múltiple y de texto largo.
- Borrar experiencias, estudios o certificaciones (`eliminar_ids`).
