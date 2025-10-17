const express = require('express');
const router = express.Router();
const PolygonCandle = require('../models/PolygonCandle');
const { aggregateCandles, isSupportedTimeframe, getGroupSize } = require('../utils/candleAggregator');

// GET /api/polygon-candles - Получить свечи из базы с поддержкой агрегации таймфреймов
router.get('/', async (req, res) => {
  try {
    const { 
      pair = 'EUR/USD', 
      limit = 100, 
      timeframe = 5,  // Базовый таймфрейм в БД (всегда 5 секунд)
      tf = 's5'       // Целевой таймфрейм для агрегации (s5, s10, s15, s30, m1, m5, m15)
    } = req.query;
    
    // 🔧 ИСПРАВЛЕНИЕ: Убираем слэш из пары для MongoDB (EUR/USD → EURUSD)
    const cleanPair = pair.replace('/', '');
    
    console.log(`📊 Запрос свечей: pair=${pair} → ${cleanPair}, limit=${limit}, tf=${tf}`);
    
    // Проверяем поддерживается ли таймфрейм
    if (!isSupportedTimeframe(tf)) {
      return res.status(400).json({
        success: false,
        error: `Неподдерживаемый таймфрейм: ${tf}. Используйте: s5, s10, s15, s30, m1, m5, m15`
      });
    }
    
    const groupSize = getGroupSize(tf);
    const intervalMs = groupSize * 5000; // Интервал окна в миллисекундах
    
    // 🚀 ОПТИМИЗАЦИЯ: Если tf=s5, просто возвращаем без агрегации
    if (tf === 's5') {
      const closedCandles = await PolygonCandle.find({ 
        pair: cleanPair,
        timeframe: Number(timeframe),
        isClosed: true
      })
        .sort({ startTime: -1 })
        .limit(Number(limit))
        .lean(); // ← Быстрее чем toObject()
      
      const activeCandle = await PolygonCandle.findOne({
        pair: cleanPair,
        timeframe: Number(timeframe),
        isClosed: false
      })
        .sort({ startTime: -1 })
        .lean();
      
      const allCandles = [...closedCandles];
      if (activeCandle) {
        allCandles.push(activeCandle);
      }
      
      const sorted = allCandles.sort((a, b) => a.startTime - b.startTime);
      
      return res.json({
        success: true,
        data: sorted,
        count: sorted.length,
        closedCount: closedCandles.length,
        hasActiveCandle: !!activeCandle,
        pair,
        tf,
        groupSize: 1
      });
    }
    
    // 🚀 НОВОЕ: MongoDB Aggregation Pipeline (В 5-10 РАЗ БЫСТРЕЕ!)
    const dbLimit = Number(limit) * groupSize;
    
    console.log(`🚀 [AGGREGATION] Агрегируем ${dbLimit} свечей через MongoDB pipeline (groupSize=${groupSize})`);
    
    const startTimer = Date.now();
    
    // 1. Агрегируем ЗАКРЫТЫЕ свечи через MongoDB pipeline
    const aggregatedClosed = await PolygonCandle.aggregate([
      // Фильтр по паре и закрытым свечам
      { 
        $match: { 
          pair: cleanPair,
          timeframe: Number(timeframe),
          isClosed: true
        }
      },
      
      // Сортировка по времени (новые → старые)
      { $sort: { startTime: -1 }},
      
      // Берем только нужное количество
      { $limit: dbLimit },
      
      // Реверсируем обратно (старые → новые) для правильной группировки
      { $sort: { startTime: 1 }},
      
      // Вычисляем window для каждой свечи
      {
        $addFields: {
          window: {
            $subtract: [
              '$startTime',
              { $mod: ['$startTime', intervalMs] }
            ]
          }
        }
      },
      
      // Группируем по window
      {
        $group: {
          _id: '$window',
          pair: { $first: '$pair' },
          open: { $first: '$open' },           // Первая свеча в группе
          close: { $last: '$close' },          // Последняя свеча
          high: { $max: '$high' },             // Максимум
          low: { $min: '$low' },               // Минимум
          volume: { $sum: '$volume' },         // Сумма объемов
          startTime: { $min: '$startTime' },   // Начало окна
          endTime: { $max: '$endTime' },       // Конец окна
          timeframe: { $first: '$timeframe' }, // Базовый таймфрейм
          isClosed: { $min: '$isClosed' },     // true только если ВСЕ закрыты (min из true/false)
          createdAt: { $last: '$createdAt' },  // Последняя запись
          updatedAt: { $last: '$updatedAt' },
          lastId: { $last: '$_id' },           // ID последней свечи
          candleCount: { $sum: 1 }             // Количество свечей в группе
        }
      },
      
      // Сортировка результата по времени (старые → новые)
      { $sort: { startTime: 1 }},
      
      // Берем последние limit свечей
      { 
        $project: {
          _id: '$lastId',
          pair: 1,
          open: 1,
          close: 1,
          high: 1,
          low: 1,
          volume: 1,
          startTime: 1,
          endTime: 1,
          timeframe: 1,
          isClosed: 1,
          createdAt: 1,
          updatedAt: 1,
          _aggregatedFrom: '$candleCount'
        }
      }
    ]);
    
    // 2. Получаем активную свечу отдельно
    const activeCandle = await PolygonCandle.findOne({
      pair: cleanPair,
      timeframe: Number(timeframe),
      isClosed: false
    })
      .sort({ startTime: -1 })
      .lean();
    
    const aggregationTime = Date.now() - startTimer;
    console.log(`⚡ [AGGREGATION] Завершено за ${aggregationTime}ms: ${aggregatedClosed.length} свечей`);
    
    // 🔥 Если данных нет
    if (aggregatedClosed.length === 0 && !activeCandle) {
      console.warn(`⚠️ Нет данных для пары ${pair} (${cleanPair}) в БД`);
      return res.json({
        success: true,
        data: [],
        count: 0,
        closedCount: 0,
        hasActiveCandle: false,
        pair,
        tf,
        groupSize,
        warning: `Нет данных для ${pair}. Подождите несколько секунд пока listener соберет историю.`
      });
    }
    
    // 3. Обрабатываем активную свечу
    let finalCandles = [...aggregatedClosed];
    
    if (activeCandle) {
      // Проверяем попадает ли активная свеча в то же окно что и последняя закрытая
      const windowStart = Math.floor(activeCandle.startTime / intervalMs) * intervalMs;
      const lastAggregated = aggregatedClosed[aggregatedClosed.length - 1];
      
      if (lastAggregated && lastAggregated.startTime === windowStart) {
        // Активная свеча в том же окне - обновляем последнюю агрегированную
        lastAggregated.close = activeCandle.close;
        lastAggregated.high = Math.max(lastAggregated.high, activeCandle.high);
        lastAggregated.low = Math.min(lastAggregated.low, activeCandle.low);
        lastAggregated.volume += activeCandle.volume;
        lastAggregated.endTime = activeCandle.endTime;
        lastAggregated.isClosed = false; // Помечаем как незакрытую
        lastAggregated.updatedAt = activeCandle.updatedAt;
        lastAggregated._aggregatedFrom = (lastAggregated._aggregatedFrom || 0) + 1;
      } else {
        // Активная свеча в новом окне - добавляем как есть
        finalCandles.push({
          _id: activeCandle._id,
          pair: activeCandle.pair,
          open: activeCandle.open,
          close: activeCandle.close,
          high: activeCandle.high,
          low: activeCandle.low,
          volume: activeCandle.volume,
          startTime: activeCandle.startTime,
          endTime: activeCandle.endTime,
          timeframe: activeCandle.timeframe,
          isClosed: false,
          createdAt: activeCandle.createdAt,
          updatedAt: activeCandle.updatedAt,
          _aggregatedFrom: 1
        });
      }
    }
    
    // 4. Обрезаем до нужного limit (берем последние)
    const limitedCandles = finalCandles.slice(-Number(limit));
    
    console.log(`✅ Результат: ${limitedCandles.length} свечей (закрытых: ${limitedCandles.filter(c => c.isClosed).length})`);
    
    res.json({
      success: true,
      data: limitedCandles,
      count: limitedCandles.length,
      closedCount: limitedCandles.filter(c => c.isClosed).length,
      hasActiveCandle: limitedCandles.some(c => !c.isClosed),
      pair,
      tf,
      groupSize,
      aggregationTimeMs: aggregationTime // 🔥 НОВОЕ: Показываем время агрегации
    });
  } catch (error) {
    console.error('❌ Ошибка получения свечей:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

