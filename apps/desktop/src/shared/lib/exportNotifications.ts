import type { AppExportResult } from "@contracts";
import type { ToastTone } from "@app/providers/ToastProvider";

type ExportToastApi = {
  success: (title: string, body?: string) => string;
  show: (input: { title: string; body?: string; tone?: ToastTone; durationMs?: number }) => string;
};

type NotifyExportResultOptions = {
  successTitle: string;
  cancelledTitle: string;
  cancelledBody: string;
  successBody?: string | null;
};

export const notifyExportResult = (
  toast: ExportToastApi,
  result: AppExportResult,
  { successTitle, cancelledTitle, cancelledBody, successBody }: NotifyExportResultOptions,
) => {
  if (result.saved) {
    toast.success(successTitle, successBody ?? result.summary);
    return;
  }

  toast.show({
    title: cancelledTitle,
    body: cancelledBody,
    tone: "cancelled",
  });
};
