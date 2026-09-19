# Сборка и запуск Flux Planner.
#
# Два этапа: в первом ставятся зависимости и собирается приложение,
# во втором остаётся только то, что нужно для работы. Так образ не таскает
# компиляторы и исходники, а обновление зависимостей не пересобирает
# приложение целиком.

FROM node:24-slim AS build

WORKDIR /app

# Зависимости ставятся отдельным слоем: пока package-lock.json не менялся,
# этот шаг берётся из кеша, и сборка занимает секунды вместо минут.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
# Адаптер слушает этот порт; хостинг обычно передаёт свой через переменную.
ENV PORT=3000

# sqlite3 нужен ради горячей копии базы: «.backup» снимает её на работающем
# приложении, а простое копирование файла с включённым WAL даёт снимок
# в несогласованном состоянии — то есть копию, которая не восстановится.
RUN apt-get update && apt-get install --no-install-recommends -y sqlite3 && rm -rf /var/lib/apt/lists/*

# Каталог базы создаётся заранее и отдаётся пользователю node: пустой том
# Docker наследует владельца у точки монтирования в образе. Без этого шага
# том принадлежал бы root, а процесс не от root не смог бы в него писать.
RUN mkdir -p /data && chown node:node /data

# Не root: процесс, доступный из интернета, не должен иметь прав на всю систему.
USER node

COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
# Скрипты бота едут в образ, чтобы вебхук и профиль настраивались на сервере
# тем же кодом и без установленного там Node.
COPY --from=build --chown=node:node /app/scripts ./scripts

EXPOSE 3000

# Проверка живости: контейнер, который не может ответить из-за недоступной
# базы, должен помечаться нездоровым, а не молча принимать трафик.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build"]
