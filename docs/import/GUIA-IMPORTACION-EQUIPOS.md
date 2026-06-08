# Guía de importación de equipos (CSV)

Esta carpeta define **el único formato aceptado** para entregar inventario de equipos
a bukowskiOS. A partir de ahora, las relaciones de equipos **no se entregan en PDF,
Word ni capturas**: se llenan sobre la plantilla `plantilla-equipos.csv`, que está
mapeada y probada **1:1** contra el importador de la app (Equipos → Importar CSV).

> Por qué: un PDF hay que volver a teclearlo a mano, se presta a errores y no se puede
> auditar. La plantilla entra directo al sistema, conserva seriales y observaciones, y
> deja trazabilidad.

---

## 1. Cómo importar

1. Abrir **Equipos** en bukowskiOS.
2. Botón **Importar CSV** → seleccionar el archivo.
3. Revisar la **vista previa**: la app muestra cuántas filas se reconocieron, qué
   categorías/ubicaciones no encontró y qué valores corrigió. Nada se guarda hasta
   confirmar.
4. Confirmar.

El importador es tolerante con los encabezados: reconoce los nombres de columna de la
tabla de abajo **y** sus alias en español. No es sensible a mayúsculas ni a acentos en
los encabezados.

---

## 2. Columnas

`name` y `code` son **obligatorias**. El resto es opcional pero recomendado.

| Columna | ¿Obligatoria? | Qué es | Valores aceptados |
|---|---|---|---|
| `name` | **Sí** | Nombre del equipo | Texto libre. Ej: `SMALLHD CINE 24"` |
| `code` | **Sí** | Código interno / inventario. **Único por fila** | Texto/número. Ej: `1007` |
| `category` | No | Categoría | **Código** del catálogo (recomendado, ej. `MON`) o el nombre exacto. Si no coincide, cae en la categoría por defecto y se avisa en la vista previa. Ver tabla de códigos en §2.1 |
| `brand` | No | Marca | Texto. Ej: `SMALLHD` |
| `model` | No | Modelo | Texto. Ej: `CINE 24"` |
| `serial` | No | Número de serie | Texto. Ej: `24DS221670029` |
| `condition` | No | Estado físico | `Good`, `Review`, `Damaged` (cualquier otro valor → `Review`). Por defecto `Good` |
| `quantity` | No | Cantidad de unidades idénticas | Número entero. Por defecto `1` |
| `ownership` | No | Propiedad | `owned`, `rented`, … Por defecto `owned` |
| `location` | No | Ubicación por defecto | Debe coincidir con una ubicación del catálogo; si no, se conserva como nota |
| `warehouse` | No | Posición en almacén | Texto libre (ej. `Estante A-3`). Si la ubicación no existe, se preserva en notas |
| `qr` | No | Valor de QR / código de barras | Texto |
| `description` | No | Descripción | Texto libre |
| `notes` | No | Nota externa / observaciones | Texto libre |
| `purchasePrice` | No | Precio de compra | Número. Ej: `4500` |
| `replacementValue` | No | Valor de reposición | Número |
| `currentBookValue` | No | Valor actual en libros | Número |

**Reglas de formato**
- Codificación **UTF-8**, separador **coma** (`,`).
- Si un valor lleva comas o comillas, enciérralo en comillas dobles. Las comillas
  internas se duplican: `SMALLHD CINE 24"` → `"SMALLHD CINE 24"""`.
- Una fila por activo. Si tienes 5 unidades idénticas sin serial individual, usa **una
  fila con `quantity: 5`**. Si cada unidad tiene serial propio, usa **una fila por serial**.
- `code` debe ser único. Si dos unidades comparten código de *case* en papel, diferéncialos
  (`1265-2`, `1265-3`) y anota el código compartido en `notes`.

### 2.1. Códigos de categoría del catálogo

Usa el **código** (columna izquierda) en la columna `category`. Es lo que la app empareja
de forma más segura. También aparecen en el desplegable de categoría dentro de la app.

