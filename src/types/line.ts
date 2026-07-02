export type LineSource =
  | {
      type: "user";
      userId: string;
    }
  | {
      type: "group";
      groupId: string;
      userId?: string;
    }
  | {
      type: "room";
      roomId: string;
      userId?: string;
    };

export type LineTextMessage = {
  id: string;
  type: "text";
  quoteToken?: string;
  text: string;
};

export type LineMediaMessage = {
  id: string;
  type: "image" | "video" | "audio" | "file" | "sticker" | "location";
  [key: string]: unknown;
};

export type LineMessage = LineTextMessage | LineMediaMessage;

export type LineWebhookEvent = {
  type: string;
  mode: "active" | "standby";
  timestamp: number;
  source: LineSource;
  webhookEventId?: string;
  deliveryContext?: {
    isRedelivery: boolean;
  };
  replyToken?: string;
  message?: LineMessage;
  postback?: {
    data: string;
    params?: Record<string, string>;
  };
};

export type LineWebhookPayload = {
  destination: string;
  events: LineWebhookEvent[];
};

export type LineProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
};
