const WebSocket = require('ws');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const PolygonCryptoCandle = require('./models/PolygonCryptoCandle');

// Загружаем переменные окружения
dotenv.config();

// MongoDB подключение
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'vsepoluchitsa_db';
const RELAY_URL = process.env.QUOTES_WS_URL || 'ws://localhost:8081'; // Crypto Relay

// 🔥 КРИТИЧНО: Валидация данных от Polygon
function validateCandleData(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (!msg.pair || typeof msg.o !== 'number' || typeof msg.c !== 'number' || 
      typeof msg.h !== 'number' || typeof msg.l !== 'number' || typeof msg.v !== 'number') {
    return false;
  }
  
  if (!isFinite(msg.o) || !isFinite(msg.c) || !isFinite(msg.h) || !isFinite(msg.l)) {
    console.warn(`⚠️ Невалидные цены от Polygon CRYPTO: o=${msg.o}, c=${msg.c}, h=${msg.h}, l=${msg.l}`);
    return false;
  }
  
  if (msg.h < msg.l) {
    console.warn(`⚠️ High < Low от Polygon CRYPTO: h=${msg.h}, l=${msg.l}`);
    return false;
  }
  
  if (!isFinite(msg.v) || msg.v < 0) {
    console.warn(`⚠️ Невалидный volume от Polygon CRYPTO: v=${msg.v}`);
    return false;
  }
  
  return true;
}

// 🔥 КРИТИЧНО: Текущие живые свечи для КАЖДОЙ пары (Map: pair → candle)
const currentCandles = new Map();

// 🔥 КРИТИЧНО: История закрытых свечей (защита от memory leak)
const MAX_HISTORY_SIZE = 100;
const candleHistory = [];

console.log('Polygon CRYPTO Listener запущен. 5 Crypto пар (BTC-USD, ETH-USD, LTC-USD, XRP-USD, SOL-USD), 5-сек свечи');

// Подключаемся к MongoDB
mongoose.connect(MONGODB_URI, {
  dbName: DB_NAME
}).then(() => {
  console.log('MongoDB подключена');
}).catch(err => {
  console.error('MongoDB ошибка:', err.message);
  process.exit(1);
});

// Подключаемся к нашему Crypto Relay
console.log('Подключение к Crypto Relay...\n');
const ws = new WebSocket(RELAY_URL);

