const mongoose = require('mongoose');

const otcCandleSchema = new mongoose.Schema({
  pair: {
    type: String,
    required: true,
    index: true
  },
  open: {
    type: Number,
    required: true
  },
  high: {
    type: Number,
    required: true
  },
  low: {
    type: Number,
    required: true
  },
  close: {
    type: Number,
    required: true
  },
  volume: {
    type: Number,
    required: true
  },
  startTime: {
    type: Number, // Unix timestamp в миллисекундах
    required: true,
    index: true
  },
  endTime: {
    type: Number, // Unix timestamp в миллисекундах
    required: true
  },
  timeframe: {
    type: Number, // В секундах (5 для 5-секундных свечей)
    required: true,
    default: 5
  },
  isClosed: {
    type: Boolean,
    required: true,
    default: false, // По умолчанию свеча не закрыта (активная)
    index: true
  }
}, {
  timestamps: true // Добавляет createdAt и updatedAt
});

// Составной индекс для быстрого поиска по паре и времени
otcCandleSchema.index({ pair: 1, startTime: 1 }, { unique: true });

// Индекс для сортировки по времени
otcCandleSchema.index({ startTime: -1 });

// 🔥 КРИТИЧНО: Индекс для запросов с фильтром isClosed
// Оптимизирует запросы: find({ pair, isClosed: true }).sort({ startTime: -1 })
otcCandleSchema.index({ pair: 1, isClosed: 1, startTime: -1 });

const OtcCandle = mongoose.model('OtcCandle', otcCandleSchema);

module.exports = OtcCandle;
