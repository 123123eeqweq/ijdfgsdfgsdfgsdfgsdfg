#!/bin/bash

# 🔥 Скрипт настройки Nginx + SSL для DigitalOcean
# Использование: sudo bash setup-nginx.sh your-domain.com

if [ -z "$1" ]; then
  echo "❌ Укажите домен!"
  echo "Использование: sudo bash setup-nginx.sh example.com"
  exit 1
fi

DOMAIN=$1

echo "🚀 Установка Nginx..."
apt update
apt install -y nginx certbot python3-certbot-nginx

echo "📝 Создание конфига Nginx..."
cat > /etc/nginx/sites-available/vsepoluchitsa <<EOF
# Backend API
server {
    listen 80;
    server_name $DOMAIN;
    
    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

# WebSocket серверы
server {
    listen 8080;
    server_name $DOMAIN;
    
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }
}

server {
    listen 8081;
    server_name $DOMAIN;
    
    location / {
        proxy_pass http://localhost:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }
}

server {
    listen 8082;
    server_name $DOMAIN;
    
    location / {
        proxy_pass http://localhost:8082;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }
}

server {
    listen 8083;
    server_name $DOMAIN;
    
    location / {
        proxy_pass http://localhost:8083;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }
}
EOF

ln -sf /etc/nginx/sites-available/vsepoluchitsa /etc/nginx/sites-enabled/

echo "🔐 Получение SSL сертификата..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN

echo "🔄 Перезапуск Nginx..."
systemctl restart nginx

echo "✅ Готово! Теперь используй:"
echo "   https://$DOMAIN (Backend API)"
echo "   wss://$DOMAIN:8080 (Forex)"
echo "   wss://$DOMAIN:8081 (Crypto)"
echo "   wss://$DOMAIN:8082 (OTC)"
echo "   wss://$DOMAIN:8083 (Trades)"

