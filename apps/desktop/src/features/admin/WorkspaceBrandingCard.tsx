import { Camera, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "@app/providers/SessionProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useCurrencySettings } from "@features/finance/useCurrencyData";
import { newCommandId } from "@features/finance/quoteHelpers";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

type AssetKey = "logo" | "seal" | "signature";

type AssetMeta = {
  titleKey: string;
  helpKey: string;
  column: keyof BrandingUrls;
};

const ASSET_META: Record<AssetKey, AssetMeta> = {
  logo: {
    titleKey: "settings.workspace.branding.assets.logoTitle",
    helpKey: "settings.workspace.branding.assets.logoHelp",
    column: "workspaceLogoUrl",
  },
  seal: {
    titleKey: "settings.workspace.branding.assets.sealTitle",
    helpKey: "settings.workspace.branding.assets.sealHelp",
    column: "workspaceSealUrl",
  },
  signature: {
    titleKey: "settings.workspace.branding.assets.signatureTitle",
    helpKey: "settings.workspace.branding.assets.signatureHelp",
    column: "workspaceSignatureUrl",
  },
};

type BrandingUrls = {
  workspaceLogoUrl: string | null;
  workspaceSealUrl: string | null;
  workspaceSignatureUrl: string | null;
};

const acceptedTypes = /^image\/(png|jpeg|webp|svg\+xml)$/;
const maxSizeBytes = 4 * 1024 * 1024;

export const WorkspaceBrandingCard = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { supabase } = useSession();
  const { activeWorkspaceId } = useWorkspace();
  const { data: settings, refresh } = useCurrencySettings(activeWorkspaceId);
  const fileInputRef = useRef<Record<AssetKey, HTMLInputElement | null>>({
    logo: null,
    seal: null,
    signature: null,
  });
  const [urls, setUrls] = useState<BrandingUrls>({
    workspaceLogoUrl: null,
    workspaceSealUrl: null,
    workspaceSignatureUrl: null,
  });
  const [uploadingKey, setUploadingKey] = useState<AssetKey | null>(null);

  useEffect(() => {
    if (!settings) return;
    setUrls({
      workspaceLogoUrl: settings.workspaceLogoUrl,
      workspaceSealUrl: settings.workspaceSealUrl,
      workspaceSignatureUrl: settings.workspaceSignatureUrl,
    });
  }, [settings]);

  if (!settings) return null;

  const persistUrls = async (next: BrandingUrls) => {
    if (!window.bukowskiCurrency) return;
    await window.bukowskiCurrency.upsertSettings({
      commandId: newCommandId("branding"),
      workspaceId: activeWorkspaceId,
      actorType: "user",
      sourceChannel: "desktop",
      baseCurrency: settings.baseCurrency,
      defaultQuoteCurrency: settings.defaultQuoteCurrency,
      enabledCurrencies: settings.enabledCurrencies,
      defaultRateSource: settings.defaultRateSource,
      defaultRateType: settings.defaultRateType,
      defaultItbisRate: settings.defaultItbisRate,
      defaultQuoteValidityDays: settings.defaultQuoteValidityDays,
      sirecineNumber: settings.sirecineNumber,
      ncfSeriesActive: settings.ncfSeriesActive,
      ncfSequenceNext: settings.ncfSequenceNext,
      ncfSequenceMax: settings.ncfSequenceMax,
      ncfExpiresAt: settings.ncfExpiresAt,
      workspaceLogoUrl: next.workspaceLogoUrl,
      workspaceSealUrl: next.workspaceSealUrl,
      workspaceSignatureUrl: next.workspaceSignatureUrl,
    });
    refresh();
  };

  const handleFile = async (key: AssetKey, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!supabase) {
      toast.error(
        t("settings.workspace.branding.toasts.signInRequiredTitle"),
        t("settings.workspace.branding.toasts.signInRequiredBody"),
      );
      return;
    }
    if (!acceptedTypes.test(file.type)) {
      toast.error(
        t("settings.workspace.branding.toasts.unsupportedFormatTitle"),
        t("settings.workspace.branding.toasts.unsupportedFormatBody"),
      );
      return;
    }
    if (file.size > maxSizeBytes) {
      toast.error(
        t("settings.workspace.branding.toasts.fileTooLargeTitle"),
        t("settings.workspace.branding.toasts.fileTooLargeBody"),
      );
      return;
    }

    setUploadingKey(key);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${activeWorkspaceId}/${key}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("workspace-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from("workspace-assets").getPublicUrl(path);
      const publicUrl = publicUrlData.publicUrl;

      const next: BrandingUrls = { ...urls, [ASSET_META[key].column]: publicUrl };
      await persistUrls(next);
      setUrls(next);
      toast.success(
        t("settings.workspace.branding.toasts.updatedTitle"),
        t("settings.workspace.branding.toasts.updatedBody", { asset: t(ASSET_META[key].titleKey) }),
      );
    } catch (error) {
      toast.error(
        t("settings.workspace.branding.toasts.uploadFailedTitle"),
        getUserFacingErrorMessage(error, t("settings.workspace.branding.toasts.uploadFailedBody")),
      );
    } finally {
      setUploadingKey(null);
    }
  };

  const handleRemove = async (key: AssetKey) => {
    setUploadingKey(key);
    try {
      const next: BrandingUrls = { ...urls, [ASSET_META[key].column]: null };
      await persistUrls(next);
      setUrls(next);
      toast.success(
        t("settings.workspace.branding.toasts.clearedTitle"),
        t("settings.workspace.branding.toasts.clearedBody", { asset: t(ASSET_META[key].titleKey) }),
      );
    } catch (error) {
      toast.error(
        t("settings.workspace.branding.toasts.couldNotClear"),
        getUserFacingErrorMessage(error, t("common.tryAgain")),
      );
    } finally {
      setUploadingKey(null);
    }
  };

  return (
    <SurfaceCard
      title={t("settings.workspace.branding.cardTitle")}
      subtitle={t("settings.workspace.branding.cardSubtitle")}
    >
      <div className="branding-grid">
        {(Object.keys(ASSET_META) as AssetKey[]).map((key) => {
          const meta = ASSET_META[key];
          const title = t(meta.titleKey);
          const help = t(meta.helpKey);
          const url = urls[meta.column];
          const isUploading = uploadingKey === key;
          return (
            <div className="branding-tile" key={key}>
              <div className="branding-tile-preview">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={title} className="branding-tile-image" src={url} />
                ) : (
                  <span className="branding-tile-placeholder">{title}</span>
                )}
              </div>
              <div className="branding-tile-copy">
                <strong>{title}</strong>
                <small>{help}</small>
              </div>
              <div className="branding-tile-actions">
                <input
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="user-account-avatar-input"
                  onChange={(event) => void handleFile(key, event)}
                  ref={(el) => {
                    fileInputRef.current[key] = el;
                  }}
                  type="file"
                />
                <button
                  className="ghost-control"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current[key]?.click()}
                  type="button"
                >
                  <Camera size={13} />
                  <span>{url ? t("settings.workspace.branding.replace") : t("settings.workspace.branding.upload")}</span>
                </button>
                {url ? (
                  <button
                    className="ghost-control is-danger"
                    disabled={isUploading}
                    onClick={() => void handleRemove(key)}
                    type="button"
                  >
                    <Trash2 size={13} />
                    <span>{t("settings.workspace.branding.remove")}</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </SurfaceCard>
  );
};

export default WorkspaceBrandingCard;
