# Qwen на сервере

Развёрнуто 13 ноября 2026 на `149.154.70.109` (`10.vibe.fast.ru`).
Работает отдельный сервис Qwen3-Embedding-0.6B, CPU, один worker, 188 мест.
Экспериментальный адаптер выключен. Для публичного доступа добавлен маршрут nginx /model/;
Qwen подключена к персональной подборке основного backend через внутренний маршрут `/rank`.
Основной API сначала фильтрует каталог по публикации, бюджету, географии и реакциям,
затем передаёт разрешённые карточки, интересы, до пяти понравившихся и отклонённых
мест и доступный прогноз погоды. Qwen меняет только порядок карточек.
При ошибке или таймауте используется `rules-v1`. Discovery остаётся случайной выдачей.

## Что установлено

- Корень сервиса: `/opt/vdk-recommender`.
- Проверенный релиз: `/opt/vdk-recommender/releases/7296c17`.
- `/opt/vdk-recommender/current` указывает на этот релиз.
- Веса: `/opt/vdk-recommender/shared/models/qwen`.
- Кэш каталога: `/opt/vdk-recommender/shared/cache`.
- Контейнер: `vdk-recommender-qwen-1`, образ `vdk-qwen:7296c17`.
- Конфигурация: `compose.server.yaml` в каталоге релиза.
- Исходный снимок приложения: коммит `7296c17`; Dockerfile дополнен пользователем
  `qwen` с UID 10001, чтобы PyTorch корректно работал без root.
- Весовой файл получен из официального репозитория после проверки совпадения
  SHA-256 с локальным экспортом. Все 11 файлов совпали с MODEL_MANIFEST.json.
- Закрытый SSH-ключ и парольная фраза в репозитории и на сервере приложения не сохранялись.

## Адреса

На самом сервере:

- Health: `http://127.0.0.1:8001/health`.
- Swagger: `http://127.0.0.1:8001/docs`.
- Подбор: `POST http://127.0.0.1:8001/recommendations`.
- Похожие места: `POST http://127.0.0.1:8001/places/{place_id}/similar`.

### Публичный доступ для команды

Открыть Swagger: **http://149.154.70.109/model/docs**.
SSH, GitHub-токен и локальные веса для вызовов публичного API не требуются.
`10.vibe.fast.ru` — hostname сервера; публичный DNS этого имени с компьютера
не подтвердился, поэтому используйте IP.

```bash
curl -X POST http://149.154.70.109/model/recommendations \
  -H 'Content-Type: application/json' \
  -d '{"query":"Хочу погулять","limit":5}'
```

Похожие места: `POST /model/places/{place_id}/similar`, тело `{"limit":5}`.
В Swagger выберите Try it out, заполните JSON и нажмите Execute.
Публичный путь — анонимный демонстрационный API Qwen. Внутренний `/rank` закрыт
на публичном Nginx и доступен основному API через Docker-сеть.

Ограничения proxy: 10 запросов inference в минуту на IP с burst=3,
до двух одновременных inference-запросов на весь сервис, тело до 16 КБ.
При перегрузке возвращается 429 с Retry-After. GET Swagger/health не расходует
inference-квоту. Защищённые маршруты основного backend сохраняют прежнюю политику.
Порт 8001 остаётся loopback; публичные запросы принимает nginx на порту 80.
Конфигурация маршрута: `recommender/deploy/nginx-http.conf` и
`recommender/deploy/nginx-locations.conf`. Сервис подключён к внешней Docker-сети
`vdk-gid_edge_v2`, alias `qwen-recommender`, root_path `/model`.

Резервные копии прежних настроек: `nginx.before-public.conf` и
`compose.before-public.yaml` в каталоге релиза. Настройки nginx проверялись до
перезагрузки; переключение выполнялось с откатом при ошибке.

## Управление после входа по SSH

```bash
cd /opt/vdk-recommender/current
# Состояние и логи:
docker compose -f compose.server.yaml ps
docker compose -f compose.server.yaml logs --tail=100 qwen
# Перезапуск:
docker compose -f compose.server.yaml restart qwen
# Остановить только Qwen:
docker compose -f compose.server.yaml stop qwen
# Снова запустить:
docker compose -f compose.server.yaml up -d --no-build
```

Не используйте команды управления из `/opt/kuda-shodit-vl` для остановки Qwen:
там находится другой Compose-проект основного приложения.

Контейнер перезапускается через `unless-stopped`; Docker включён при старте ОС.
Заданы 3 ГБ RAM, до 4 ГБ RAM+swap, максимум 1.5 CPU, один поток вычислений,
пользователь 10001, read-only root и каталог моделей, отдельный writable-кэш.
Логи ротируются, есть healthcheck. Конфигурация хранится также в
`recommender/compose.server.yaml` этого проекта и предназначена для указанного сервера.

## Проверки

- Docker-образ собран на Linux x86_64.
- Все 20 тестов Qwen прошли внутри контейнера с теми же ограничениями.
- Живой HTTP: health, прогулки, SUP, бассейн, бюджет, точные названия, боулинг,
  исключения, пустая выдача, 422 и похожие места — успешно.
- Health постоянного контейнера: healthy, base, CPU, 188 мест.
- Основной backend после запуска: ready.
- RAM контейнера после проверки: около 2.1 ГБ; это один замер.
- Большинство проверенных текстовых запросов после прогрева заняли 0.6–0.8 с;
  первый запрос — около 3.2 с. Это smoke-проверка без нагрузки, не SLO.

Отчёты на сервере: `deployment-verification.json`, `model-verification.json`,
`requirements-runtime.txt` в каталоге релиза. Копия HTTP-отчёта:
`docs/qwen-server-verification.json`.

Публичная проверка с компьютера: docs/qwen-public-verification.json — Swagger, OpenAPI, health, подбор и похожие места вернули 200.
