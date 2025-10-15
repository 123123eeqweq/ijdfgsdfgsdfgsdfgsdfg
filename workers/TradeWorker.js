/**
 * 🤖 TradeWorker - Автоматическое закрытие истекших сделок
 * 
 * ВАЖНО: Это СЕРДЦЕ системы! Этот worker:
 * 1. Каждые 1 секунду проверяет истекшие сделки
 * 2. Получает РЕАЛЬНУЮ цену на момент экспирации
 * 3. Определяет результат (win/loss)
 * 4. Начисляет/не начисляет профит
 * 5. Использует транзакции для безопасности
 * 
 * Запускается независимо от клиента!
 */

const mongoose = require('mongoose');
const Trade = require('../models/Trade');
const User = require('../models/User');
const PriceService = require('../services/PriceService');

// 🔥 Подключаем tradesRelay для отправки событий
let tradesRelay = null;
try {
  tradesRelay = require('../tradesRelay');
  console.log('✅ tradesRelay модуль подключен к TradeWorker');
} catch (error) {
  console.warn('⚠️ tradesRelay не найден, события не будут отправляться');
}

class TradeWorker {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.CHECK_INTERVAL = 1000; // Проверяем каждую секунду
    this.processingTrades = new Set(); // Защита от дублирования
  }

  /**
   * Запустить worker
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ TradeWorker уже запущен');
      return;
    }

    console.log('🤖 TradeWorker запущен');
    this.isRunning = true;
    
    // Запускаем немедленно, затем каждую секунду
    this.processExpiredTrades();
    this.intervalId = setInterval(() => {
      this.processExpiredTrades();
    }, this.CHECK_INTERVAL);
  }

  /**
   * Остановить worker
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️ TradeWorker уже остановлен');
      return;
    }

    console.log('🛑 TradeWorker остановлен');
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Обработать истекшие сделки
   */
  async processExpiredTrades() {
    try {
      const now = Date.now();

      // Находим все активные сделки, у которых истекло время
      const expiredTrades = await Trade.find({
        status: 'active',
        expirationTime: { $lte: now }
      }).limit(100); // Обрабатываем максимум 100 за раз

      if (expiredTrades.length === 0) {
        return; // Нет истекших сделок
      }

      console.log(`⏰ Найдено ${expiredTrades.length} истекших сделок, обрабатываем...`);

      // Обрабатываем каждую сделку
      for (const trade of expiredTrades) {
        // Защита от дублирования (если уже обрабатываем эту сделку)
        if (this.processingTrades.has(trade._id.toString())) {
          console.log(`⚠️ Сделка ${trade._id} уже обрабатывается, пропускаем`);
          continue;
        }

        this.processingTrades.add(trade._id.toString());

        try {
          await this.closeTrade(trade);
        } catch (error) {
          console.error(`❌ Ошибка закрытия сделки ${trade._id}:`, error);
        } finally {
          this.processingTrades.delete(trade._id.toString());
        }
      }

    } catch (error) {
      console.error('❌ Ошибка в TradeWorker.processExpiredTrades:', error);
    }
  }

  /**
   * Закрыть сделку
   * @param {Trade} trade - Объект сделки из БД
   */
  async closeTrade(trade) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // ============================================
      // 🔥 ПОЛУЧАЕМ РЕАЛЬНУЮ ЦЕНУ ЗАКРЫТИЯ
      // ============================================
      
      const priceData = await PriceService.getPriceAtTime(
        trade.pair,
        trade.expirationTime,
        5000 // Допуск 5 секунд
      );
      
      const closePrice = priceData.price;
      const closeTime = Date.now();

      console.log(`📉 Цена закрытия для ${trade.pair} (ID: ${trade._id}): ${closePrice} (источник: ${priceData.source}, diff: ${priceData.timeDiff}ms)`);

      // ============================================
      // 🔥 ОПРЕДЕЛЯЕМ РЕЗУЛЬТАТ (ВЫИГРЫШ/ПРОИГРЫШ/ВОЗВРАТ)
      // ============================================
      
      // Проверяем на возврат (цены равны) - допуск 0.00001 для floating point
      const priceDifference = Math.abs(closePrice - trade.entryPrice);
      const isReturn = priceDifference < 0.00001;
      
      let isWin = false;
      let status = 'lost';
      let profit = 0;
      
      if (isReturn) {
        // 🔥 НОВОЕ: Возврат - цена закрылась ровно на том же уровне
        status = 'return';
        profit = 0; // Возвращаем только ставку, без дохода
      } else {
        // Обычная логика выигрыша/проигрыша
        if (trade.direction === 'up') {
          isWin = closePrice > trade.entryPrice;
        } else {
          isWin = closePrice < trade.entryPrice;
        }
        
        if (isWin) {
          status = 'won';
          profit = trade.amount * (trade.payout / 100);
        } else {
          status = 'lost';
          profit = -trade.amount;
        }
      }

      // ============================================
      // 🔥 ВЫЧИСЛЯЕМ ПРОФИТ (обновлено)
      // ============================================

      // ============================================
      // 🔥 ОБНОВЛЯЕМ СДЕЛКУ
      // ============================================
      
      trade.closePrice = closePrice;
      trade.closeTime = closeTime;
      trade.status = status;
      trade.profit = profit;
      await trade.save({ session });

      // ============================================
      // 🔥 ОБНОВЛЯЕМ БАЛАНС ПОЛЬЗОВАТЕЛЯ
      // ============================================
      
      const user = await User.findById(trade.userId).session(session);
      if (!user) {
        throw new Error(`Пользователь ${trade.userId} не найден`);
      }

      // Определяем на какой баланс начислять
      const balanceField = trade.accountType === 'demo' ? 'demoBalance' : 'realBalance';

      if (status === 'won') {
        // Выигрыш: возвращаем ставку + выигрыш
        user[balanceField] += trade.amount + profit;
      } else if (status === 'return') {
        // 🔥 НОВОЕ: Возврат - возвращаем только ставку
        user[balanceField] += trade.amount;
      }
      // Если проигрыш - ничего не возвращаем (ставка уже списана при создании)

      await user.save({ session });

      // ============================================
      // 🔥 COMMIT ТРАНЗАКЦИИ
      // ============================================
      
      await session.commitTransaction();

      const emoji = status === 'won' ? '🎉' : status === 'return' ? '🔄' : '😔';
      console.log(`${emoji} Сделка закрыта: ID ${trade._id} | ${trade.accountType.toUpperCase()} | ${trade.pair} | ${status.toUpperCase()} | Profit: $${profit.toFixed(2)} | User: ${user.email}`);
      console.log(`   Entry: ${trade.entryPrice.toFixed(5)} → Close: ${closePrice.toFixed(5)} | Direction: ${trade.direction.toUpperCase()}`);

      // ============================================
      // 🔥 EVENT-DRIVEN: Отправляем событие клиенту!
      // ============================================
      
      if (tradesRelay && tradesRelay.internalEmitter) {
        try {
          // Отправляем обновление сделки через EventEmitter
          tradesRelay.internalEmitter.emit('sendToUser', {
            userId: trade.userId.toString(),
            event: 'tradeUpdated',
            data: {
              trade: {
                _id: trade._id,
                pair: trade.pair,
                amount: trade.amount,
                direction: trade.direction,
                payout: trade.payout,
                entryPrice: trade.entryPrice,
                entryTime: trade.entryTime,
                expirationTime: trade.expirationTime,
                expirationSeconds: trade.expirationSeconds,
                closePrice: trade.closePrice,
                closeTime: trade.closeTime,
                status: trade.status,
                profit: trade.profit
              }
            }
          });

          // Отправляем обновление баланса
          const balanceData = {
            demoBalance: user.demoBalance,
            realBalance: user.realBalance,
            accountType: trade.accountType,
            change: status === 'won' ? trade.amount + profit : status === 'return' ? trade.amount : 0
          };
          
          console.log(`   💰 Отправляем balanceUpdated:`, JSON.stringify(balanceData));
          
          tradesRelay.internalEmitter.emit('sendToUser', {
            userId: trade.userId.toString(),
            event: 'balanceUpdated',
            data: balanceData
          });

          console.log(`   📤 WebSocket события отправлены ${trade.userId}`);
        } catch (wsError) {
          console.error('⚠️ Ошибка отправки WS события:', wsError.message);
          // Не падаем, если WS не работает - сделка уже закрыта
        }
      }

    } catch (error) {
      // Откатываем транзакцию при любой ошибке
      await session.abortTransaction();
      console.error(`❌ Ошибка закрытия сделки ${trade._id}:`, error);
      
      // Можно добавить логику повторных попыток или пометить сделку как failed
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Получить статус worker'а
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkInterval: this.CHECK_INTERVAL,
      processingCount: this.processingTrades.size
    };
  }
}

// Создаем singleton instance
const tradeWorker = new TradeWorker();

module.exports = tradeWorker;