| Código | Categoría | Código | Categoría | Código | Categoría |
|---|---|---|---|---|---|
| `ACC` | Accesories | `HDMI` | HDMI | `RIG` | Rigs |
| `ADP` / `ADT` | Adapters | `HD` | Hard Drives | `ROUT` | Routers and Network |
| `BNC` | BNC Cables | `HUB` | Hubs | `SOUND` | Sound |
| `BAG` | Bags | `IO` | I/O Device | `STR` | Stream Devices |
| `BATT` / `BAT` | Batteries | `LTO` | LTO | `WB` | Tables |
| `CAM` | Cameras | `LENS` | Lenses | `TAB` | Tablets |
| `READ` | Card Reader | `LITE` | Lighting | `TOOL` | Tools |
| `CAR` | Carts | `CARE` | Maintenance Supply | `UPS` | UPS |
| `CAS` | Cases | `MON` | Monitor | `SIG` | Video Signal |
| `CACC` | Color Accesories | `NEC` | Network Cables | | |
| `COM` | Computers | `POW` | Power AC | | |
| `DAC` | Data Cables | `EXP` | Expendables | | |

---

## 3. Conversión de junio 2026 (inventario de Daniel de la Cruz)

El PDF `INVENTARIO EQUIPOS METADATA_JUNIO 2026_DLC.pdf` se convirtió a:

- **`inventario_metadata_junio2026.csv`** — dataset completo: 159 filas (**268 unidades**),
  todo el inventario de Daniel mapeado 1:1, categorías en códigos del catálogo.
- **`inventario_nuevos.csv`** — las **138 unidades realmente nuevas** que se importaron.
- **`condicion_existentes.csv`** — las **21 unidades que ya existían** (match por serial),
  para actualizar su condición.
- **`equipos_pendientes_revision.csv`** — hoja de medición de cables (revisión manual).

### Hallazgo clave: el identificador confiable es el SERIAL, no el código

Los códigos de Daniel **chocan numéricamente** con los del import Rentman 2021 pero
identifican equipos **distintos** (p. ej. código `1000` = "Power AC Apollo" en el
inventario, pero "SMALLHD CINE 24"" en el PDF de Daniel). Al cruzar por **serial**:

- **21 de 71** equipos serializados de Daniel ya existían (Teradek, Atomos, Convergent,
  Flanders, iPads), bajo *otro* código. → no se reimportan; se actualiza su condición.
- Los **~17 monitores SmallHD** son nuevos (el inventario no tenía ninguno).

Por eso un import directo por código habría (a) saltado los monitores nuevos y
(b) duplicado los 21 ya existentes. La reconciliación por serial lo evita.

**De-colisión de códigos:** las 22 unidades nuevas cuyo código chocaba con un equipo
distinto del inventario recibieron el prefijo **`DLC-`** (ej. `DLC-1000`) y su número
original se guardó en `qr`. Las 116 con código libre lo conservan tal cual.

**Importado el 08-jun-2026** (vista previa de `inventario_nuevos.csv`, verificado contra
el importador): **138 filas · 138 a importar · 0 existentes · 247 unidades · 0 avisos ·
0 errores.** Inventario: 629 → **767 equipos**. De las 21 existentes, las no-`Good`
(Flanders AM250 → Dañado, QOD+ → Dañado) se actualizaron en su ficha.

**Mapeo de estado operativo → `condition`** (el estado original de Daniel se conserva
textual al inicio de `notes`, p. ej. `Estado (DLC): Activo`):

| Estado en el PDF | `condition` |
|---|---|
| ACTIVO / RESPALDO / EMERGENCIA | `Good` |
| MANTENIMIENTO / RETIRADO / REPUESTOS | `Review` |
| REPARACIÓN / INACTIVO / DESCONTINUADO | `Damaged` |

**Qué se apartó y por qué:** las secciones de cables traen una *hoja de medición* (cada
cable medido: `100" - [98"]`) que no son activos individuales sino el detalle de filas
resumen que sí quedaron en el CSV (ej. `5 CABLES DE 100"`). Esos renglones de medición
están en `equipos_pendientes_revision.csv` para que el equipo técnico los valide; no se
pierden, pero no se importan como activos sueltos para no duplicar inventario.

**Códigos compartidos:** cuando dos unidades con serial distinto compartían un mismo
código de *case* en el PDF (Teradek, laptops, C-stands…), se les asignó un sufijo
(`-2`, `-3`) para no colisionar y se anotó el código original en `notes`.

> Antes de importar a producción conviene revisar `category` y `location`: el importador
> las compara contra el catálogo del workspace y las que no coincidan caerán en la
> categoría/ubicación por defecto (te lo avisa en la vista previa).
