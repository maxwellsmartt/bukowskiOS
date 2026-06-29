// pdfjs-dist ships its types via the package `types` field (the bare
// "pdfjs-dist" entry) but not for the build/* subpaths the renderer imports
// directly. Re-export the real types so the dynamic import stays fully typed
// (GlobalWorkerOptions, getDocument, …) instead of collapsing to `any`.
declare module "pdfjs-dist/build/pdf.mjs" {
  export * from "pdfjs-dist";
}

declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
