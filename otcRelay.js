const WebSocket = require('ws');
const dotenv = require('dotenv');

dotenv.config();

const WS_PORT = 8082; // Порт для OTC

// Создаём WebSocket сервер (ретранслятор)
const wss = new WebSocket.Server({ port: WS_PORT });

// Подключенные клиенты
const clients = new Set();

console.log(`🔷 OTC Relay запущен на порту ${WS_PORT}`);
console.log(`📡 Генератор OTC котировок активирован...`);

// Конфигурация для 20 OTC пар
const OTC_CONFIG = {
  'EUR/USD': {
    min: 1.16,
    max: 1.175,
    current: 1.16560,
    volatility: 0.00005 // Волатильность (макс изменение за тик)
  },
  'AUD/CAD': {
    min: 0.90,
    max: 0.92,
    current: 0.9085,
    volatility: 0.00005
  },
  'USD/JPY': {
    min: 150,
    max: 153,
    current: 151.74,
    volatility: 0.01 // Для JPY пар волатильность выше (больше пипсов)
  },
  'AUD/JPY': {
    min: 97,
    max: 99,
    current: 98.16,
    volatility: 0.01
  },
  'GBP/USD': {
    min: 1.32,
    max: 1.34,
    current: 1.334,
    volatility: 0.00005
  },
  'GBP/CAD': {
    min: 1.85,
    max: 1.87,
    current: 1.864,
    volatility: 0.00005
  },
  'EUR/CAD': {
    min: 1.62,
    max: 1.64,
    current: 1.624,
    volatility: 0.00005
  },
  'CHF/JPY': {
    min: 188,
    max: 190,
    current: 188.8,
    volatility: 0.01
  },
  'CAD/CHF': {
    min: 0.57,
    max: 0.58,
    current: 0.572,
    volatility: 0.00005
  },
  'USD/CHF': {
    min: 0.80,
    max: 0.81,
    current: 0.804,
    volatility: 0.00005
  },
  'USD/CAD': {
    min: 1.40,
    max: 1.41,
    current: 1.406,
    volatility: 0.00005
  },
  'GBP/AUD': {
    min: 2.05,
    max: 2.06,
    current: 2.054,
    volatility: 0.00005
  },
  'AUD/CHF': {
    min: 0.52,
    max: 0.53,
    current: 0.519,
    volatility: 0.00005
  },
  'EUR/CHF': {
    min: 0.93,
    max: 0.94,
    current: 0.929,
    volatility: 0.00005
  },
  'GBP/CHF': {
    min: 1.06,
    max: 1.07,
    current: 1.066,
    volatility: 0.00005
  },
  'CAD/JPY': {
    min: 107,
    max: 109,
    current: 108.0,
    volatility: 0.01
  },
  'EUR/JPY': {
    min: 175,
    max: 177,
    current: 175.4,
    volatility: 0.01
  },
  'GBP/JPY': {
    min: 201,
    max: 203,
    current: 201.3,
    volatility: 0.01
  },
  'EUR/GBP': {
    min: 0.87,
    max: 0.88,
    current: 0.871,
    volatility: 0.00005
  },
  'AUD/USD': {
    min: 0.66,
    max: 0.68,
    current: 0.67,
    volatility: 0.00005
  },
  // ==========================================
  // CRYPTO OTC ПАРЫ (Синтетические данные)
  // ==========================================
  'BTC/USD': {
    min: 110000,
    max: 115000,
    current: 112500,
    volatility: 50 // Высокая волатильность для крипты
  },
  'ETH/USD': {
    min: 3900,
    max: 4100,
    current: 4000,
    volatility: 5
  },
  'LTC/USD': {
    min: 90,
    max: 95,
    current: 92.5,
    volatility: 0.5
  },
  'XRP/USD': {
    min: 2.40,
    max: 2.50,
    current: 2.45,
    volatility: 0.01
  },
  'SOL/USD': {
    min: 190,
    max: 200,
    current: 195,
    volatility: 2
  },
  'ADA/USD': {
    min: 0.45,
    max: 0.50,
    current: 0.47,
    volatility: 0.005
  },
  'DOT/USD': {
    min: 6.5,
    max: 7.5,
    current: 7.0,
    volatility: 0.1
  },
  'MATIC/USD': {
    min: 0.80,
    max: 0.90,
    current: 0.85,
    volatility: 0.01
  },
  'AVAX/USD': {
    min: 35,
    max: 40,
    current: 37.5,
    volatility: 0.5
  },
  'LINK/USD': {
    min: 14,
    max: 16,
    current: 15,
    volatility: 0.1
  },
  // ==========================================
  // ДОПОЛНИТЕЛЬНЫЕ FOREX OTC ПАРЫ (30 новых)
  // ==========================================
  'USD/UAH': {
    min: 36.5,
    max: 37.5,
    current: 37.0,
    volatility: 0.05 // Украинская гривна
  },
  'USD/RUB': {
    min: 90,
    max: 95,
    current: 92.5,
    volatility: 0.5 // Российский рубль
  },
  'NZD/USD': {
    min: 0.61,
    max: 0.63,
    current: 0.62,
    volatility: 0.00005 // Новозеландский доллар
  },
  'EUR/AUD': {
    min: 1.65,
    max: 1.68,
    current: 1.665,
    volatility: 0.00005
  },
  'NZD/JPY': {
    min: 92,
    max: 95,
    current: 93.5,
    volatility: 0.01
  },
  'AUD/NZD': {
    min: 1.08,
    max: 1.11,
    current: 1.095,
    volatility: 0.00005
  },
  'EUR/NZD': {
    min: 1.80,
    max: 1.83,
    current: 1.815,
    volatility: 0.00005
  },
  'GBP/NZD': {
    min: 2.13,
    max: 2.16,
    current: 2.145,
    volatility: 0.00005
  },
  'NZD/CHF': {
    min: 0.54,
    max: 0.56,
    current: 0.55,
    volatility: 0.00005
  },
  'NZD/CAD': {
    min: 0.84,
    max: 0.86,
    current: 0.85,
    volatility: 0.00005
  },
  'USD/CNY': {
    min: 7.25,
    max: 7.27,
    current: 7.26,
    volatility: 0.00005 // Китайский юань
  },
  'EUR/CNY': {
    min: 8.38,
    max: 8.40,
    current: 8.39,
    volatility: 0.00005
  },
  'GBP/CNY': {
    min: 9.89,
    max: 9.91,
    current: 9.90,
    volatility: 0.00005
  },
  'USD/INR': {
    min: 83.2,
    max: 83.4,
    current: 83.3,
    volatility: 0.01 // Индийская рупия
  },
  'EUR/INR': {
    min: 96.1,
    max: 96.3,
    current: 96.2,
    volatility: 0.01
  },
  'GBP/INR': {
    min: 113.5,
    max: 113.7,
    current: 113.6,
    volatility: 0.01
  },
  'EUR/RUB': {
    min: 100,
    max: 105,
    current: 102.5,
    volatility: 0.5
  },
  'GBP/RUB': {
    min: 118,
    max: 123,
    current: 120.5,
    volatility: 0.5
  },
  'EUR/UAH': {
    min: 40.5,
    max: 41.5,
    current: 41.0,
    volatility: 0.05
  },
  'GBP/UAH': {
    min: 47.8,
    max: 48.8,
    current: 48.3,
    volatility: 0.05
  },
  'USD/MXN': {
    min: 17.2,
    max: 17.4,
    current: 17.3,
    volatility: 0.01 // Мексиканский песо
  }
};

