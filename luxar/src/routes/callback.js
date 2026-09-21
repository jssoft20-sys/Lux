import { Router } from 'express';
import { store } from '../store.js';
import { verifyCallbackAuth } from '../services/optima.js';
import { markPaid } from '../services/payments.js';

/*
 * Callback от «Optima Business» о статусе QR-транзакции.
 * URL для банка: https://ваш-домен/api/v1/callback (банк требует HTTPS — поставьте nginx с сертификатом перед сервером).
 * Аутентификация: Basic Auth, логин/пароль задаются в админке → Настройки → Optima Bank.
 */
export const callbackRouter = Router();

callbackRouter.post('/api/v1/callback', async (req, res) => {
  if (!verifyCallbackAuth(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const body = req.body || {};
  const transactionId = String(body.transactionId || '').trim();
  const status = String(body.status || '').trim().toUpperCase();
  if (!transactionId) return res.status(400).json({ error: 'Неверный формат данных', details: "Поле 'transactionId' обязательно" });
  store.log('optima', `Callback: ${transactionId} → ${status}`, { body });
  const payment = store.find('payments', (p) => p.method === 'elqr' && p.optima && p.optima.transactionId === transactionId);
  if (payment) {
    store.update('payments', payment.id, { optima: { ...payment.optima, status, callbackAt: new Date().toISOString(), bankSum: body.sum ?? payment.optima.bankSum, processedAt: body.transactionProcessedDateTime || payment.optima.processedAt } });
    if (status === 'PROCESSED' && payment.status !== 'paid') {
      try {
        await markPaid(payment.id, { confirmedBy: 'callback', meta: { bankSum: body.sum, processedAt: body.transactionProcessedDateTime, payerClientType: body.payerClientType } });
      } catch (err) {
        console.error('[callback] markPaid:', err.message);
      }
    }
  }
  res.json({ message: 'Callback успешно обработан', transactionId, receivedAt: new Date().toISOString() });
});
