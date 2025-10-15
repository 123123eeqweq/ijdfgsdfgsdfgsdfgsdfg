const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  userId: {
    type: Number,
    unique: true,
    index: true
    // Генерируется автоматически при регистрации
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  country: {
    type: String,
    trim: true
  },
  currency: {
    type: String,
    trim: true
  },
  // 💰 Демо счет (виртуальные деньги для тестирования)
  demoBalance: {
    type: Number,
    default: 10000, // Новые пользователи начинают с $10,000 на демо
    min: 0
  },
  // 💵 Реальный счет
  realBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  isVerified: {
    type: Boolean,
    default: false
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

// Автогенерация userId перед сохранением нового пользователя
userSchema.pre('save', async function(next) {
  // Генерируем userId только для новых пользователей
  if (this.isNew && !this.userId) {
    try {
      // Находим пользователя с максимальным userId
      const lastUser = await this.constructor.findOne({}, { userId: 1 })
        .sort({ userId: -1 })
        .limit(1);
      
      if (lastUser && lastUser.userId) {
        // Если есть пользователи, берем следующий ID
        this.userId = lastUser.userId + 1;
      } else {
        // Если это первый пользователь, начинаем с 1000000
        this.userId = 1000000;
      }
      
      console.log(`✅ Присвоен userId: ${this.userId} для ${this.email}`);
    } catch (error) {
      return next(error);
    }
  }
  
  next();
});

// Хеширование пароля перед сохранением
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Метод для проверки пароля
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Обновление updatedAt при изменении
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('User', userSchema);
