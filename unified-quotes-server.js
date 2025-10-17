/**
 * 🎯 Unified Quotes Server - Один WebSocket для всех типов котировок
 * 
 * Объединяет:
 * 1. Polygon Forex (CAS события)
 * 2. Polygon Crypto (XAS события)
 * 3. OTC Synthetic (OTC события)
 * 
 * Все данные отправляются через ОДИН порт для Render.com
 */

const WebSocket = require('ws');
const fetch = require('node-fetch');
require('dotenv').config();

const PORT = process.env.PORT || 3001;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

// WebSocket сервер для клиентов
const wss = new WebSocket.Server({ port: PORT });

console.log(`🚀 Unified Quotes Server запущен на порту ${PORT}`);
console.log(`📡 Объединенный WebSocket: ws://localhost:${PORT}`);

// Хранилище подключенных клиентов
const clients = new Set();

// ============================================
// 🔥 1. POLYGON FOREX (CAS события)
// ============================================

let polygonForexWs = null;

function connectPolygonForex() {
  if (!POLYGON_API_KEY) {
    console.warn('⚠️ POLYGON_API_KEY не установлен, Forex данные недоступны');
    return;
  }

  const url = `wss://socket.polygon.io/forex`;
  
  try {
    polygonForexWs = new WebSocket(url);
    
    polygonForexWs.on('open', () => {
      console.log('✅ Polygon Forex WebSocket подключен');
      
      // Аутентификация
      polygonForexWs.send(JSON.stringify({
        action: 'auth',
        params: POLYGON_API_KEY
      }));
    });
    
    polygonForexWs.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        
        console.log('📨 Polygon Forex сообщение:', JSON.stringify(messages).substring(0, 200));
        
        messages.forEach(msg => {
          // Успешная аутентификация - подписываемся на пары
          if (msg.ev === 'status' && msg.status === 'auth_success') {
            console.log('🔐 Polygon Forex аутентифицирован');
            
            // Подписка на 20 Forex пар (правильный формат: CAS.EUR/USD)
            polygonForexWs.send(JSON.stringify({
              action: 'subscribe',
              params: 'CAS.EUR/USD,CAS.AUD/CAD,CAS.USD/JPY,CAS.AUD/JPY,CAS.GBP/USD,CAS.GBP/CAD,CAS.EUR/CAD,CAS.CHF/JPY,CAS.CAD/CHF,CAS.USD/CHF,CAS.USD/CAD,CAS.GBP/AUD,CAS.AUD/CHF,CAS.EUR/CHF,CAS.GBP/CHF,CAS.CAD/JPY,CAS.EUR/JPY,CAS.GBP/JPY,CAS.EUR/GBP'
            }));
            
            console.log('📡 Polygon Forex: Подписка на 19 Forex пар');
          }
          
          // Данные свечей - просто ретранслируем как есть!
          if (msg.ev === 'CAS') {
            console.log('💹 Forex данные:', msg.p, msg.c);
            broadcastToClients(msg);
          }
        });
      } catch (err) {
        console.error('❌ Ошибка парсинга Forex:', err);
      }
    });
    
    polygonForexWs.on('close', () => {
      console.log('🔴 Polygon Forex закрыт, переподключение через 5 сек...');
      setTimeout(connectPolygonForex, 5000);
    });
    
    polygonForexWs.on('error', (err) => {
      console.error('❌ Polygon Forex ошибка:', err.message);
    });
    
  } catch (err) {
    console.error('❌ Не удалось подключиться к Polygon Forex:', err.message);
    setTimeout(connectPolygonForex, 10000);
  }
}

// ============================================
// 🔥 2. POLYGON CRYPTO (XAS события)
// ============================================

let polygonCryptoWs = null;

function connectPolygonCrypto() {
  if (!POLYGON_API_KEY) {
    console.warn('⚠️ POLYGON_API_KEY не установлен, Crypto данные недоступны');
    return;
  }

  const url = `wss://socket.polygon.io/crypto`;
  
  try {
    polygonCryptoWs = new WebSocket(url);
    
    polygonCryptoWs.on('open', () => {
      console.log('✅ Polygon Crypto WebSocket подключен');
      
      // Аутентификация
      polygonCryptoWs.send(JSON.stringify({
        action: 'auth',
        params: POLYGON_API_KEY
      }));
    });
    
    polygonCryptoWs.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        
        messages.forEach(msg => {
          // Успешная аутентификация - подписываемся на пары
          if (msg.ev === 'status' && msg.status === 'auth_success') {
            console.log('🔐 Polygon Crypto аутентифицирован');
            
            // Подписка на 10 Crypto пар (правильный формат: XAS.BTC-USD)
            polygonCryptoWs.send(JSON.stringify({
              action: 'subscribe',
              params: 'XAS.BTC-USD,XAS.ETH-USD,XAS.LTC-USD,XAS.XRP-USD,XAS.SOL-USD,XAS.ADA-USD,XAS.DOT-USD,XAS.MATIC-USD,XAS.AVAX-USD,XAS.LINK-USD'
            }));
            
            console.log('📡 Polygon Crypto: Подписка на 10 Crypto пар');
          }
          
          // Данные свечей - просто ретранслируем как есть!
          if (msg.ev === 'XAS') {
            broadcastToClients(msg);
          }
        });
      } catch (err) {
        // Игнорируем ошибки парсинга
      }
    });
    
    polygonCryptoWs.on('close', () => {
      console.log('🔴 Polygon Crypto закрыт, переподключение через 5 сек...');
      setTimeout(connectPolygonCrypto, 5000);
    });
    
    polygonCryptoWs.on('error', (err) => {
      console.error('❌ Polygon Crypto ошибка:', err.message);
    });
    
  } catch (err) {
    console.error('❌ Не удалось подключиться к Polygon Crypto:', err.message);
    setTimeout(connectPolygonCrypto, 10000);
  }
}

