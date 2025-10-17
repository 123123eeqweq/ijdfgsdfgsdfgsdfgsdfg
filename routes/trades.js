/**
 * 🔒 БЕЗОПАСНЫЕ роуты для торговли
 * 
 * ПРИНЦИПЫ:
 * 1. Backend САМ определяет entryPrice (клиент не может подделать)
 * 2. Backend САМ закрывает сделки через worker (клиент не контролирует closePrice)
 * 3. Используем транзакции для атомарности
 * 4. Валидация всех параметров
 * 5. Rate limiting
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Trade = require('../models/Trade');
const User = require('../models/User');
const auth = require('../middleware/auth');
const PriceService = require('../services/PriceService');

// 🔥 Rate Limiting - защита от спама (смягченный для комфортного тестирования)
let createTradeLimit;
try {
  const rateLimit = require('express-rate-limit');
  createTradeLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 минута
    max: 100, // Максимум 100 сделок в минуту (увеличено с 10 для комфортной работы)
    message: {
      success: false,
      error: 'Слишком много запросов. Попробуйте через минуту.'
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
} catch (err) {
  console.warn('⚠️ express-rate-limit не установлен, rate limiting отключен');
  // Fallback - пустой middleware
  createTradeLimit = (req, res, next) => next();
}

// 📊 Получить активные сделки пользователя
router.get('/active', auth, async (req, res) => {
  try {
    const trades = await Trade.find({
      userId: req.user.userId,
      status: 'active'
    }).sort({ entryTime: -1 });

    res.json({
      success: true,
      data: trades
    });
  } catch (error) {
    console.error('❌ Ошибка получения активных сделок:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 📊 Получить историю сделок пользователя
router.get('/history', auth, async (req, res) => {
  try {
    // 🚀 Поддержка обоих параметров: skip и offset
    const { limit = 50, skip = 0, offset } = req.query;
    // 🔥 ИСПРАВЛЕНО: правильная проверка на undefined, а не на falsy
    const skipValue = offset !== undefined ? Number(offset) : Number(skip);

    const trades = await Trade.find({
      userId: req.user.userId,
      status: { $in: ['won', 'lost', 'cancelled'] }
    })
      .sort({ closeTime: -1 })
      .limit(Number(limit))
      .skip(skipValue);

    const total = await Trade.countDocuments({
      userId: req.user.userId,
      status: { $in: ['won', 'lost', 'cancelled'] }
    });

    res.json({
      success: true,
      data: trades,
      total,
      limit: Number(limit),
      skip: skipValue,
      offset: skipValue // Возвращаем оба для совместимости
    });
  } catch (error) {
    console.error('❌ Ошибка получения истории сделок:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🚀 БЕЗОПАСНОЕ создание сделки
router.post('/create', auth, createTradeLimit, async (req, res) => {
  // Используем транзакцию для атомарности
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      pair,
      amount,
      direction, // 'up' или 'down'
      expirationSeconds, // Время экспирации в секундах
      payout = 94, // Доходность по умолчанию 94%
      accountType = 'demo' // Тип счета: 'demo' или 'real'
    } = req.body;

    // 🔍 ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ для отладки
    console.log('📥 Получен запрос на создание сделки:', {
      pair,
      amount,
      direction,
      expirationSeconds,
      payout,
      accountType,
      user: req.user?.email || req.user?.userId
    });

    // ============================================
    // 🔥 ВАЛИДАЦИЯ ВХОДНЫХ ДАННЫХ
    // ============================================
    
    // Проверка обязательных полей
    if (!pair || !amount || !direction || !expirationSeconds) {
      console.error('❌ Валидация: не все параметры переданы', { pair, amount, direction, expirationSeconds });
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Не все параметры переданы',
        details: {
          pair: !!pair,
          amount: !!amount,
          direction: !!direction,
          expirationSeconds: !!expirationSeconds
        }
      });
    }

    // Проверка типа счета
    if (!['demo', 'real'].includes(accountType)) {
      console.error('❌ Валидация: некорректный тип счета', accountType);
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Тип счета должен быть "demo" или "real"',
        details: { accountType }
      });
    }

    // Проверка валидности пары
    console.log('🔍 Проверка валидности пары:', pair);
    const isPairValid = await PriceService.isPairValid(pair);
    if (!isPairValid) {
      console.error('❌ Валидация: недопустимая пара', pair);
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: `Недопустимая валютная пара: ${pair}`
      });
    }

    // Проверка суммы
    console.log('🔍 Проверка суммы:', amount, typeof amount);
    if (typeof amount !== 'number' || amount < 1 || amount > 900000) {
      console.error('❌ Валидация: некорректная сумма', { amount, type: typeof amount });
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Сумма должна быть от $1 до $900,000',
        details: { amount, type: typeof amount }
      });
    }

    // Проверка направления
    console.log('🔍 Проверка направления:', direction);
    if (!['up', 'down'].includes(direction)) {
      console.error('❌ Валидация: некорректное направление', direction);
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Направление должно быть "up" или "down"',
        details: { direction }
      });
    }

    // Проверка времени экспирации
    console.log('🔍 Проверка времени экспирации:', expirationSeconds, typeof expirationSeconds);
    if (typeof expirationSeconds !== 'number' || expirationSeconds < 5 || expirationSeconds > 3600) {
      console.error('❌ Валидация: некорректное время экспирации', { expirationSeconds, type: typeof expirationSeconds });
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Время экспирации должно быть от 5 секунд до 1 часа',
        details: { expirationSeconds, type: typeof expirationSeconds }
      });
    }

    // ============================================
    // 🔥 ПОЛУЧАЕМ РЕАЛЬНУЮ ЦЕНУ ВХОДА (BACKEND!)
    // ============================================
    
    const priceData = await PriceService.getCurrentPrice(pair);
    const entryPrice = priceData.price;
    const entryTime = Date.now();

    console.log(`📈 Цена входа для ${pair}: ${entryPrice} (источник: ${priceData.source}, возраст: ${priceData.age}ms)`);

    // ============================================
    // 🔥 ПРОВЕРКА БАЛАНСА И СПИСАНИЕ
    // ============================================
    
    const user = await User.findById(req.user.userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }

    // Определяем с какого баланса работаем
    const balanceField = accountType === 'demo' ? 'demoBalance' : 'realBalance';
    const currentBalance = user[balanceField];

    if (currentBalance < amount) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: `Недостаточно средств на ${accountType === 'demo' ? 'демо' : 'реальном'} счете. Баланс: $${currentBalance.toFixed(2)}`
      });
    }

    // 🔥 ЗАЩИТА: Проверяем, что после списания баланс не станет отрицательным
    const newBalance = currentBalance - amount;
    if (newBalance < 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Операция приведет к отрицательному балансу'
      });
    }

    // ============================================
    // 🔥 СОЗДАНИЕ СДЕЛКИ
    // ============================================
    
    const expirationTime = entryTime + (expirationSeconds * 1000);

    const trade = new Trade({
      userId: user._id,
      pair,
      amount,
      direction,
      payout,
      accountType, // 🔥 Сохраняем тип счета
      entryPrice, // 🔥 BACKEND определил цену!
      entryTime,
      expirationTime,
      expirationSeconds,
      status: 'active'
    });

    await trade.save({ session });

    // Списываем сумму с правильного баланса
    user[balanceField] = newBalance;
    await user.save({ session });

    // ============================================
    // 🔥 COMMIT ТРАНЗАКЦИИ
    // ============================================
    
    await session.commitTransaction();

    console.log(`✅ Сделка создана: ${user.email} | ${accountType.toUpperCase()} | ${pair} | ${direction} | $${amount} | ${expirationSeconds}s | Entry: ${entryPrice}`);

    res.json({
      success: true,
      data: trade,
      demoBalance: user.demoBalance,
      realBalance: user.realBalance
    });

  } catch (error) {
    // Откатываем транзакцию при любой ошибке
    await session.abortTransaction();
    console.error('❌ Ошибка создания сделки:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера'
    });
  } finally {
    session.endSession();
  }
});

// ❌ УДАЛЯЕМ роут /close - теперь закрытие автоматическое через worker!

// 📊 Статистика торговли
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    const totalTrades = await Trade.countDocuments({ userId });
    const wonTrades = await Trade.countDocuments({ userId, status: 'won' });
    const lostTrades = await Trade.countDocuments({ userId, status: 'lost' });
    const activeTrades = await Trade.countDocuments({ userId, status: 'active' });

    const totalProfit = await Trade.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), status: { $in: ['won', 'lost'] } } },
      { $group: { _id: null, total: { $sum: '$profit' } } }
    ]);

    const winRate = totalTrades > 0 ? ((wonTrades / totalTrades) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      data: {
        totalTrades,
        wonTrades,
        lostTrades,
        activeTrades,
        totalProfit: totalProfit.length > 0 ? totalProfit[0].total : 0,
        winRate: Number(winRate)
      }
    });
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

