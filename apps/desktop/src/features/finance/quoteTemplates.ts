/**
 * Metadata Cine quote templates v1 — derived from real cotizaciones 2025-8400..8405.
 *
 * Each template fills a fresh quote draft with: a package title, a default tax
 * profile (most are Ley de Cine = `film_law_exempt` since that's what Metadata
 * delivers to film clients), and a starter list of items with the right titles
 * and descriptions Iván already uses. The user is free to tweak quantities,
 * prices and durations before saving.
 */

import type { QuoteItemInput, QuoteItemTaxBehavior, QuoteTaxProfile } from "@contracts";

export type QuoteTemplate = {
  key: string;
  label: string;
  packageTitle: string;
  taxProfile: QuoteTaxProfile;
  taxAddedToTotal: boolean;
  description: string;
  items: Array<Omit<QuoteItemInput, "sortOrder">>;
};

const ditFollows: QuoteItemTaxBehavior = "follows_quote";

export const quoteTemplates: QuoteTemplate[] = [
  {
    key: "dit-data-cart",
    label: "DIT / Data Cart",
    packageTitle: "DIT / DATA CART",
    taxProfile: "film_law_exempt",
    taxAddedToTotal: false,
    description: "DIT operator + Data Cart with Mac Studio and pre-production prep.",
    items: [
      {
        quantity: 1,
        title: "DIT - DATA MANAGEMENT",
        description: null,
        durationValue: 3.8,
        durationUnit: "week",
        unitPrice: 60000,
        discountRate: null,
        discountAmount: null,
        taxBehavior: ditFollows,
        taxRate: null,
        notes: null,
      },
      {
        quantity: 1,
        title: 'DATA CART - 32" PRO',
        description:
          'Mac Studio 16" M1, Davinci Resolve, Dock Station, Hub, Card Reader, Cables, SilverStack, Thunderbolt, 2TB SSD Drive, UPS 1500W',
        durationValue: 3.8,
        durationUnit: "week",
        unitPrice: 40000,
        discountRate: null,
        discountAmount: null,
        taxBehavior: ditFollows,
        taxRate: null,
        notes: null,
      },
      {
        quantity: 1,
        title: "PRE-PRODUCCIÓN",
        description: "Diseño de flujo de trabajo y prueba de cámara",
        durationValue: 2,
        durationUnit: "day",
        unitPrice: 10000,
        discountRate: null,
        discountAmount: null,
        taxBehavior: ditFollows,
        taxRate: null,
        notes: null,
      },
    ],
  },
  {
    key: "monitor-dit",
    label: "Monitor DIT",
    packageTitle: "MONITOR DIT",
    taxProfile: "film_law_exempt",
    taxAddedToTotal: false,
    description: 'SmallHD OLED 22" 4K monitor package for DIT.',
    items: [
      {
        quantity: 1,
        title: 'MONITOR 22" 4K - SMALLHD OLED',
        description: "Monitor DIT (Paquete)",
        durationValue: 3.6,
        durationUnit: "week",
        unitPrice: 25000,
        discountRate: null,
        discountAmount: null,
        taxBehavior: ditFollows,
        taxRate: null,
        notes: null,
      },
    ],
  },
  {
    key: "editorial-assistance",
    label: "Editorial Assistance",
    packageTitle: "ASISTENCIA DE EDICIÓN (DURANTE EL RODAJE)",
    taxProfile: "film_law_exempt",
    taxAddedToTotal: false,
    description: "Transcode + edit assistance + edit station during shoot.",
    items: [
      {
        quantity: 1,
        title: "TRANSCODE",
        description: "TRANSCODE PRORES & H264 / SUBIDA / FRAME.IO (5 USUARIOS x 2 MESES)",
        durationValue: 4,
        durationUnit: "week",
        unitPrice: 30000,
        discountRate: null,
        discountAmount: null,
        taxBehavior: ditFollows,
        taxRate: null,
        notes: null,
      },
      {
        quantity: 1,
        title: "ASISTENCIA DE EDICIÓN",
        description:
          "SINCRONIZACIÓN / ORGANIZACIÓN / CONTROL DE CALIDAD / CREACIÓN PROXIES / ARMADO PROYECTO",
        durationValue: 4,
        durationUnit: "week",
        unitPrice: 35000,
        discountRate: null,
        discountAmount: null,
        taxBehavior: ditFollows,
        taxRate: null,
        notes: null,
      },
      {
        quantity: 1,
        title: "ISLA DE EDICIÓN",
        description: null,
        durationValue: 4,
        durationUnit: "week",
        unitPrice: 20000,
        discountRate: null,
        discountAmount: null,
        taxBehavior: ditFollows,
        taxRate: null,
        notes: null,
      },
    ],
  },
  {
    key: "recording-monitors",
    label: "Recording Monitors",
    packageTitle: '(2) MONITORES 19" GRABADORES',
    taxProfile: "film_law_exempt",
    taxAddedToTotal: false,
    description: 'Two Atomos Sumo 19" HDR recording monitors with cables.',
    items: [
      {
        quantity: 2,
        title: 'MONITOR 19"',
        description: 'Atomos Sumo 19" HDR - Recorder / 1TB SSD Card / BC Cables 200\' /',
        durationValue: 3.75,
        durationUnit: "week",
        unitPrice: 20000,
        discountRate: null,
        discountAmount: null,
        taxBehavior: ditFollows,
        taxRate: null,
        notes: null,
      },
    ],
  },
  {
    key: "backup-package",
    label: "Backup Package",
    packageTitle: "(2) BACKUPS : DISCO DURO + LTO-8 + EDICIÓN",
    taxProfile: "standard_itbis",
    taxAddedToTotal: true,
    description: "Master + LTO-8 backup + edit proxies (consumables, ITBIS applies).",
    items: [
      {
        quantity: 1,
        title: "MASTER A",
        description:
          "DISCO EXTERNO 40TB HDD RAID - OWC\n2 x Thunderbolt 3 / 2 x USB-C 3.2 Gen2 / 1 x HDMI 2.1 Port",
        durationValue: 1,
        durationUnit: "unit",
        unitPrice: 98000,
        discountRate: null,
        discountAmount: null,
        taxBehavior: ditFollows,
        taxRate: null,
        notes: null,
      },
      {
        quantity: 1,
        title: "BACKUP (B) LTO-8 (INCLUYE TAPE)",
        description: "MD5 Checksum / Reportes",
        durationValue: 4,
        durationUnit: "unit",
        unitPrice: 22000,
        discountRate: null,
        discountAmount: null,
        taxBehavior: ditFollows,
        taxRate: null,
        notes: null,
      },
      {
        quantity: 1,
        title: "DISCO EDICIÓN (PROXIES)",
        description: "Disco Portable 4TB SSD - SAMSUNG\nUSB-C 3.2 Gen2",
        durationValue: 2,
        durationUnit: "unit",
        unitPrice: 24500,
        discountRate: null,
        discountAmount: null,
        taxBehavior: ditFollows,
        taxRate: null,
        notes: null,
      },
    ],
  },
  {
    key: "custom-blank",
    label: "Custom (blank)",
    packageTitle: "",
    taxProfile: "standard_itbis",
    taxAddedToTotal: true,
    description: "Empty package — fill in your own items.",
    items: [
      {
        quantity: 1,
        title: "",
        description: null,
        durationValue: null,
        durationUnit: null,
        unitPrice: 0,
        discountRate: null,
        discountAmount: null,
        taxBehavior: ditFollows,
        taxRate: null,
        notes: null,
      },
    ],
  },
];