// ============================================
// 🔥 3. OTC SYNTHETIC (OTC события)
// ============================================

// Базовые пары для генерации OTC данных
const otcBasePrices = {
  'EUR/USD': 1.08500,
  'AUD/CAD': 0.90500,
  'USD/JPY': 149.500,
  'AUD/JPY': 97.5000,
  'GBP/USD': 1.26500,
  'GBP/CAD': 1.75500,
  'EUR/CAD': 1.46500,
  'CHF/JPY': 170.500,
  'CAD/CHF': 0.62500,
  'USD/CHF': 0.88500,
  'USD/CAD': 1.40500,
  'GBP/AUD': 2.06500,
  'AUD/CHF': 0.56500,
  'EUR/CHF': 0.96500,
  'GBP/CHF': 1.12500,
  'CAD/JPY': 106.500,
  'EUR/JPY': 162.500,
  'EUR/GBP': 0.85500,
  'AUD/USD': 0.65500,
  'NZD/USD': 0.59500
};

function startOTCGeneration() {
  console.log('✅ OTC генератор запущен для', Object.keys(otcBasePrices).length, 'пар');
  
  setInterval(() => {
    Object.entries(otcBasePrices).forEach(([pair, basePrice]) => {
      // Генерируем случайные изменения ±0.05%
      const change = (Math.random() - 0.5) * 0.001 * basePrice;
      const newPrice = basePrice + change;
      
      // Обновляем базовую цену (плавное движение)
      otcBasePrices[pair] = newPrice;
      
      // Генерируем OHLC
      const open = basePrice;
      const close = newPrice;
      const high = Math.max(open, close) * (1 + Math.random() * 0.0001);
      const low = Math.min(open, close) * (1 - Math.random() * 0.0001);
      
      const otcMsg = {
        ev: 'OTC',
        pair: pair,
        o: open,
        c: close,
        h: high,
        l: low,
        v: Math.floor(Math.random() * 100),
        s: Date.now()
      };
      
      // Отправляем всем клиентам
      broadcastToClients(otcMsg);
    });
  }, 1000); // Каждую секунду
}

// ============================================
// 🔥 BROADCAST функция
// ============================================

function broadcastToClients(message) {
  const data = JSON.stringify(message);
  
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// ============================================
// 🔥 КЛИЕНТСКИЕ ПОДКЛЮЧЕНИЯ
// ============================================

wss.on('connection', (ws) => {
  console.log('👤 Новый клиент подключился. Всего:', clients.size + 1);
  clients.add(ws);
  
  // Отправляем статус
  ws.send(JSON.stringify({
    ev: 'status',
    message: 'Подключено к Unified Quotes Server',
    types: ['OTC', 'CAS', 'XAS']
  }));
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log('👋 Клиент отключился. Осталось:', clients.size);
  });
  
  ws.on('error', (err) => {
    console.error('❌ Ошибка клиента:', err.message);
  });
});

// ============================================
// 🔥 ЗАПУСК ВСЕХ ИСТОЧНИКОВ
// ============================================

connectPolygonForex();
connectPolygonCrypto();
startOTCGeneration();

// ============================================
// 🔥 GRACEFUL SHUTDOWN
// ============================================

process.on('SIGTERM', () => {
  console.log('🛑 Получен SIGTERM, закрываем сервер...');
  
  if (polygonForexWs) polygonForexWs.close();
  if (polygonCryptoWs) polygonCryptoWs.close();
  
  wss.close(() => {
    console.log('✅ Сервер закрыт');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Получен SIGINT, закрываем сервер...');
  
  if (polygonForexWs) polygonForexWs.close();
  if (polygonCryptoWs) polygonCryptoWs.close();
  
  wss.close(() => {
    console.log('✅ Сервер закрыт');
    process.exit(0);
  });
});

console.log('\n🎉 Unified Quotes Server готов к работе!');
console.log('📊 Источники: Polygon Forex + Polygon Crypto + OTC Synthetic');
console.log('🔌 Клиенты могут подключаться к ws://localhost:' + PORT + '\n');

