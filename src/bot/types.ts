export type BotState =
  | 'idle'
  | 'waiting_photo'
  | 'waiting_text'
  | 'preview'
  | 'waiting_account_name'
  | 'waiting_account_remove'
  | 'waiting_scrape_username'
  | 'waiting_caption_text'
  | 'waiting_caption_remove'
  | 'waiting_manual_caption';

export interface SessionData {
  state: BotState;
  photoPath?: string;
  replyText?: string;
  captionPostId?: number;
}

export interface BotContext {
  session: SessionData;
}

export function createDefaultSession(): SessionData {
  return { state: 'idle' };
}
