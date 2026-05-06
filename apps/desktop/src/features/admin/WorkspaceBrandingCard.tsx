import { Camera, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { useSession } from "@app/providers/SessionProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useCurrencySettings } from "@features/finance/useCurrencyData";
import { newCommandId } from "@features/finance/quoteHelpers";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

type AssetKey = "logo" | "seal" | "signature";

const labelMap: Record<AssetKey, { title: string; help: string; column: keyof BrandingUrls }> = {
  logo: {
    title: "Workspace logo",
    help: "Square or stacked. PNG, JPEG, WebP or SVG up to 4 MB. Appears in the top-left of every quote PDF.",
    column: "workspaceLogoUrl",
  },
  seal: {
    title: "Sello (stamp)",
    help: "Round official stamp scanned as PNG with transparency. Appears next to the signature.",
    column: "workspaceSealUrl",
  },
  signature: {
    title: "Signature",
    help: "Scanned signature on transparent background. Appears above the signatory name.",
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
      toast.error("Sign in required", "You need to be signed in to upload workspace assets.");
      return;
    }
    if (!acceptedTypes.test(file.type)) {
      toast.error("Unsupported format", "PNG, JPEG, WebP or SVG only.");
      return;
    }
    if (file.size > maxSizeBytes) {
      toast.error("File too large", "Pick an image under 4 MB.");
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

      const next: BrandingUrls = { ...urls, [labelMap[key].column]: publicUrl };
      await persistUrls(next);
      setUrls(next);
      toast.success("Branding updated", `${labelMap[key].title} now appears on every quote PDF.`);
    } catch (error) {
      toast.error(
        "Upload failed",
        getUserFacingErrorMessage(error, "Try again with a smaller file."),
      );
    } finally {
      setUploadingKey(null);
    }
  };

  const handleRemove = async (key: AssetKey) => {
    setUploadingKey(key);
    try {
      const next: BrandingUrls = { ...urls, [labelMap[key].column]: null };
      await persistUrls(next);
      setUrls(next);
      toast.success("Branding cleared", `${labelMap[key].title} removed from quote PDFs.`);
    } catch (error) {
      toast.error("Could not clear", getUserFacingErrorMessage(error, "Try again in a moment."));
    } finally {
      setUploadingKey(null);
    }
  };

  return (
    <SurfaceCard title="Quote branding" subtitle="Logo, sello and signature embedded in every quote PDF.">
      <div className="branding-grid">
        {(Object.keys(labelMap) as AssetKey[]).map((key) => {
          const meta = labelMap[key];
          const url = urls[meta.column];
          const isUploading = uploadingKey === key;
          return (
            <div className="branding-tile" key={key}>
              <div className="branding-tile-preview">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={meta.title} className="branding-tile-image" src={url} />
                ) : (
                  <span className="branding-tile-placeholder">{meta.title}</span>
                )}
              </div>
              <div className="branding-tile-copy">
                <strong>{meta.title}</strong>
                <small>{meta.help}</small>
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
                  <span>{url ? "Replace" : "Upload"}</span>
                </button>
                {url ? (
                  <button
                    className="ghost-control is-danger"
                    disabled={isUploading}
                    onClick={() => void handleRemove(key)}
                    type="button"
                  >
                    <Trash2 size={13} />
                    <span>Remove</span>
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
