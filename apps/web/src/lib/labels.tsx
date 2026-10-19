import type { Currency } from '@/lib/finance/money';
import type { TransactionStatus, TransactionType } from '@/lib/finance/types';

export const CURRENCY_NAMES: Record<Currency, string> = {
  RUB: 'RUB — российский рубль',
  USD: 'USD — доллар США',
  ARS: 'ARS — аргентинское песо',
};

export const CURRENCY_OPTIONS = (Object.keys(CURRENCY_NAMES) as Currency[]).map((c) => (
  <option key={c} value={c}>{CURRENCY_NAMES[c]}</option>
));

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  cash: 'Наличные', card: 'Карта', savings: 'Накопительный', credit: 'Кредитная', investment: 'Инвестиционный', other: 'Другой',
};
export const ACCOUNT_TYPES = Object.entries(ACCOUNT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>);

export const TYPE_LABELS: Record<TransactionType, string> = {
  income: 'Доход', expense: 'Расход', transfer: 'Перевод', debt_payment: 'Платёж по долгу', refund: 'Возврат',
};
export const STATUS_LABELS: Record<TransactionStatus, string> = {
  draft: 'Черновик', pending_confirmation: 'Ожидает подтверждения', confirmed: 'Подтверждена', cancelled: 'Отменена',
};
export const SOURCE_LABELS: Record<string, string> = {
  telegram: 'Telegram', web: 'Веб', manual: 'Вручную', import: 'Импорт',
};
export const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец', admin: 'Администратор', member: 'Участник', viewer: 'Наблюдатель',
};
