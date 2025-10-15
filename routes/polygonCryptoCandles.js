const express = require('express');
const router = express.Router();
const PolygonCryptoCandle = require('../models/PolygonCryptoCandle');
const { aggregateCandles, isSupportedTimeframe, getGroupSize } = require('../utils/candleAggregator');

// GET /api/polygon-crypto-candles - Получить крипто свечи из базы с поддержкой агрегации таймфреймов
router.get('/', async (req, res) => {
  try {
    const { 
      pair = 'BTC-USD', 
      limit = 100, 
      timeframe = 5,  // Базовый таймфрейм в БД (всегда 5 секунд)
      tf = 's5'       // Целевой таймфрейм для агрегации (s5, s10, s15, s30, m1, m5, m15)
    } = req.query;
    
    console.log(`📊 Запрос CRYPTO свечей: pair=${pair}, limit=${limit}, tf=${tf}`);
    
    // Проверяем поддерживается ли таймфрейм
    if (!isSupportedTimeframe(tf)) {
      return res.status(400).json({
        success: false,
        error: `Неподдерживаемый таймфрейм: ${tf}. Используйте: s5, s10, s15, s30, m1, m5, m15`
      });
    }
    
    const groupSize = getGroupSize(tf);
    const intervalMs = groupSize * 5000;
    
    // 🚀 ОПТИМИЗАЦИЯ: Если tf=s5, просто возвращаем без агрегации
    if (tf === 's5') {
      const closedCandles = await PolygonCryptoCandle.find({ 
        pair,
        timeframe: Number(timeframe),
        isClosed: true
      })
        .sort({ startTime: -1 })
        .limit(Number(limit))
        .lean();
      
      const activeCandle = await PolygonCryptoCandle.findOne({
        pair,
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
        groupSize: 1,
        market: 'crypto'
      });
    }
    
    // 🚀 НОВОЕ: MongoDB Aggregation Pipeline
    const dbLimit = Number(limit) * groupSize;
    console.log(`🚀 [CRYPTO AGGREGATION] ${dbLimit} свечей через MongoDB pipeline`);
    
    const startTimer = Date.now();
    
    const aggregatedClosed = await PolygonCryptoCandle.aggregate([
      { $match: { pair: pair, timeframe: Number(timeframe), isClosed: true }},
      { $sort: { startTime: -1 }},
      { $limit: dbLimit },
      { $sort: { startTime: 1 }},
      { $addFields: { window: { $subtract: ['$startTime', { $mod: ['$startTime', intervalMs] }] }}},
      { $group: {
          _id: '$window',
          pair: { $first: '$pair' },
          open: { $first: '$open' },
          close: { $last: '$close' },
          high: { $max: '$high' },
          low: { $min: '$low' },
          volume: { $sum: '$volume' },
          startTime: { $min: '$startTime' },
          endTime: { $max: '$endTime' },
          timeframe: { $first: '$timeframe' },
          isClosed: { $min: '$isClosed' },
          createdAt: { $last: '$createdAt' },
          updatedAt: { $last: '$updatedAt' },
          lastId: { $last: '$_id' },
          candleCount: { $sum: 1 }
      }},
      { $sort: { startTime: 1 }},
      { $project: {
          _id: '$lastId',
          pair: 1, open: 1, close: 1, high: 1, low: 1, volume: 1,
          startTime: 1, endTime: 1, timeframe: 1, isClosed: 1,
          createdAt: 1, updatedAt: 1, _aggregatedFrom: '$candleCount'
      }}
    ]);
    
    const activeCandle = await PolygonCryptoCandle.findOne({
      pair, timeframe: Number(timeframe), isClosed: false
    }).sort({ startTime: -1 }).lean();
    
    const aggregationTime = Date.now() - startTimer;
    console.log(`⚡ [CRYPTO AGGREGATION] ${aggregationTime}ms: ${aggregatedClosed.length} свечей`);
    
    if (aggregatedClosed.length === 0 && !activeCandle) {
      return res.json({
        success: true, data: [], count: 0, closedCount: 0,
        hasActiveCandle: false, pair, tf, groupSize, market: 'crypto',
        warning: `Нет данных для ${pair}`
      });
    }
    
    let finalCandles = [...aggregatedClosed];
    
    if (activeCandle) {
      const windowStart = Math.floor(activeCandle.startTime / intervalMs) * intervalMs;
      const lastAggregated = aggregatedClosed[aggregatedClosed.length - 1];
      
      if (lastAggregated && lastAggregated.startTime === windowStart) {
        lastAggregated.close = activeCandle.close;
        lastAggregated.high = Math.max(lastAggregated.high, activeCandle.high);
        lastAggregated.low = Math.min(lastAggregated.low, activeCandle.low);
        lastAggregated.volume += activeCandle.volume;
        lastAggregated.endTime = activeCandle.endTime;
        lastAggregated.isClosed = false;
        lastAggregated.updatedAt = activeCandle.updatedAt;
        lastAggregated._aggregatedFrom = (lastAggregated._aggregatedFrom || 0) + 1;
      } else {
        finalCandles.push({
          _id: activeCandle._id, pair: activeCandle.pair,
          open: activeCandle.open, close: activeCandle.close,
          high: activeCandle.high, low: activeCandle.low,
          volume: activeCandle.volume, startTime: activeCandle.startTime,
          endTime: activeCandle.endTime, timeframe: activeCandle.timeframe,
          isClosed: false, createdAt: activeCandle.createdAt,
          updatedAt: activeCandle.updatedAt, _aggregatedFrom: 1
        });
      }
    }
    
    const limitedCandles = finalCandles.slice(-Number(limit));

    res.json({
      success: true,
      data: limitedCandles,
      count: limitedCandles.length,
      closedCount: limitedCandles.filter(c => c.isClosed).length,
      hasActiveCandle: limitedCandles.some(c => !c.isClosed),
      pair, tf, groupSize, market: 'crypto',
      aggregationTimeMs: aggregationTime
    });
  } catch (error) {
    console.error('❌ Ошибка получения CRYPTO свечей:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

