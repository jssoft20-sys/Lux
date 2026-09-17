export const T = {
  otp: (tpl: string, code: string, ttlMin: number) => tpl.replace('{code}', code).replace('{ttl}', String(ttlMin)),
  newDevice: (model: string, ip: string) =>
    `Somex: выполнен вход с нового устройства (${model || 'неизвестно'}, IP ${ip}). Если это не вы — немедленно завершите все сессии в разделе Безопасность.`,
  orderCreated: (n: number, amountFiat: string, buyer: string, bank: string) =>
    `Somex: новая сделка #${n}. Ожидайте ${amountFiat} KGS от ${buyer} через ${bank}. Принимайте перевод ТОЛЬКО от этого отправителя.`,
  paymentDeclared: (n: number, amountFiat: string, buyer: string) =>
    `Somex: покупатель ${buyer} отметил оплату по сделке #${n} на ${amountFiat} KGS. Проверьте поступление в приложении банка, не по чеку.`,
  released: (n: number, amountUsdt: string) => `Somex: сделка #${n} завершена. ${amountUsdt} USDT зачислены на ваш баланс.`,
  cancelled: (n: number) => `Somex: сделка #${n} отменена. USDT возвращены из эскроу.`,
  disputeOpened: (n: number) => `Somex: по сделке #${n} открыт спор. Средства остаются в эскроу до решения арбитража.`,
  disputeResolved: (n: number, text: string) => `Somex: спор по сделке #${n} решён. ${text}`,
  depositCredited: (amount: string) => `Somex: депозит ${amount} USDT подтверждён и зачислен на баланс.`,
  depositHeld: (amount: string) => `Somex: депозит ${amount} USDT получен и находится на проверке происхождения средств. Мы уведомим вас о результате.`,
  withdrawalSent: (amount: string, tx: string) => `Somex: вывод ${amount} USDT отправлен. TX: ${tx}`,
  withdrawalRejected: (amount: string, reason: string) => `Somex: вывод ${amount} USDT отклонён. Причина: ${reason}`,
  kycApproved: () => `Somex: верификация пройдена ✅. Теперь вам доступны P2P-сделки.`,
  kycDeclined: (reason: string) => `Somex: верификация не пройдена. ${reason} Вы можете пройти проверку повторно в приложении.`,
  accountFrozen: () => `Somex: ваш аккаунт временно заморожен службой безопасности. Свяжитесь с поддержкой.`,
};
