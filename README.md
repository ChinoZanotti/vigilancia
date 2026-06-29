# Vigilancia de Marcas — DINAPI

Herramienta web para agentes de registro de marcas en Paraguay. Compara una cartera de marcas contra los boletines de **Marcas Recibidas** que publica la DINAPI y detecta posibles similitudes (fonéticas y ortográficas), priorizando los casos de mayor riesgo para su revisión.

> **Estado:** Prototipo (MVP). Esta versión corre íntegramente en el navegador y existe para **validar la lógica de cotejo** con datos reales antes de construir el producto completo. No requiere base de datos ni servidor.

---

## ¿Qué hace?

1. Cargás tu cartera de marcas (denominación y, opcionalmente, la clase Niza).
2. Subís el archivo CSV de un boletín de la DINAPI, tal cual se descarga.
3. La herramienta compara cada una de tus marcas contra todas las del boletín y muestra las coincidencias ordenadas por nivel de riesgo (**Alta / Media / Baja**), con el expediente, el titular, el trámite y el motivo de cada coincidencia.

Podés ajustar el umbral de sensibilidad, filtrar por misma clase Niza y descargar los resultados en CSV.

---

## ¿Cómo funciona el cotejo?

Cada denominación se **normaliza** (mayúsculas, sin acentos ni puntuación) y se compara con tres criterios. El puntaje final (0–100) toma la señal más fuerte:

- **Similitud ortográfica** — algoritmos Jaro-Winkler y Levenshtein sobre el texto.
- **Similitud fonética en español** — una clave fonética que asimila las confusiones típicas del idioma: `b/v`, `c/s/z`, `g/j`, `ll/y`, `h` muda, `qu/k` y letras dobles. Así, por ejemplo, *BIOTERM* coincide con *BIOTHERM* y *RIVAN* con *RIBAN*.
- **Palabra clave y contención** — detecta cuando una denominación contiene a la otra como término distintivo.

Las marcas puramente **figurativas** (sin texto) se omiten, ya que no hay denominación que cotejar.

> Los resultados son **sugerencias para revisión humana**, no determinaciones legales. La decisión sobre una eventual oposición siempre queda a criterio del agente o abogado.

---

## Stack tecnológico

| | Tecnología |
|---|---|
| **Versión actual (MVP)** | React + Vite + Tailwind CSS (todo en el navegador) |
| **Producción (planificado)** | React (frontend) · Node + Express (backend) · PostgreSQL (datos) |

El motor de comparación está aislado de la interfaz, de modo que la misma lógica que hoy corre en el navegador se trasladará luego al backend Node/Express sin reescribirse.

---

## Requisitos

- [Node.js](https://nodejs.org) 18 o superior (verificá con `node -v`)
- npm (incluido con Node)

---

## Instalación y ejecución local

```bash
# 1. Clonar el repositorio
git clone https://github.com/USUARIO/NOMBRE-DEL-REPO.git
cd NOMBRE-DEL-REPO

# 2. Instalar dependencias
npm install

# 3. Levantar el servidor de desarrollo
npm run dev
```

Luego abrí el navegador en `http://localhost:5173`.

---

## Uso

1. **Mis marcas** — Pegá tus marcas, una por línea, con el formato `DENOMINACIÓN | CLASE` (la clase es opcional). También podés usar el botón **Cargar ejemplo** para una prueba rápida.
2. **Boletín DINAPI** — Subí el archivo `.csv` de "Marcas Recibidas".
3. Ajustá el **umbral de alerta** (recomendado: 70) y, si querés, activá **Solo misma clase Niza**.
4. Presioná **Comparar**. Revisá la tabla de coincidencias y, si lo necesitás, descargala en CSV.

### Formato esperado del boletín

El CSV de la DINAPI incluye filas de metadatos al inicio y luego un encabezado con estas columnas, que la herramienta detecta automáticamente:

```
Fecha Solicitud, Expediente, Clase Niza, Denominación, Signo, Titular, País, Agente, Matrícula, Trámite, Referencia
```

---

## Limitaciones conocidas

- Las marcas figurativas (sin denominación) no se comparan.
- El cotejo es textual y fonético; aún no considera similitud gráfica/visual de logos.
- Toda la lógica corre en el navegador: la cartera y el boletín no se guardan al recargar (es intencional para esta etapa de prueba).

---

## Roadmap

- [ ] Persistencia de la cartera de marcas y de las alertas (PostgreSQL).
- [ ] Backend Node/Express con el motor de cotejo como servicio.
- [ ] Estados de alerta (revisada / a oponer / descartada) y seguimiento de plazos.
- [ ] Ingesta automática de boletines.
- [ ] Notificaciones por correo.
- [ ] Ajuste fino del algoritmo con retroalimentación de uso real (términos genéricos a ignorar, ponderación por clase Niza).

---

## Licencia

Uso interno / privado. Definir según corresponda.