ws.on('open', () => {
  console.log('✅ Подключено к Crypto Relay');
  
  // 🏠 ROOM-BASED: Подписываемся на ВСЕ 10 Crypto пар
  const cryptoPairs = [
    'BTC-USD', 'ETH-USD', 'LTC-USD', 'XRP-USD', 'SOL-USD',
    'ADA-USD', 'DOT-USD', 'MATIC-USD', 'AVAX-USD', 'LINK-USD'
  ];
  
  cryptoPairs.forEach(pair => {
    ws.send(JSON.stringify({
      action: 'subscribe',
      pair: pair
    }));
  });
  
  console.log('📌 Listener подписался на', cryptoPairs.length, 'Crypto пар для сохранения в БД\n');
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    
    // Обрабатываем XAS события (1-секундные агрегаты для крипты) для всех Crypto пар
    if (msg.ev === 'XAS') {
        // 🔥 КРИТИЧНО: Валидируем данные от Polygon
        if (!validateCandleData(msg)) {
          console.warn(`⚠️ Пропускаем невалидную свечу от Polygon CRYPTO для ${msg.pair}`);
          return;
        }
        
        const tickTime = msg.s; // Время начала 1-секундной свечи в миллисекундах
        const pairName = msg.pair; // Название пары (BTC-USD, ETH-USD и т.д.)
        
        // Определяем 5-секундное окно
        const candleWindowStart = Math.floor(tickTime / 5000) * 5000;
        const candleWindowEnd = candleWindowStart + 5000;
        
        // Получаем текущую свечу ДЛЯ ЭТОЙ ПАРЫ
        let currentCandle = currentCandles.get(pairName);
        
        // Если текущей свечи нет или она из другого 5-секундного окна
        if (!currentCandle || currentCandle.startTime !== candleWindowStart) {
          // Закрываем предыдущую свечу
          if (currentCandle && currentCandle.isLive) {
            const closedCandle = { ...currentCandle, isLive: false };
            candleHistory.unshift(closedCandle);
            // 🔥 КРИТИЧНО: Ограничиваем размер истории (защита от memory leak)
            if (candleHistory.length > MAX_HISTORY_SIZE) {
              candleHistory.length = MAX_HISTORY_SIZE;
            }
            
            // Закрываем свечу в БД (isClosed: true)
            PolygonCryptoCandle.updateOne(
              { pair: closedCandle.pair, startTime: closedCandle.startTime },
              { 
                $set: { 
                  isClosed: true,
                  close: closedCandle.close,
                  high: closedCandle.high,
                  low: closedCandle.low,
                  volume: closedCandle.volume,
                  vw: closedCandle.vw,
                  z: closedCandle.z
                } 
              }
            ).catch(err => console.error(`  [${pairName}] → Ошибка БД:`, err.message));
          }
          
          // Создаём новую 5-секундную свечу
          // ВАЖНО: open новой свечи = close предыдущей ДЛЯ ЭТОЙ ЖЕ ПАРЫ
          const previousClose = currentCandle ? currentCandle.close : msg.o;
          
          currentCandle = {
            pair: pairName,
            open: previousClose,
            close: msg.c,
            high: Math.max(previousClose, msg.h),
            low: Math.min(previousClose, msg.l),
            volume: msg.v,
            startTime: candleWindowStart,
            endTime: candleWindowEnd,
            vw: msg.vw, // Volume weighted average price
            z: msg.z,   // Average trade size
            isLive: true
          };
          
          // Сохраняем в Map для этой пары
          currentCandles.set(pairName, currentCandle);
        } else {
          // Обновляем текущую свечу в том же 5-секундном окне
          currentCandle.close = msg.c;
          // 🔥 КРИТИЧНО: Учитываем close в high/low!
          currentCandle.high = Math.max(currentCandle.high, msg.h, msg.c);
          currentCandle.low = Math.min(currentCandle.low, msg.l, msg.c);
          currentCandle.volume += msg.v;
          currentCandle.vw = msg.vw; // Обновляем VWAP
          currentCandle.z = msg.z;   // Обновляем avg trade size
          
          // Обновляем в Map
          currentCandles.set(pairName, currentCandle);
        }

        // Сохраняем/обновляем текущую активную свечу в БД
        PolygonCryptoCandle.updateOne(
          { pair: currentCandle.pair, startTime: currentCandle.startTime },
          { 
            $set: {
              open: currentCandle.open,
              close: currentCandle.close,
              high: currentCandle.high,
              low: currentCandle.low,
              volume: currentCandle.volume,
              endTime: currentCandle.endTime,
              timeframe: 5,
              isClosed: false,
              vw: currentCandle.vw,
              z: currentCandle.z
            }
          },
          { upsert: true } // Создаём если не существует
        ).catch(err => console.error(`[${pairName}] Ошибка обновления БД:`, err.message));
    }
  } catch (err) {
    console.error('Ошибка:', err.message);
  }
});

ws.on('error', (err) => {
  console.error('Relay ошибка:', err.message);
});

ws.on('close', () => {
  console.log('🔴 Relay отключен. Переподключение...');
  setTimeout(() => process.exit(1), 3000);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log(`\n\nВсего свечей в истории: ${candleHistory.length}`);
  console.log(`Активных пар: ${currentCandles.size}`);
  currentCandles.forEach((candle, pair) => {
    console.log(`  ${pair}: последняя свеча ${new Date(candle.startTime).toLocaleTimeString('ru-RU')}`);
  });
  ws.close();
  await mongoose.connection.close();
  console.log('MongoDB закрыта');
  process.exit(0);
});

