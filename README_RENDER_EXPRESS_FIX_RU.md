# Исправление Render: Cannot find module 'express'

Причина: старый `package-lock.json` содержал внутренние адреса реестра пакетов, недоступные Render. В этой версии все зависимости направлены на публичный `https://registry.npmjs.org/`.

Также Dockerfile теперь во время сборки обязательно проверяет наличие `express`, `helmet`, `pg` и `qrcode`. Если зависимости не установились, сборка остановится до запуска сервера.

После загрузки файлов выполните в Render:

`Manual Deploy -> Clear build cache & deploy`
