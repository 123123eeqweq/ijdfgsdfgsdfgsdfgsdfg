const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Генерация JWT токена
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'your-secret-key', {
    expiresIn: '7d'
  });
};

// Регистрация пользователя
const register = async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    // Проверяем, существует ли пользователь
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Пользователь с таким email уже существует'
      });
    }

    // Создаем нового пользователя
    const user = new User({
      email,
      password,
      firstName,
      lastName,
      phone
    });

    await user.save();

    // Генерируем временный токен для завершения регистрации (действует 1 час)
    const registrationToken = jwt.sign(
      { userId: user._id, type: 'registration' }, 
      process.env.JWT_SECRET || 'your-secret-key', 
      { expiresIn: '1h' }
    );

    res.status(201).json({
      success: true,
      message: 'Пользователь успешно зарегистрирован',
      data: {
        registrationToken
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка при регистрации пользователя',
      error: error.message
    });
  }
};

// Вход пользователя
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Находим пользователя по email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Неверный email или пароль'
      });
    }

    // Проверяем пароль
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Неверный email или пароль'
      });
    }

    // Генерируем токен
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Успешный вход в систему',
      data: {
        user: {
          id: user._id,
          userId: user.userId,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          isVerified: user.isVerified
        },
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка при входе в систему',
      error: error.message
    });
  }
};

// Получение профиля пользователя
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          userId: user.userId,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          country: user.country,
          currency: user.currency,
          demoBalance: user.demoBalance,
          realBalance: user.realBalance,
          isVerified: user.isVerified,
          createdAt: user.createdAt
        }
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка при получении профиля',
      error: error.message
    });
  }
};

// Обновление профиля пользователя
const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, phone, country, currency } = req.body;
    const userId = req.userId;

    const updateData = {};
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (phone !== undefined) updateData.phone = phone;
    if (country) updateData.country = country;
    if (currency) updateData.currency = currency;

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    res.json({
      success: true,
      message: 'Профиль успешно обновлен',
      data: {
                user: {
                  id: user._id,
                  userId: user.userId,
                  email: user.email,
                  firstName: user.firstName,
                  lastName: user.lastName,
                  phone: user.phone,
                  country: user.country,
                  currency: user.currency,
                  demoBalance: user.demoBalance,
                  realBalance: user.realBalance,
                  isVerified: user.isVerified,
                  createdAt: user.createdAt,
                  updatedAt: user.updatedAt
                }
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка при обновлении профиля',
      error: error.message
    });
  }
};

// Завершение регистрации с токеном
const completeRegistration = async (req, res) => {
  try {
    const { registrationToken, country, currency } = req.body;

    // Проверяем токен
    const decoded = jwt.verify(registrationToken, process.env.JWT_SECRET || 'your-secret-key');
    
    if (decoded.type !== 'registration') {
      return res.status(400).json({
        success: false,
        message: 'Неверный тип токена'
      });
    }

    // Обновляем профиль пользователя
    const user = await User.findByIdAndUpdate(
      decoded.userId,
      { country, currency },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    // Генерируем обычный токен для авторизации
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Регистрация успешно завершена',
      data: {
        user: {
          id: user._id,
          userId: user.userId,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          country: user.country,
          currency: user.currency,
          demoBalance: user.demoBalance,
          realBalance: user.realBalance,
          isVerified: user.isVerified
        },
        token
      }
    });

  } catch (error) {
    console.error('Complete registration error:', error);
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(400).json({
        success: false,
        message: 'Недействительный или истекший токен регистрации'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Ошибка при завершении регистрации',
      error: error.message
    });
  }
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  completeRegistration
};
