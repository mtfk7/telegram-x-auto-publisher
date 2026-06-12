import { Context, MiddlewareFn } from 'telegraf';
import { config } from '../../config';

export const whitelistMiddleware: MiddlewareFn<Context> = async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) {
    return;
  }

  if (config.telegram.allowedIds.size === 0) {
    await ctx.reply('⚠️ Sistem belum dikonfigurasi. Hubungi administrator.');
    return;
  }

  if (!config.telegram.allowedIds.has(userId)) {
    await ctx.reply('🚫 Anda tidak memiliki akses ke bot ini.');
    return;
  }

  return next();
};
