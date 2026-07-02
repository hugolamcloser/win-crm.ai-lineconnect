export type GhlCreateContactInput = {
  lineUserId: string;
  displayName?: string;
  pictureUrl?: string;
};

export type GhlContactResponse = {
  id: string;
  raw: Record<string, unknown>;
};

export type GhlInboundMessageInput = {
  contactId: string;
  conversationId?: string;
  externalConversationId: string;
  externalMessageId: string;
  message: string;
  attachments?: string[];
};

export type GhlInboundMessageResponse = {
  id?: string;
  messageId?: string;
  conversationId?: string;
  contactId?: string;
  [key: string]: unknown;
};

export type NormalizedGhlOutboundMessage = {
  contactId?: string;
  conversationId?: string;
  messageId?: string;
  message: string;
  attachments: string[];
  raw: Record<string, unknown>;
};
