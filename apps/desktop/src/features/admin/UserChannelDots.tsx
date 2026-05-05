import { Mail, MessageCircle, Phone, Send } from "lucide-react";

import type { AppUserAdminRow } from "@contracts";

type ChannelDef = {
  key: "telegram" | "whatsapp" | "email" | "sms";
  label: string;
  icon: typeof Mail;
};

const channels: ChannelDef[] = [
  { key: "telegram", label: "Telegram", icon: Send },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "email", label: "Email", icon: Mail },
  { key: "sms", label: "SMS", icon: Phone },
];

const isChannelActive = (user: AppUserAdminRow, key: ChannelDef["key"]): boolean => {
  if (key === "telegram") {
    return user.telegramLinkStatus === "linked";
  }
  if (key === "email") {
    return Boolean(user.email);
  }
  if (key === "whatsapp" || key === "sms") {
    return Boolean(user.phone);
  }
  return false;
};

const buildTooltip = (user: AppUserAdminRow, channel: ChannelDef): string => {
  if (channel.key === "telegram") {
    if (user.telegramLinkStatus === "linked") {
      return `Telegram linked${user.telegramUsername ? ` · @${user.telegramUsername}` : ""}`;
    }
    if (user.telegramLinkStatus === "pending") {
      return "Telegram pending — link in progress";
    }
    if (user.telegramLinkStatus === "revoked") {
      return "Telegram revoked";
    }
    return "Telegram not linked";
  }
  if (channel.key === "email") {
    return user.email ? `Email · ${user.email}` : "No email on file";
  }
  if (channel.key === "whatsapp") {
    return user.phone ? `WhatsApp · ${user.phone} (configurable soon)` : "No phone on file";
  }
  if (channel.key === "sms") {
    return user.phone ? `SMS · ${user.phone} (configurable soon)` : "No phone on file";
  }
  return channel.label;
};

type UserChannelDotsProps = {
  user: AppUserAdminRow;
  size?: number;
};

export const UserChannelDots = ({ user, size = 11 }: UserChannelDotsProps) => (
  <span className="user-channel-dots" aria-label="Channels available for this user">
    {channels.map((channel) => {
      const Icon = channel.icon;
      const active = isChannelActive(user, channel.key);
      return (
        <span
          key={channel.key}
          className={`user-channel-dot user-channel-dot-${channel.key}${active ? " is-active" : ""}`}
          data-tooltip={buildTooltip(user, channel)}
        >
          <Icon size={size} />
        </span>
      );
    })}
  </span>
);
