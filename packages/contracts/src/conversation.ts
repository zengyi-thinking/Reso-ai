import { z } from "zod";
import { IsoDateTimeSchema, UuidSchema } from "./common.js";

export const MessageRoleSchema = z.enum(["user", "agent", "system"]);

export const ConversationSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  agentId: UuidSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageSchema = z.object({
  id: UuidSchema,
  conversationId: UuidSchema,
  role: MessageRoleSchema,
  content: z.string().min(1),
  createdAt: IsoDateTimeSchema,
});
export type Message = z.infer<typeof MessageSchema>;
