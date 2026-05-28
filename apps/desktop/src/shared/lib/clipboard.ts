/**
 * Copy text to the clipboard reliably across environments.
 *
 * `navigator.clipboard.writeText` can be rejected in packaged Electron builds
 * (file:// origin without an explicit clipboard-write permission) or when the
 * document isn't focused. We prefer the Electron `clipboard` module via IPC
 * (always works) and fall back to the Web API in the browser/dev.
 */
export const copyToClipboard = async (text: string): Promise<void> => {
  const electronWrite = window.bukowskiApp?.writeClipboard;
  if (electronWrite) {
    await electronWrite(text);
    return;
  }
  await navigator.clipboard.writeText(text);
};