// Текущие цены
let currentPrices = {
  // Forex OTC пары
  'EUR/USD': OTC_CONFIG['EUR/USD'].current,
  'AUD/CAD': OTC_CONFIG['AUD/CAD'].current,
  'USD/JPY': OTC_CONFIG['USD/JPY'].current,
  'AUD/JPY': OTC_CONFIG['AUD/JPY'].current,
  'GBP/USD': OTC_CONFIG['GBP/USD'].current,
  'GBP/CAD': OTC_CONFIG['GBP/CAD'].current,
  'EUR/CAD': OTC_CONFIG['EUR/CAD'].current,
  'CHF/JPY': OTC_CONFIG['CHF/JPY'].current,
  'CAD/CHF': OTC_CONFIG['CAD/CHF'].current,
  'USD/CHF': OTC_CONFIG['USD/CHF'].current,
  'USD/CAD': OTC_CONFIG['USD/CAD'].current,
  'GBP/AUD': OTC_CONFIG['GBP/AUD'].current,
  'AUD/CHF': OTC_CONFIG['AUD/CHF'].current,
  'EUR/CHF': OTC_CONFIG['EUR/CHF'].current,
  'GBP/CHF': OTC_CONFIG['GBP/CHF'].current,
  'CAD/JPY': OTC_CONFIG['CAD/JPY'].current,
  'EUR/JPY': OTC_CONFIG['EUR/JPY'].current,
  'GBP/JPY': OTC_CONFIG['GBP/JPY'].current,
  'EUR/GBP': OTC_CONFIG['EUR/GBP'].current,
  'AUD/USD': OTC_CONFIG['AUD/USD'].current,
  // Crypto OTC пары
  'BTC/USD': OTC_CONFIG['BTC/USD'].current,
  'ETH/USD': OTC_CONFIG['ETH/USD'].current,
  'LTC/USD': OTC_CONFIG['LTC/USD'].current,
  'XRP/USD': OTC_CONFIG['XRP/USD'].current,
  'SOL/USD': OTC_CONFIG['SOL/USD'].current,
  'ADA/USD': OTC_CONFIG['ADA/USD'].current,
  'DOT/USD': OTC_CONFIG['DOT/USD'].current,
  'MATIC/USD': OTC_CONFIG['MATIC/USD'].current,
  'AVAX/USD': OTC_CONFIG['AVAX/USD'].current,
  'LINK/USD': OTC_CONFIG['LINK/USD'].current,
  // Дополнительные Forex OTC пары
  'USD/UAH': OTC_CONFIG['USD/UAH'].current,
  'USD/RUB': OTC_CONFIG['USD/RUB'].current,
  'NZD/USD': OTC_CONFIG['NZD/USD'].current,
  'EUR/AUD': OTC_CONFIG['EUR/AUD'].current,
  'NZD/JPY': OTC_CONFIG['NZD/JPY'].current,
  'AUD/NZD': OTC_CONFIG['AUD/NZD'].current,
  'EUR/NZD': OTC_CONFIG['EUR/NZD'].current,
  'GBP/NZD': OTC_CONFIG['GBP/NZD'].current,
  'NZD/CHF': OTC_CONFIG['NZD/CHF'].current,
  'NZD/CAD': OTC_CONFIG['NZD/CAD'].current,
  'USD/CNY': OTC_CONFIG['USD/CNY'].current,
  'EUR/CNY': OTC_CONFIG['EUR/CNY'].current,
  'GBP/CNY': OTC_CONFIG['GBP/CNY'].current,
  'USD/INR': OTC_CONFIG['USD/INR'].current,
  'EUR/INR': OTC_CONFIG['EUR/INR'].current,
  'GBP/INR': OTC_CONFIG['GBP/INR'].current,
  'EUR/RUB': OTC_CONFIG['EUR/RUB'].current,
  'GBP/RUB': OTC_CONFIG['GBP/RUB'].current,
  'EUR/UAH': OTC_CONFIG['EUR/UAH'].current,
  'GBP/UAH': OTC_CONFIG['GBP/UAH'].current,
  'USD/MXN': OTC_CONFIG['USD/MXN'].current
};

