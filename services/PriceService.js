/**
 * 🎯 PriceService - Сервис для получения РЕАЛЬНЫХ цен
 * 
 * ВАЖНО: Backend САМ получает цены, клиент НЕ может их подделать!
 * 
 * 🚀 ОПТИМИЗАЦИЯ: In-memory кэш цен из WebSocket (~0ms вместо ~50ms из MongoDB)
 */

const PolygonCandle = require('../models/PolygonCandle');
const PolygonCryptoCandle = require('../models/PolygonCryptoCandle');
const OtcCandle = require('../models/OtcCandle');
const WebSocket = require('ws');

class PriceService {
  constructor() {
    // 🚀 НОВОЕ: In-memory кэш цен
    this.priceCache = new Map(); // pair -> {price, timestamp, source}
    
    // WebSocket подключения
    this.wsConnections = {
      otc: null,
      polygon: null,
      polygonCrypto: null
    };
    
    // Инициализируем WebSocket подключения
    this.initializeWebSockets();
  }

  /**
   * 🚀 НОВОЕ: Инициализация WebSocket подключений для real-time цен
   */
  initializeWebSockets() {
    // WebSocket URLs из env переменных (для Railway) или localhost (для локальной разработки)
    const QUOTES_WS_URL = process.env.QUOTES_WS_URL || 'ws://localhost:8080';
    
    console.log('🔌 PriceService: Инициализация WebSocket подключений...');
    console.log(`   📡 Quotes WebSocket: ${QUOTES_WS_URL}`);
    
    // OTC WebSocket - все идут через один Quotes сервис
    this.connectToWebSocket('otc', QUOTES_WS_URL, (message) => {
      if (message.ev === 'OTC' && message.pair && message.c) {
        // Кэшируем как "EUR/USD OTC"
        const cacheKey = `${message.pair} OTC`;
        this.priceCache.set(cacheKey, {
          price: message.c,
          timestamp: message.s || Date.now(),
          source: 'OTC WebSocket'
        });
      }
    });

    // Polygon Forex WebSocket - все идут через один Quotes сервис
    this.connectToWebSocket('polygon', QUOTES_WS_URL, (message) => {
      if (message.ev === 'CAS' && message.pair && message.c) {
        // Polygon приходит как "EURUSD" → кэшируем как "EUR/USD"
        const formattedPair = this.formatPolygonPair(message.pair);
        this.priceCache.set(formattedPair, {
          price: message.c,
          timestamp: message.s || Date.now(),
          source: 'Polygon Forex WebSocket'
        });
      }
    });

    // Polygon Crypto WebSocket - все идут через один Quotes сервис
    this.connectToWebSocket('polygonCrypto', QUOTES_WS_URL, (message) => {
      if (message.ev === 'XAS' && message.pair && message.c) {
        // Crypto приходит как "BTC-USD" → кэшируем как "BTC/USD"
        const formattedPair = message.pair.replace('-', '/');
        this.priceCache.set(formattedPair, {
          price: message.c,
          timestamp: message.s || Date.now(),
          source: 'Polygon Crypto WebSocket'
        });
      }
    });
  }

  /**
   * Подключение к WebSocket с auto-reconnect
   */
  connectToWebSocket(name, url, onMessage) {
    const connect = () => {
      try {
        const ws = new WebSocket(url);
        
        ws.on('open', () => {
          console.log(`✅ PriceService: ${name} WebSocket подключен (${url})`);
          this.wsConnections[name] = ws;
        });

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            onMessage(message);
          } catch (err) {
            // Игнорируем ошибки парсинга
          }
        });

        ws.on('error', (err) => {
          console.warn(`⚠️ PriceService: ${name} WebSocket ошибка:`, err.message);
        });

