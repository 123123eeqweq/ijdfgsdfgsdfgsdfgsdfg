/**
 * Утилита для агрегации свечей из базового таймфрейма (5s) в старшие таймфреймы
 */

// Маппинг таймфреймов: сколько 5s свечей нужно для формирования одной свечи
const TIMEFRAME_MAP = {
  's5': 1,    // 5 секунд (базовый)
  's10': 2,   // 10 секунд = 2 × 5s
  's15': 3,   // 15 секунд = 3 × 5s
  's30': 6,   // 30 секунд = 6 × 5s
  'm1': 12,   // 1 минута = 12 × 5s
  'm5': 60,   // 5 минут = 60 × 5s
  'm15': 180  // 15 минут = 180 × 5s
  // m30, h1 - убраны (не поддерживаются)
};

/**
 * Получить размер группы для таймфрейма
 * @param {string} tf - таймфрейм (например, 's10', 'm1')
 * @returns {number} - количество 5s свечей для группировки
 */
function getGroupSize(tf) {
  const groupSize = TIMEFRAME_MAP[tf];
  if (!groupSize) {
    throw new Error(`Неподдерживаемый таймфрейм: ${tf}. Поддерживаются: ${Object.keys(TIMEFRAME_MAP).join(', ')}`);
  }
  return groupSize;
}

/**
 * Вычислить начало временного окна для таймфрейма
 * @param {number} timestamp - временная метка в миллисекундах
 * @param {number} intervalMs - интервал в миллисекундах
 * @returns {number} - начало окна
 */
function getWindowStart(timestamp, intervalMs) {
  return Math.floor(timestamp / intervalMs) * intervalMs;
}

/**
 * Агрегировать группу 5s свечей в одну свечу старшего таймфрейма
 * @param {Array} candles - массив 5s свечей для агрегации (должны быть в хронологическом порядке)
 * @returns {Object} - агрегированная свеча
 */
function aggregateGroup(candles) {
  if (!candles || candles.length === 0) {
    throw new Error('Нельзя агрегировать пустой массив свечей');
  }

  const first = candles[0];
  const last = candles[candles.length - 1];

  // Агрегация по правилам OHLC
  return {
    pair: first.pair,
    open: first.open,
    close: last.close,
    high: Math.max(...candles.map(c => c.high)),
    low: Math.min(...candles.map(c => c.low)),
    volume: candles.reduce((sum, c) => sum + (c.volume || 0), 0),
    startTime: first.startTime,
    endTime: last.endTime,
    timeframe: last.timeframe, // Сохраняем базовый таймфрейм для справки
    isClosed: candles.every(c => c.isClosed), // Закрыта только если все свечи закрыты
    createdAt: last.createdAt || new Date(last.endTime), // Время создания записи
    updatedAt: last.updatedAt || new Date(last.endTime), // Время обновления записи
    _id: last._id, // ID последней свечи (для reference)
    _aggregatedFrom: candles.length // Для отладки - из скольких свечей собрана
  };
}

/**
 * Агрегировать массив 5s свечей в свечи старшего таймфрейма
 * @param {Array} candles5s - массив 5s свечей (должны быть отсортированы по времени)
 * @param {string} targetTf - целевой таймфрейм (например, 's10', 'm1')
 * @returns {Array} - массив агрегированных свечей
 */
function aggregateCandles(candles5s, targetTf) {
  // Если целевой TF = s5, возвращаем как есть
  if (targetTf === 's5') {
    return candles5s;
  }

  const groupSize = getGroupSize(targetTf);
  const intervalMs = groupSize * 5000; // groupSize × 5 секунд

  // Группируем свечи по временным окнам
  const windowMap = new Map();

  for (const candle of candles5s) {
    const windowStart = getWindowStart(candle.startTime, intervalMs);
    
    if (!windowMap.has(windowStart)) {
      windowMap.set(windowStart, []);
    }
    
    windowMap.get(windowStart).push(candle);
  }

  // Агрегируем каждую группу
  const aggregatedCandles = [];
  
  for (const [windowStart, group] of windowMap.entries()) {
    // Сортируем группу по времени (на всякий случай)
    group.sort((a, b) => a.startTime - b.startTime);
    
    // Агрегируем группу
    const aggregated = aggregateGroup(group);
    aggregatedCandles.push(aggregated);
  }

  // Сортируем результат по времени
  aggregatedCandles.sort((a, b) => a.startTime - b.startTime);

  return aggregatedCandles;
}

/**
 * Проверить, поддерживается ли таймфрейм
 * @param {string} tf - таймфрейм
 * @returns {boolean}
 */
function isSupportedTimeframe(tf) {
  return tf in TIMEFRAME_MAP;
}

/**
 * Получить список поддерживаемых таймфреймов
 * @returns {Array<string>}
 */
function getSupportedTimeframes() {
  return Object.keys(TIMEFRAME_MAP);
}

module.exports = {
  TIMEFRAME_MAP,
  getGroupSize,
  getWindowStart,
  aggregateGroup,
  aggregateCandles,
  isSupportedTimeframe,
  getSupportedTimeframes
};

