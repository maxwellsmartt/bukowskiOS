// Equipos del reporte de inventario de Daniel (jun-2026) que requieren
// incidente: dañados (Reparación), pendientes de revisión (Sin estado) y
// equipos activos con defectos funcionales o partes faltantes.
// `code` = código en el app (sin prefijo DLC-); `serial` para match primario.
// Criterio de exclusión: mantenimiento/limpieza genérica, mejoras deseadas
// (desarrollar case/montura, reorganizar cables) y to-dos de configuración.

export type IncidentTarget = {
  code: string;
  serial: string | null;
  incidentType: "damage" | "malfunction" | "missing_part" | "other";
  severity: "Low" | "Medium" | "High";
  title: string;
  description: string;
};

const ORIGIN = "Origen: reporte de inventario físico jun-2026 (Daniel).";

export const TARGETS: IncidentTarget[] = [
  // ——— Dañados (Estado DLC: Reparación) ———
  {
    code: "1000", serial: "24DS220460004", incidentType: "malfunction", severity: "High",
    title: "En reparación — requiere mantenimiento exhaustivo",
    description: `Monitor SmallHD Cine 24" marcado en Reparación. Enciende con power supply y battery plate; no contiene battery plate propio pero funciona al usar uno. Necesita mantenimiento exhaustivo interior y exterior. Tiene montura SmallHD. ${ORIGIN}`,
  },
  {
    code: "1063", serial: "13AS220800009", incidentType: "damage", severity: "High",
    title: "Entrada HDMI defectuosa y línea roja en bordes",
    description: `Monitor SmallHD Cine 1303 marcado en Reparación. SDI 1 y 2 funcionales; entrada HDMI defectuosa. El panel presenta una línea roja en los bordes. ${ORIGIN}`,
  },
  {
    code: "1084", serial: "13DS222640015", incidentType: "damage", severity: "High",
    title: "Entrada HDMI defectuosa y línea roja en bordes",
    description: `Monitor SmallHD Cine 13" marcado en Reparación. SDI 1-4 funcionales; entrada HDMI defectuosa. El panel presenta una línea roja en los bordes. ${ORIGIN}`,
  },
  {
    code: "1089", serial: "13DS222570029", incidentType: "damage", severity: "High",
    title: "Entrada HDMI defectuosa y línea roja en bordes",
    description: `Monitor SmallHD Cine 13" marcado en Reparación. SDI 1-4 funcionales; entrada HDMI defectuosa. El panel presenta una línea roja en los bordes. ${ORIGIN}`,
  },
  {
    code: "20432", serial: "352172005642", incidentType: "damage", severity: "High",
    title: "En reparación — evaluar si se usa para piezas",
    description: `Router Ruckus R720 marcado en Reparación. El reporte pregunta si se puede usar para piezas. ${ORIGIN}`,
  },
  {
    code: "20431", serial: "951703000107", incidentType: "damage", severity: "High",
    title: "En reparación — evaluar si se usa para piezas",
    description: `Router Ruckus R710 marcado en Reparación. El reporte pregunta si se puede usar para piezas. ${ORIGIN}`,
  },
  {
    code: "1486", serial: null, incidentType: "malfunction", severity: "High",
    title: "En reparación",
    description: `Abanico pequeño marcado en Reparación en el inventario. ${ORIGIN}`,
  },
  {
    code: "1496-2", serial: null, incidentType: "damage", severity: "High",
    title: "En reparación — unidad incompleta",
    description: `Proaim C-Stand Holder marcado en Reparación; marcado como incompleto (IN). ${ORIGIN}`,
  },
  {
    code: "1516-2", serial: null, incidentType: "damage", severity: "High",
    title: "En reparación — unidad incompleta",
    description: `Light stand amarillo marcado en Reparación; marcado como incompleto (IN). ${ORIGIN}`,
  },
  {
    code: "1484-2", serial: null, incidentType: "damage", severity: "High",
    title: "En reparación — unidad incompleta",
    description: `Impact 5-Pin Header marcado en Reparación; marcado como incompleto (IN). ${ORIGIN}`,
  },

  // ——— Pendientes de revisión (Estado DLC: Sin estado) ———
  {
    code: "1239", serial: null, incidentType: "other", severity: "Medium",
    title: "Pendiente de revisión técnica",
    description: `Case de iPads sin estado reportado en el inventario; requiere revisión técnica para definir su condición. ${ORIGIN}`,
  },
  {
    code: "1301", serial: "PF3P1HHB", incidentType: "other", severity: "Medium",
    title: "Pendiente de revisión técnica",
    description: `Laptop de calibración Lenovo/Windows sin estado reportado en el inventario; requiere revisión técnica para definir su condición. ${ORIGIN}`,
  },
  {
    code: "2383", serial: "X69Q2X00695", incidentType: "other", severity: "Medium",
    title: "Pendiente de revisión técnica",
    description: `Epson LW-PX300 sin estado reportado en el inventario; requiere revisión técnica para definir su condición. ${ORIGIN}`,
  },
  {
    code: "2385", serial: "SUYZ390239", incidentType: "other", severity: "Medium",
    title: "Pendiente de revisión técnica",
    description: `Epson LW-400 sin estado reportado en el inventario; requiere revisión técnica para definir su condición. ${ORIGIN}`,
  },
  {
    code: "2433", serial: null, incidentType: "other", severity: "Medium",
    title: "Pendiente de revisión técnica",
    description: `Cable de 12" sin estado reportado en el inventario; requiere revisión técnica para definir su condición. ${ORIGIN}`,
  },

  // ——— Activos con defectos funcionales ———
  {
    code: "1014", serial: "24DS212640018", incidentType: "malfunction", severity: "Low",
    title: "Tornillo suelto en el interior",
    description: `Monitor SmallHD Cine 24" activo y funcional, pero tiene un tornillo suelto en su interior que debe revisarse. ${ORIGIN}`,
  },
  {
    code: "1028", serial: "24DS220740010", incidentType: "missing_part", severity: "Medium",
    title: "Sin battery plate propio y tornillos sueltos",
    description: `Monitor SmallHD Cine 24" activo: no contiene battery plate propio (funciona al usar uno externo) y tiene tornillos sueltos en su interior que deben revisarse. ${ORIGIN}`,
  },
  {
    code: "1035", serial: "22AS223000004", incidentType: "malfunction", severity: "Medium",
    title: "Battery plate #2 no pasa carga eléctrica",
    description: `Monitor SmallHD OLED 22" activo: el battery plate #2 no pasa carga eléctrica, solo funciona el #1. ${ORIGIN}`,
  },
  {
    code: "1049", serial: "13AS220800011", incidentType: "malfunction", severity: "Medium",
    title: "Entrada HDMI defectuosa",
    description: `Monitor SmallHD Cine 1303 activo: entradas SDI 1 y 2 funcionales, entrada HDMI defectuosa. ${ORIGIN}`,
  },
  {
    code: "1185", serial: "72ES220400159", incidentType: "malfunction", severity: "Medium",
    title: "Battery plate defectuoso — solo enciende por D-Tap",
    description: `Monitor SmallHD 702 Touch activo: battery plate defectuoso (pin PON faltante), solo enciende con cable de D-Tap a 2-pin Lemo. Visera SmallRig faltante. ${ORIGIN}`,
  },
  {
    code: "1485", serial: null, incidentType: "malfunction", severity: "Medium",
    title: "Control de velocidad roto",
    description: `Abanico pequeño activo pero con el control de velocidad roto. ${ORIGIN}`,
  },

  // ——— Activos con partes faltantes ———
  {
    code: "1198", serial: "72ES220390105", incidentType: "missing_part", severity: "Low",
    title: "Montura handheld y viseras faltantes",
    description: `Monitor SmallHD 702 Touch activo con battery plate funcional. Faltan: montura handheld SmallHD, visera SmallRig y visera SmallHD. ${ORIGIN}`,
  },
  {
    code: "1319", serial: "K1794NJV55G71", incidentType: "missing_part", severity: "Low",
    title: "Falta AtomX battery eliminator",
    description: `Atomos Ninja V activo y funcional (SDI, HDMI in/out). No contiene el AtomX Sony L-Series Type Battery Eliminator. ${ORIGIN}`,
  },
  {
    code: "1323", serial: "K1794NJV55G67", incidentType: "missing_part", severity: "Low",
    title: "Faltan battery eliminator, case, visera y adaptador",
    description: `Atomos Ninja V activo y funcional (SDI, HDMI in/out). No contiene: AtomX Sony L-Series Battery Eliminator, case SmallRig, visera SmallRig ni adaptador L-Series a D-Tap. ${ORIGIN}`,
  },
  {
    code: "1325", serial: "D1994NJV51D22", incidentType: "missing_part", severity: "Low",
    title: "Faltan battery eliminator, case, visera y adaptador",
    description: `Atomos Ninja V activo y funcional (SDI, HDMI in/out). No contiene: AtomX Sony L-Series Battery Eliminator, case SmallRig, visera SmallRig ni adaptador L-Series a D-Tap. ${ORIGIN}`,
  },
  {
    code: "1126", serial: "0212100577", incidentType: "missing_part", severity: "Medium",
    title: "7 antenas faltantes",
    description: `Teradek Bolt 4K MAX activo (puertos SDI de transmisor y receptor funcionales). Faltan 7 antenas: 3 pequeñas, 2 grandes, 2 hongos pequeños. El reporte recomienda reorganizar y redistribuir las antenas Teradek equitativamente. ${ORIGIN}`,
  },
  {
    code: "1142", serial: "0212100574", incidentType: "missing_part", severity: "Medium",
    title: "9 antenas faltantes",
    description: `Teradek Bolt 4K MAX activo (puertos SDI de transmisor y receptor funcionales). Faltan 9 antenas: 3 pequeñas, 6 grandes, 2 hongos pequeños. El reporte recomienda reorganizar y redistribuir las antenas Teradek equitativamente. ${ORIGIN}`,
  },
  {
    code: "1157", serial: "0212100559", incidentType: "missing_part", severity: "Medium",
    title: "5 antenas faltantes",
    description: `Teradek Bolt 4K MAX activo (puertos SDI de transmisor y receptor funcionales). Faltan 5 antenas: 3 pequeñas y 6 grandes según reporte. El reporte recomienda reorganizar y redistribuir las antenas Teradek equitativamente. ${ORIGIN}`,
  },
  {
    code: "1157-2", serial: "0222106234", incidentType: "missing_part", severity: "Medium",
    title: "Antenas faltantes (observación compartida)",
    description: `Teradek Bolt 4K LT MAX activo (puertos SDI funcionales). Observación compartida con el case 1157: antenas faltantes; proceder con la reorganización y redistribución equitativa para homogeneizar los equipos. ${ORIGIN}`,
  },
  {
    code: "1007", serial: "24DS221670029", incidentType: "missing_part", severity: "Low",
    title: "Power supply provisional",
    description: `Monitor SmallHD Cine 24" activo con montura Innovativ. Está operando con un power supply provisional; falta el definitivo. ${ORIGIN}`,
  },
  {
    code: "1021", serial: "24DS233470002", incidentType: "missing_part", severity: "Low",
    title: "Protector transparente faltante",
    description: `Monitor SmallHD Cine 24" activo y en buen estado (tiene el protector negro). Falta el protector transparente. ${ORIGIN}`,
  },
  {
    code: "20373", serial: null, incidentType: "missing_part", severity: "Low",
    title: "Necesita cable D-Tap a barrel 2.1mm",
    description: `Freakshow DA (case 1259) activo. Necesita cable de D-Tap a barrel 2.1mm para operar. ${ORIGIN}`,
  },
  {
    code: "20374", serial: null, incidentType: "missing_part", severity: "Low",
    title: "Necesita cable D-Tap a barrel 2.1mm",
    description: `Freakshow DA (case 1262) activo. Necesita cable de D-Tap a barrel 2.1mm para operar. ${ORIGIN}`,
  },
  {
    code: "20374-2", serial: null, incidentType: "missing_part", severity: "Low",
    title: "Necesita cable D-Tap a barrel 2.1mm",
    description: `Freakshow DA (case por definir) activo. Necesita cable de D-Tap a barrel 2.1mm para operar. ${ORIGIN}`,
  },
  {
    code: "20374-3", serial: null, incidentType: "missing_part", severity: "Low",
    title: "Necesita cable D-Tap a barrel 2.1mm",
    description: `Freakshow DA (case por definir) activo. Necesita cable de D-Tap a barrel 2.1mm para operar. ${ORIGIN}`,
  },
];