        ws.on('close', () => {
          console.warn(`🔴 PriceService: ${name} WebSocket отключен, переподключение через 5 сек...`);
          this.wsConnections[name] = null;
          
          // Auto-reconnect через 5 секунд
          setTimeout(() => connect(), 5000);
        });
      } catch (err) {
        console.error(`❌ PriceService: Не удалось подключиться к ${name}:`, err.message);
        // Повторная попытка через 10 секунд
        setTimeout(() => connect(), 10000);
      }
    };

    connect();
  }

  /**
   * Форматирование пары из Polygon (EURUSD → EUR/USD)
   */
  formatPolygonPair(pair) {
    // Простая логика: разбиваем на две части по 3 символа
    if (pair.length === 6) {
      return `${pair.slice(0, 3)}/${pair.slice(3)}`;
    }
    return pair;
  }

  /**
   * Получить текущую рыночную цену для пары
   * @param {string} pair - Валютная пара (например: "EUR/USD", "BTC/USD", "EUR/USD OTC")
   * @returns {Promise<{price: number, timestamp: number, source: string}>}
   */
  async getCurrentPrice(pair) {
    try {
      // 🚀 ОПТИМИЗАЦИЯ: Сначала проверяем in-memory кэш
      const cached = this.priceCache.get(pair);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        const MAX_CACHE_AGE = 1 * 1000; // 🔥 УМЕНЬШЕНО: 1 секунда (было 10) для СВЕЖИХ цен при открытии сделок
        
        if (age < MAX_CACHE_AGE) {
          // Кэш свежий - возвращаем МГНОВЕННО! (~0ms)
          return {
            price: cached.price,
            timestamp: cached.timestamp,
            source: cached.source + ' (cached)',
            age
          };
        } else {
          console.warn(`⚠️ Кэш для ${pair} устарел (${Math.round(age / 1000)}s), используем MongoDB...`);
        }
      }

      // 🔥 FALLBACK: Если нет в кэше или устарел - запрашиваем из MongoDB
      // (например, при первом запуске до подключения WS)
      let candle;
      let source;

      if (pair.includes('OTC')) {
        // OTC пары
        // ⚠️ ВАЖНО: В OTC БД хранится "EUR/USD" (со слэшем!), убираем только " OTC"
        const cleanPair = pair.replace(' OTC', '');
        candle = await OtcCandle.findOne({ pair: cleanPair })
          .sort({ startTime: -1 }) // OTC использует startTime, не timestamp!
          .limit(1);
        source = 'OTC';
      } else if (pair.includes('BTC') || pair.includes('ETH') || pair.includes('LTC') || 
                 pair.includes('XRP') || pair.includes('ADA') || pair.includes('SOL') ||
                 pair.includes('DOT') || pair.includes('MATIC') || pair.includes('AVAX') || pair.includes('LINK')) {
        // Крипто пары
        const cleanPair = pair.replace('/', '-');
        candle = await PolygonCryptoCandle.findOne({ pair: cleanPair })
          .sort({ startTime: -1 })
          .limit(1);
        source = 'Polygon Crypto';
      } else {
        // Forex пары
        const cleanPair = pair.replace('/', '');
        candle = await PolygonCandle.findOne({ pair: cleanPair })
          .sort({ startTime: -1 }) // ✅ ИСПРАВЛЕНО: используем startTime вместо timestamp
          .limit(1);
        source = 'Polygon Forex';
      }

      if (!candle) {
        const hint = pair.includes('OTC') 
          ? 'Убедитесь что OTC listener запущен: npm run otc' 
          : pair.includes('BTC') || pair.includes('ETH') || pair.includes('LTC') || 
            pair.includes('XRP') || pair.includes('ADA') || pair.includes('SOL') ||
            pair.includes('DOT') || pair.includes('MATIC') || pair.includes('AVAX') || pair.includes('LINK')
            ? 'Убедитесь что Polygon Crypto listener запущен: npm run polygon-crypto'
            : 'Убедитесь что Polygon listener запущен: npm run polygon';
        throw new Error(`Нет данных для пары ${pair}. ${hint}`);
      }

      // 🔥 ЗАЩИТА: Проверяем что данные свежие (не старше 1 минуты)
      const now = Date.now();
      // OTC использует startTime, остальные - timestamp
      const candleTimestamp = candle.startTime || candle.timestamp;
      const candleAge = now - candleTimestamp;
      const MAX_AGE = 60 * 1000; // 1 минута

      if (candleAge > MAX_AGE) {
        console.warn(`⚠️ Устаревшие данные для ${pair}: ${Math.round(candleAge / 1000)}s назад`);
        // Можно либо выбросить ошибку, либо вернуть с предупреждением
        // throw new Error(`Данные для ${pair} устарели (${Math.round(candleAge / 1000)}s назад)`);
      }

      // 🔥 ЗАЩИТА: Проверяем валидность цены
      if (!candle.close || typeof candle.close !== 'number' || !isFinite(candle.close) || candle.close <= 0) {
        throw new Error(`Некорректная цена для ${pair}: ${candle.close}`);
      }

      // 🚀 НОВОЕ: Обновляем кэш после получения из MongoDB
      this.priceCache.set(pair, {
        price: candle.close,
        timestamp: candleTimestamp,
        source: source + ' (MongoDB)'
      });

      return {
        price: candle.close,
        timestamp: candleTimestamp,
        source,
        age: candleAge
      };
    } catch (error) {
      console.error(`❌ Ошибка получения цены для ${pair}:`, error);
      throw error;
    }
  }

  /**
   * Получить цену на конкретный момент времени (для закрытия сделки)
   * @param {string} pair - Валютная пара
   * @param {number} timestamp - Unix timestamp в миллисекундах
   * @param {number} toleranceMs - Допуск по времени (по умолчанию 5 секунд)
   * @returns {Promise<{price: number, timestamp: number, source: string}>}
   */
  async getPriceAtTime(pair, timestamp, toleranceMs = 5000) {
    try {
      // 🔥 ЗАЩИТА: Проверяем валидность timestamp
      const now = Date.now();
      const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
      
      if (timestamp > now + ONE_YEAR) {
        console.warn(`⚠️ Подозрительный timestamp для ${pair}: ${timestamp} (${new Date(timestamp).toISOString()}), используем текущее время`);
        timestamp = now;
      }
      
      if (timestamp < now - 30 * 24 * 60 * 60 * 1000) { // Старше 30 дней
        console.warn(`⚠️ Очень старый timestamp для ${pair}: ${timestamp} (${new Date(timestamp).toISOString()})`);
      }

      let candle;
      let source;

      if (pair.includes('OTC')) {
        // ⚠️ ВАЖНО: В OTC БД хранится "EUR/USD" (со слэшем!), убираем только " OTC"
        const cleanPair = pair.replace(' OTC', '');
        // Ищем свечу, ближайшую к timestamp (в пределах toleranceMs)
        // OTC использует startTime, не timestamp!
        candle = await OtcCandle.findOne({
          pair: cleanPair,
          startTime: {
            $gte: timestamp - toleranceMs,
            $lte: timestamp + toleranceMs
          }
        })
          .sort({ startTime: -1 })
          .limit(1);
        source = 'OTC';
        
        // 🚀 FALLBACK: Если не нашли в допуске, ищем ближайшую доступную
        if (!candle) {
          console.warn(`⚠️ Нет данных для ${pair} в допуске ±${toleranceMs}ms, ищем ближайшую свечу...`);
          candle = await OtcCandle.findOne({ pair: cleanPair })
            .sort({ startTime: -1 })
            .limit(1);
          source = 'OTC (fallback - последняя доступная)';
        }
      } else if (pair.includes('BTC') || pair.includes('ETH') || pair.includes('LTC') || 
                 pair.includes('XRP') || pair.includes('ADA') || pair.includes('SOL') ||
                 pair.includes('DOT') || pair.includes('MATIC') || pair.includes('AVAX') || pair.includes('LINK')) {
        const cleanPair = pair.replace('/', '-');
        candle = await PolygonCryptoCandle.findOne({
          pair: cleanPair,
          startTime: {
            $gte: timestamp - toleranceMs,
            $lte: timestamp + toleranceMs
          }
        })
          .sort({ startTime: -1 })
          .limit(1);
        source = 'Polygon Crypto';
        
        // 🚀 FALLBACK
        if (!candle) {
          console.warn(`⚠️ Нет данных для ${pair} в допуске ±${toleranceMs}ms, ищем ближайшую свечу...`);
          candle = await PolygonCryptoCandle.findOne({ pair: cleanPair })
            .sort({ startTime: -1 })
            .limit(1);
          source = 'Polygon Crypto (fallback - последняя доступная)';
        }
      } else {
        const cleanPair = pair.replace('/', '');
        candle = await PolygonCandle.findOne({
          pair: cleanPair,
          startTime: { // ✅ ИСПРАВЛЕНО: используем startTime вместо timestamp
            $gte: timestamp - toleranceMs,
            $lte: timestamp + toleranceMs
          }
        })
          .sort({ startTime: -1 }) // ✅ ИСПРАВЛЕНО: используем startTime вместо timestamp
          .limit(1);
        source = 'Polygon Forex';
        
        // 🚀 FALLBACK
        if (!candle) {
          console.warn(`⚠️ Нет данных для ${pair} в допуске ±${toleranceMs}ms, ищем ближайшую свечу...`);
          candle = await PolygonCandle.findOne({ pair: cleanPair })
            .sort({ startTime: -1 }) // ✅ ИСПРАВЛЕНО: используем startTime вместо timestamp
            .limit(1);
          source = 'Polygon Forex (fallback - последняя доступная)';
        }
      }

      if (!candle) {
        // 🚀 КРАЙНИЙ FALLBACK: Пытаемся получить текущую цену
        console.warn(`⚠️ Нет исторических данных для ${pair}, пытаемся получить текущую цену...`);
        try {
          const currentPrice = await this.getCurrentPrice(pair);
          return {
            price: currentPrice.price,
            timestamp: currentPrice.timestamp,
            source: currentPrice.source + ' (fallback - текущая цена)',
            timeDiff: Math.abs(currentPrice.timestamp - timestamp),
            warning: 'Использована текущая цена вместо исторической'
          };
        } catch (fallbackError) {
          throw new Error(`Нет данных для ${pair} на момент ${new Date(timestamp).toISOString()} и не удалось получить текущую цену`);
        }
      }

      // 🔥 ЗАЩИТА: Проверяем валидность цены
      if (!candle.close || typeof candle.close !== 'number' || !isFinite(candle.close) || candle.close <= 0) {
        throw new Error(`Некорректная цена для ${pair} на момент ${timestamp}: ${candle.close}`);
      }

      // OTC использует startTime, остальные - timestamp
      const candleTimestamp = candle.startTime || candle.timestamp;
      const timeDiff = Math.abs(candleTimestamp - timestamp);
      
      // Предупреждаем если разница большая
      if (timeDiff > toleranceMs) {
        console.warn(`⚠️ Большая разница во времени для ${pair}: ${Math.round(timeDiff / 1000)}s (допуск: ${toleranceMs / 1000}s)`);
      }

      return {
        price: candle.close,
        timestamp: candleTimestamp,
        source,
        timeDiff
      };
    } catch (error) {
      console.error(`❌ Ошибка получения цены для ${pair} на момент ${timestamp}:`, error);
      throw error;
    }
  }

  /**
   * 🚀 НОВОЕ: Получить статистику кэша (для мониторинга)
   */
  getCacheStats() {
    const now = Date.now();
    const pairs = [];
    
    this.priceCache.forEach((value, key) => {
      pairs.push({
        pair: key,
        price: value.price,
        age: Math.round((now - value.timestamp) / 1000), // в секундах
        source: value.source
      });
    });
    
    return {
      totalPairs: pairs.length,
      pairs: pairs.sort((a, b) => a.age - b.age), // Сортируем по возрасту
      wsConnections: {
        otc: this.wsConnections.otc?.readyState === 1,
        polygon: this.wsConnections.polygon?.readyState === 1,
        polygonCrypto: this.wsConnections.polygonCrypto?.readyState === 1
      }
    };
  }

  /**
   * Проверить, существует ли валютная пара
   * @param {string} pair - Валютная пара
   * @returns {Promise<boolean>}
   */
  async isPairValid(pair) {
    const validPairs = [
      // OTC Forex (20 основных пар)
      'EUR/USD OTC', 'AUD/CAD OTC', 'USD/JPY OTC', 'AUD/JPY OTC', 'GBP/USD OTC', 'GBP/CAD OTC', 'EUR/CAD OTC', 'CHF/JPY OTC', 'CAD/CHF OTC', 'USD/CHF OTC', 'USD/CAD OTC', 'GBP/AUD OTC', 'AUD/CHF OTC', 'EUR/CHF OTC', 'GBP/CHF OTC', 'CAD/JPY OTC', 'EUR/JPY OTC', 'GBP/JPY OTC', 'EUR/GBP OTC', 'AUD/USD OTC',
      // OTC Forex (30 дополнительных пар)
      'USD/UAH OTC', 'USD/RUB OTC', 'NZD/USD OTC', 'EUR/AUD OTC', 'NZD/JPY OTC', 'AUD/NZD OTC', 'EUR/NZD OTC', 'GBP/NZD OTC', 'NZD/CHF OTC', 'NZD/CAD OTC', 'USD/CNY OTC', 'EUR/CNY OTC', 'GBP/CNY OTC', 'USD/INR OTC', 'EUR/INR OTC', 'GBP/INR OTC', 'EUR/RUB OTC', 'GBP/RUB OTC', 'EUR/UAH OTC', 'GBP/UAH OTC', 'USD/MXN OTC',
      // OTC Crypto (10 пар)
      'BTC/USD OTC', 'ETH/USD OTC', 'LTC/USD OTC', 'XRP/USD OTC', 'SOL/USD OTC', 'ADA/USD OTC', 'DOT/USD OTC', 'MATIC/USD OTC', 'AVAX/USD OTC', 'LINK/USD OTC',
      // Forex (20 пар)
      'EUR/USD', 'AUD/CAD', 'USD/JPY', 'AUD/JPY', 'GBP/USD', 'GBP/CAD', 'EUR/CAD', 'CHF/JPY', 'CAD/CHF', 'USD/CHF', 'USD/CAD', 'GBP/AUD', 'AUD/CHF', 'EUR/CHF', 'GBP/CHF', 'CAD/JPY', 'EUR/JPY', 'AUD/JPY', 'EUR/GBP', 'GBP/JPY',
      // Crypto (10 пар)
      'BTC/USD', 'ETH/USD', 'LTC/USD', 'XRP/USD', 'SOL/USD', 'ADA/USD', 'DOT/USD', 'MATIC/USD', 'AVAX/USD', 'LINK/USD'
    ];

    return validPairs.includes(pair);
  }
}

module.exports = new PriceService();

