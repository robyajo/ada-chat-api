#!/bin/bash
# finish.sh - Backend Production Build & Deploy

set -e

echo "=== ADA CHAT API — Production Build ==="

echo "[1/6] Pulling latest changes..."
git pull

echo "[2/6] Installing dependencies..."
npm ci --omit=dev

echo "[3/6] Generating Prisma client..."
npx prisma generate

echo "[4/6] Running database migrations..."
npx prisma migrate deploy

echo "[5/6] Building..."
npm run build

echo "[6/6] Restarting PM2..."
pm2 restart ada-chat-api

echo "=== Done ==="
