const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
  tradeId: {
    type: Number,
    unique: true,
    index: true
    // Генерируется автоматически при создании (8-значное число)
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  pair: {
    type: String,
    required: true,
    index: true
  },
  accountType: {
    type: String,
    required: true,
    enum: ['demo', 'real'],
    default: 'demo',
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 1
  },
  direction: {
    type: String,
    required: true,
    enum: ['up', 'down'], // 'up' = CALL, 'down' = PUT
    index: true
  },
  payout: {
    type: Number,
    required: true,
    default: 94 // Доходность в процентах (94% = получишь 194% от ставки)
  },
  entryPrice: {
    type: Number,
    required: true
  },
  entryTime: {
    type: Number, // Unix timestamp в миллисекундах
    required: true,
    index: true
  },
  expirationTime: {
    type: Number, // Unix timestamp в миллисекундах
    required: true,
    index: true
  },
  expirationSeconds: {
    type: Number, // Время экспирации в секундах (для удобства)
    required: true
  },
  closePrice: {
    type: Number,
    default: null
  },
  closeTime: {
    type: Number,
    default: null
  },
  status: {
    type: String,
    required: true,
    enum: ['active', 'won', 'lost', 'return', 'cancelled'], // 🔥 ДОБАВИЛИ: 'return' для возврата
    default: 'active',
    index: true
  },
  profit: {
    type: Number,
    default: 0 // Положительное = выигрыш, отрицательное = проигрыш
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Автогенерация tradeId перед сохранением новой сделки
tradeSchema.pre('save', async function(next) {
  // Генерируем tradeId только для новых сделок
  if (this.isNew && !this.tradeId) {
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (!isUnique && attempts < maxAttempts) {
      // Генерируем рандомное 8-значное число (10000000 - 99999999)
      const randomId = Math.floor(10000000 + Math.random() * 90000000);
      
      // Проверяем уникальность
      const existingTrade = await this.constructor.findOne({ tradeId: randomId });
      
      if (!existingTrade) {
        this.tradeId = randomId;
        isUnique = true;
        console.log(`✅ Присвоен tradeId: ${randomId}`);
      }
      
      attempts++;
    }
    
    if (!isUnique) {
      return next(new Error('Не удалось сгенерировать уникальный tradeId'));
    }
  }
  
  next();
});

// Индексы для быстрого поиска
tradeSchema.index({ userId: 1, status: 1 });
tradeSchema.index({ status: 1, expirationTime: 1 });

// Обновление updatedAt при изменении
tradeSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Trade', tradeSchema);

