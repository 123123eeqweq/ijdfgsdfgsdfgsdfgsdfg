/**
 * 💰 BalanceCache - In-memory кэш балансов пользователей
 * 
 * Ускоряет открытие сделок на 50-100ms за счет кэширования балансов
 */

class BalanceCache {
  constructor() {
    this.cache = new Map(); // userId -> { demoBalance, realBalance, updatedAt }
  }

  /**
   * Получить баланс из кэша
   */
  get(userId) {
    const cached = this.cache.get(userId.toString());
    if (!cached) return null;
    
    const age = Date.now() - cached.updatedAt;
    const MAX_AGE = 5 * 1000; // 5 секунд
    
    if (age > MAX_AGE) {
      // Кэш устарел - удаляем
      this.cache.delete(userId.toString());
      return null;
    }
    
    return cached;
  }

  /**
   * Обновить баланс в кэше
   */
  set(userId, demoBalance, realBalance) {
    this.cache.set(userId.toString(), {
      demoBalance,
      realBalance,
      updatedAt: Date.now()
    });
  }

  /**
   * Инвалидировать кэш пользователя
   */
  invalidate(userId) {
    this.cache.delete(userId.toString());
  }

  /**
   * Очистить весь кэш
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Получить статистику кэша
   */
  getStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Singleton instance
const balanceCache = new BalanceCache();

module.exports = balanceCache;

