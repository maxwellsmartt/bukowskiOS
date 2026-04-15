import mailLogo from "@shared/assets/inbox/logos/Mail_(iOS).svg.png";
import telegramLogo from "@shared/assets/inbox/logos/Telegram_logo.svg.png";
import whatsappLogo from "@shared/assets/inbox/logos/WhatsApp.png";

type ConnectorBrand = {
  key: string | null;
  label: string | null;
  logoSrc: string | null;
  logoAlt: string | null;
  logoClassName: string | null;
};

const normalizeConnectorKey = (value: string | null | undefined) => value?.trim().toLowerCase() ?? null;

export const getConnectorBrand = (value: string | null | undefined): ConnectorBrand => {
  const connectorKey = normalizeConnectorKey(value);

  switch (connectorKey) {
    case "telegram":
      return {
        key: connectorKey,
        label: "Telegram",
        logoSrc: telegramLogo,
        logoAlt: "Telegram",
        logoClassName: null,
      };
    case "whatsapp":
      return {
        key: connectorKey,
        label: "WhatsApp",
        logoSrc: whatsappLogo,
        logoAlt: "WhatsApp",
        logoClassName: null,
      };
    case "email":
      return {
        key: connectorKey,
        label: "Email",
        logoSrc: mailLogo,
        logoAlt: "Email",
        logoClassName: null,
      };
    default:
      return {
        key: connectorKey,
        label: null,
        logoSrc: null,
        logoAlt: null,
        logoClassName: null,
      };
  }
};
