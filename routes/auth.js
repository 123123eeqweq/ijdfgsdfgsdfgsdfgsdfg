const express = require('express');
const router = express.Router();
const { register, login, getProfile, updateProfile, completeRegistration } = require('../controllers/authController');
const auth = require('../middleware/auth');

// Регистрация
router.post('/register', register);

// Завершение регистрации с токеном
router.post('/complete-registration', completeRegistration);

// Вход
router.post('/login', login);

// Получение профиля (требует авторизации)
router.get('/profile', auth, getProfile);

// Обновление профиля (требует авторизации)
router.put('/profile', auth, updateProfile);

module.exports = router;