// Функция генерации следующей цены
function generateNextPrice(pair) {
  const config = OTC_CONFIG[pair];
  if (!config) return config.current;

  const currentPrice = currentPrices[pair];
  
  // Случайное изменение в пределах волатильности
  const change = (Math.random() - 0.5) * 2 * config.volatility;
  let newPrice = currentPrice + change;

  // Ограничиваем диапазоном
  newPrice = Math.max(config.min, Math.min(config.max, newPrice));

  // Округляем до 5 знаков
  newPrice = Math.round(newPrice * 100000) / 100000;

  currentPrices[pair] = newPrice;
  return newPrice;
}

// Генерация тиков (1 тик в секунду)
setInterval(() => {
  Object.keys(OTC_CONFIG).forEach(pair => {
    const close = generateNextPrice(pair);
    const open = currentPrices[pair]; // Предыдущая цена
    
    // Генерируем небольшие колебания для high/low
    const spread = OTC_CONFIG[pair].volatility * 0.5;
    const high = close + Math.random() * spread;
    const low = close - Math.random() * spread;
    const volume = Math.random() * 1000 + 500; // Случайный объем

    const tickTime = Date.now();

    // Формируем сообщение в формате как у Polygon (CAS)
    const message = {
      ev: 'OTC', // OTC событие
      pair: pair,
      o: open,
      c: close,
      h: Math.max(open, high, close),
      l: Math.min(open, low, close),
      v: volume,
      s: tickTime // Время тика
    };

    // Отправляем всем клиентам
    broadcastToClients(message);
  });
}, 1000); // Каждую секунду

// Когда клиент подключается к нашему серверу
wss.on('connection', (ws) => {
  console.log(`✅ Клиент подключился. Всего клиентов: ${clients.size + 1}`);
  clients.add(ws);

  // Отправляем статус подключения
  ws.send(JSON.stringify({
    ev: 'status',
    status: 'otc_ready',
    message: 'OTC Relay готов',
    pairs: Object.keys(OTC_CONFIG)
  }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`🔴 Клиент отключился. Осталось клиентов: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('Ошибка клиента:', err.message);
  });
});

// Функция для отправки сообщения всем клиентам
function broadcastToClients(message) {
  const data = JSON.stringify(message);
  
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Остановка OTC Relay...');
  console.log(`📊 Подключено клиентов: ${clients.size}`);
  
  // Закрываем всех клиентов
  clients.forEach(client => client.close());
  
  // Закрываем WebSocket сервер
  wss.close();
  
  process.exit(0);
});

console.log('✅ Готов к ретрансляции OTC');
console.log(`🌐 Клиенты: ws://localhost:${WS_PORT}\n`);
console.log(`💱 Пары: ${Object.keys(OTC_CONFIG).join(', ')}\n`);
