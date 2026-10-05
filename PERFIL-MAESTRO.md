# Estándar del perfil maestro (versión 1)

El perfil maestro es un archivo JSON con todos los datos de una persona que busca empleo. Es la única fuente de verdad para todos los MCP de portales de empleo (elempleo, Computrabajo, InfoJobs…): los MCP leen de ahí, comparan con el portal y actualizan el portal. Nunca inventan datos.

## Dónde vive

| Qué | Valor |
|---|---|
| Archivo | `~/.perfil-maestro/perfil-maestro.json` |
| Otra ubicación | variable de entorno `PERFIL_MAESTRO` (la misma en todos los MCP) |
| Foto y CV | rutas relativas a la carpeta del perfil (o `RAIZ_ARCHIVOS`) |
| Esquema | `perfil-maestro.schema.json` (JSON Schema 2020-12), incluido en cada MCP |

Los MCP se instalan por separado, así que no hay un paquete común: **cada MCP incluye una copia idéntica** de `src/perfil-maestro.js`, `perfil-maestro.schema.json` y este documento. Como todos leen el mismo archivo y siguen el mismo esquema, cualquiera puede crear el perfil y los demás lo usan.

Al guardar se añade `"$schema"` con la ruta del esquema, así los editores validan y autocompletan el archivo.

## Cómo se crea

Cuando no existe, cualquier MCP ofrece `construir-perfil-maestro`:

1. **Sin argumentos**, responde `requiere_fuente` y dice qué pedirle al usuario:
   - la URL de su LinkedIn, o
   - su CV en PDF y su foto, o
   - un borrador con lo que ya tiene en el portal (si el MCP lo ofrece).
2. **Con la URL de LinkedIn**, responde `requiere_pdf_de_linkedin`: LinkedIn no permite leer perfiles de forma automática, así que explica cómo exportar el perfil con "Más → Guardar en PDF". Si el asistente tiene otra herramienta que ya leyó el perfil, puede pasar ese contenido en `texto`.
3. **Con PDF(s) y foto**, responde `estructurar` con el texto extraído, este esquema y las reglas. El asistente arma el JSON y se lo muestra al usuario.
4. **`guardar-perfil-maestro`** valida contra el esquema, copia la foto (`foto.jpg`) y el CV (`cv/…`) junto al perfil y lo guarda. No sobrescribe salvo con `sobrescribir: true`, y en ese caso respalda el anterior en `respaldos/`.

`ver-perfil-maestro` muestra el perfil, si es válido y qué queda pendiente.

## Reglas para los datos

- Solo datos de las fuentes o confirmados por el usuario. Lo dudoso va a `pendientes_de_confirmar`.
- Fechas `AAAA-MM` (o `AAAA`). Empleo actual: `fin: null`.
- `mostrar_en_cv: false` marca estudios que el usuario no quiere mostrar; los MCP no los publican, pero tampoco los borran sin permiso.
- `seguridad_social` y los salarios solo los da el usuario; nunca se suponen.

## Campos

Campos obligatorios: `version` (1) y `datos_personales.nombre`. Los demás son opcionales; cada MCP usa los que necesita.

| Campo | Contenido |
|---|---|
| `datos_personales` | `nombre`, `ciudad`, `pais`, `zona_horaria`, `telefono`, `correo`, `linkedin`, `github`, `portafolio`, `foto` |
| `titular`, `resumen` | Texto por idioma: `{ "es": "...", "en": "..." }` |
| `profesion` | Profesión principal |
| `experiencia[]` | `empresa`, `cargo`, `cargo_oficial`, `inicio`, `fin`, `modalidad`, `ubicacion`, `descripcion_empresa`, `logros_es[]`, `tecnologias[]` |
| `formacion[]` | `institucion`, `titulo_es`, `nivel`, `inicio`, `fin`, `graduado`, `mostrar_en_cv`, `ciudad` |
| `certificaciones[]` | `nombre`, `emisor`, `fecha` |
| `aptitudes` | Grupos libres: `{ "backend": ["PHP", "Laravel"] }` |
| `habilidades_clave` | `tecnicas[]` y `blandas[]` (máx. 40 caracteres cada una) |
| `idiomas[]` | `idioma`, `nivel` (Nativo, Básico, Intermedio, Avanzado) |
| `preferencias` | `modalidad`, `acepta_reubicacion`, `puede_viajar`, `paises`, `salario_minimo_laboral_cop`, `salario_minimo_prestacion_cop`, `tipos_contrato`, `disponibilidad` |
| `seguridad_social` | `pension_obligatoria`, `cesantias`, `pension_voluntaria`, `eps`, `caja_compensacion` |
| `cv_pdf` | Ruta, o `{ "version": "ruta" }` |
| `respuestas_frecuentes` | Respuestas reutilizables para preguntas de postulación |
| `pendientes_de_confirmar[]` | Lo que falta confirmar con el usuario |

## Datos propios de un portal: `portales.<id>`

Lo que solo sirve para un portal (nombres exactos de sus catálogos, ids, ajustes) va bajo `portales`, con el id del portal como clave, en la raíz o dentro de cada entrada:

```json
"experiencia": [{
  "empresa": "Empresa Ejemplo",
  "cargo": "Analista de datos",
  "portales": { "elempleo": { "cargo_equivalente": "Analista de datos", "sector": "Comercio al por menor" } }
}],
"portales": { "elempleo": { "area_cursos": "Computación y Nuevas Tecnologías" } }
```

Cada MCP lee y escribe **solo su propia clave**, y no borra las de otros.

## Cómo lo usa un MCP nuevo

1. Copia sin cambios `src/perfil-maestro.js`, `perfil-maestro.schema.json` y `PERFIL-MAESTRO.md` desde un MCP existente (por ejemplo elempleo).
2. Agrega sus dependencias: `ajv` (validación) y `unpdf` (texto de los PDF).
3. Úsalo así:

```js
import { cargarPerfilMaestro, resolverArchivo, datoDePortal, registrarHerramientasPerfilMaestro } from "./perfil-maestro.js";

registrarHerramientasPerfilMaestro(servidor, { z, portal: "miportal", borradorDesdePortal });
const perfil = cargarPerfilMaestro();          // si no existe, el error explica cómo crearlo
const foto = resolverArchivo(perfil.datos_personales.foto);
const sector = datoDePortal(perfil.experiencia[0], "miportal", "sector");
```

Si el perfil no existe, `cargarPerfilMaestro()` lanza un error con `estado: "sin_perfil_maestro"` y un mensaje que pide la URL de LinkedIn o el CV en PDF y la foto.

## Versiones

`version` cambia solo si un cambio rompe la compatibilidad. Añadir campos opcionales no cambia la versión. Cuando cambies el módulo o el esquema en un MCP, copia el cambio en todos los demás para que sigan idénticos.
