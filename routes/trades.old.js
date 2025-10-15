const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Trade = require('../models/Trade');
const User = require('../models/User');
const auth = require('../middleware/auth');

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
    const { limit = 50, skip = 0 } = req.query;

    const trades = await Trade.find({
      userId: req.user.userId,
      status: { $in: ['won', 'lost', 'cancelled'] }
    })
      .sort({ closeTime: -1 })
      .limit(Number(limit))
      .skip(Number(skip));

    const total = await Trade.countDocuments({
      userId: req.user.userId,
      status: { $in: ['won', 'lost', 'cancelled'] }
    });

    res.json({
      success: true,
      data: trades,
      total,
      limit: Number(limit),
      skip: Number(skip)
    });
  } catch (error) {
    console.error('❌ Ошибка получения истории сделок:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🚀 Создать новую сделку (открыть позицию)
router.post('/create', auth, async (req, res) => {
  try {
    const {
      pair,
      amount,
      direction, // 'up' или 'down'
      entryPrice,
      expirationSeconds, // Время экспирации в секундах
      payout = 94 // Доходность по умолчанию 94%
    } = req.body;

    // Валидация
    if (!pair || !amount || !direction || !entryPrice || !expirationSeconds) {
      return res.status(400).json({
        success: false,
        error: 'Не все параметры переданы'
      });
    }

    if (amount < 1) {
      return res.status(400).json({
        success: false,
        error: 'Минимальная сумма сделки: $1'
      });
    }

    if (!['up', 'down'].includes(direction)) {
      return res.status(400).json({
        success: false,
        error: 'Направление должно быть "up" или "down"'
      });
    }

    // Проверяем баланс пользователя
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }

    if (user.balance < amount) {
      return res.status(400).json({
        success: false,
        error: 'Недостаточно средств на балансе'
      });
    }

    // Вычисляем время экспирации
    const entryTime = Date.now();
    const expirationTime = entryTime + (expirationSeconds * 1000);

    // Создаем сделку
    const trade = new Trade({
      userId: user._id,
      pair,
      amount,
      direction,
      payout,
      entryPrice,
      entryTime,
      expirationTime,
      expirationSeconds,
      status: 'active'
    });

    await trade.save();

    // Списываем сумму с баланса пользователя
    user.balance -= amount;
    await user.save();

    console.log(`✅ Сделка создана: ${user.email} | ${pair} | ${direction} | $${amount} | ${expirationSeconds}s`);

    res.json({
      success: true,
      data: trade,
      newBalance: user.balance
    });
  } catch (error) {
    console.error('❌ Ошибка создания сделки:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🔒 Закрыть сделку (проверить результат)
router.post('/close/:tradeId', auth, async (req, res) => {
  try {
    const { tradeId } = req.params;
    const { closePrice } = req.body;

    if (!closePrice) {
      return res.status(400).json({
        success: false,
        error: 'Цена закрытия не передана'
      });
    }

    const trade = await Trade.findOne({
      _id: tradeId,
      userId: req.user.userId,
      status: 'active'
    });

    if (!trade) {
      return res.status(404).json({
        success: false,
        error: 'Активная сделка не найдена'
      });
    }

    const closeTime = Date.now();

    // Проверяем что время экспирации прошло
    if (closeTime < trade.expirationTime) {
      return res.status(400).json({
        success: false,
        error: 'Время экспирации еще не прошло'
      });
    }

    // Определяем результат
    let isWin = false;
    if (trade.direction === 'up') {
      isWin = closePrice > trade.entryPrice;
    } else {
      isWin = closePrice < trade.entryPrice;
    }

    // Вычисляем профит
    let profit = 0;
    let status = 'lost';

    if (isWin) {
      // Выигрыш: получаем ставку + доход
      profit = trade.amount * (trade.payout / 100);
      status = 'won';
    } else {
      // Проигрыш: теряем ставку
      profit = -trade.amount;
      status = 'lost';
    }

    // Обновляем сделку
    trade.closePrice = closePrice;
    trade.closeTime = closeTime;
    trade.status = status;
    trade.profit = profit;
    await trade.save();

    // Обновляем баланс пользователя
    const user = await User.findById(req.user.userId);
    if (status === 'won') {
      user.balance += trade.amount + profit; // Возвращаем ставку + выигрыш
    }
    // Если проигрыш - ничего не возвращаем (ставка уже списана)
    await user.save();

    console.log(`${status === 'won' ? '🎉' : '😔'} Сделка закрыта: ${user.email} | ${status.toUpperCase()} | Profit: $${profit.toFixed(2)}`);

    res.json({
      success: true,
      data: trade,
      newBalance: user.balance
    });
  } catch (error) {
    console.error('❌ Ошибка закрытия сделки:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

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

