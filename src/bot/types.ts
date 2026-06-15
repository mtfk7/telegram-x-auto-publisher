export type BotState =
  | 'idle'
  | 'waiting_photo'
  | 'waiting_text'
  | 'preview'
  | 'waiting_account_name'
  | 'waiting_account_remove'
  | 'waiting_account_cookie_select'
  | 'waiting_account_cookie_input'
  | 'waiting_schedule_input'
  | 'waiting_scrape_username'
  | 'waiting_caption_text'
  | 'waiting_caption_remove'
  | 'waiting_manual_caption';

export interface SessionData {
  state: BotState;
  photoPath?: string;
  replyText?: string;
  captionPostId?: number;
  selectedAccountName?: string;
  selectedPostId?: number;
}

export interface BotContext {
  session: SessionData;
}

export function createDefaultSession(): SessionData {
  return { state: 'idle' };
}
