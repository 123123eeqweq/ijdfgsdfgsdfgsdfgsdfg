const WebSocket = require('ws');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const OtcCandle = require('./models/OtcCandle');

// Загружаем переменные окружения
dotenv.config();

// MongoDB подключение
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'vsepoluchitsa_db';
const RELAY_URL = process.env.QUOTES_WS_URL || 'ws://localhost:8082'; // OTC Relay

// 🔥 КРИТИЧНО: Валидация данных от Polygon
function validateCandleData(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (!msg.pair || typeof msg.o !== 'number' || typeof msg.c !== 'number' || 
      typeof msg.h !== 'number' || typeof msg.l !== 'number' || typeof msg.v !== 'number') {
    return false;
  }
  
  if (!isFinite(msg.o) || !isFinite(msg.c) || !isFinite(msg.h) || !isFinite(msg.l)) {
    console.warn(`⚠️ Невалидные цены от Polygon OTC: o=${msg.o}, c=${msg.c}, h=${msg.h}, l=${msg.l}`);
    return false;
  }
  
  if (msg.h < msg.l) {
    console.warn(`⚠️ High < Low от Polygon OTC: h=${msg.h}, l=${msg.l}`);
    return false;
  }
  
  if (!isFinite(msg.v) || msg.v < 0) {
    console.warn(`⚠️ Невалидный volume от Polygon OTC: v=${msg.v}`);
    return false;
  }
  
  return true;
}

// 🔥 КРИТИЧНО: Текущие живые свечи для КАЖДОЙ пары (Map: pair → candle)
const currentCandles = new Map();

// 🔥 КРИТИЧНО: История закрытых свечей (защита от memory leak)
const MAX_HISTORY_SIZE = 100;
const candleHistory = [];

console.log('OTC Listener запущен. 5 OTC пар (EUR/USD, AUD/CAD, USD/JPY, AUD/JPY, GBP/USD), 5-сек свечи');

// Подключаемся к MongoDB
mongoose.connect(MONGODB_URI, {
  dbName: DB_NAME
}).then(() => {
  console.log('MongoDB подключена');
}).catch(err => {
  console.error('MongoDB ошибка:', err.message);
  process.exit(1);
});

// Подключаемся к нашему OTC Relay
console.log('Подключение к OTC Relay...\n');
const ws = new WebSocket(RELAY_URL);

ws.on('open', () => {
  console.log('✅ Подключено к OTC Relay\n');
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    
    // Обрабатываем OTC события (1-секундные тики) для всех OTC пар
    if (msg.ev === 'OTC') {
        // 🔥 КРИТИЧНО: Валидируем данные от Polygon
        if (!validateCandleData(msg)) {
          console.warn(`⚠️ Пропускаем невалидную свечу от Polygon OTC для ${msg.pair}`);
          return;
        }
        
        const tickTime = msg.s; // Время тика в миллисекундах
        const pairName = msg.pair; // Название пары (EUR/USD, AUD/CAD и т.д.)
        
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
            
            // Минимальный вывод закрытой свечи
            const time = new Date(closedCandle.startTime).toLocaleTimeString('ru-RU');
            const direction = closedCandle.close >= closedCandle.open ? '▲' : '▼';
            console.log(`[${pairName} OTC] ${time} ${direction} O:${closedCandle.open.toFixed(5)} H:${closedCandle.high.toFixed(5)} L:${closedCandle.low.toFixed(5)} C:${closedCandle.close.toFixed(5)} V:${closedCandle.volume.toFixed(0)}`);
            
            // Закрываем свечу в БД (isClosed: true)
            OtcCandle.updateOne(
              { pair: closedCandle.pair, startTime: closedCandle.startTime },
              { 
                $set: { 
                  isClosed: true,
                  close: closedCandle.close,
                  high: closedCandle.high,
                  low: closedCandle.low,
                  volume: closedCandle.volume
                } 
              }
            ).catch(err => console.error(`  [${pairName} OTC] → Ошибка БД:`, err.message));
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
          
          // Обновляем в Map
          currentCandles.set(pairName, currentCandle);
        }

        // Сохраняем/обновляем текущую активную свечу в БД
        OtcCandle.updateOne(
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
              isClosed: false
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
  console.error('OTC Relay ошибка:', err.message);
});

ws.on('close', () => {
  console.log('🔴 OTC Relay отключен. Переподключение...');
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
