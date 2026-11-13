# Независимая проверка моделей

Сервис не обращается к основному backend и PostgreSQL. Читает собственный каталог
из 188 мест в `data/`. Используется только Qwen3-Embedding-0.6B.
Основное приложение использует порт 8000, этот сервис — 8001.

## macOS / Linux

Нужен Python 3.12. Из корня репозитория:

```bash
cd recommender
python3.12 -m venv .venv
.venv/bin/python -m pip install torch==2.11.0
.venv/bin/python -m pip install -r requirements-dev.txt
bash run.sh
```

Если окружение уже установлено, из корня проекта достаточно:

```bash
bash recommender/run.sh
```

Swagger: http://127.0.0.1:8001/docs
Готовность: http://127.0.0.1:8001/health

Первый запуск рассчитывает векторы каталога. Дождитесь сообщения
`Application startup complete`. Для остановки нажмите Ctrl+C.
## Проверка через Swagger

Откройте `POST /recommendations`, нажмите Try it out и отправьте:

```json
{"query": "Хочу поиграть в боулинг", "category": "боулинг", "limit": 5}
```

Для свободного поиска:

```json
{"query": "Хочу спокойно погулять у моря", "limit": 5}
```

Бюджет задаётся полем `budget`, радиус — `latitude`, `longitude`, `radius_km`.
При строгом бюджете/радиусе места с неизвестными расходами/координатами исключаются.
`similarity` — оценка сходства, не вероятность и не оценка качества места.
Для похожих мест скопируйте `place_id` из ответа в
`POST /places/{place_id}/similar` и отправьте `{"limit": 5}`.

## Docker

Из корня проекта (основной backend запускать не нужно):

```bash
docker compose -f recommender/compose.yaml up --build -d
docker compose -f recommender/compose.yaml logs -f
docker compose -f recommender/compose.yaml down
```

Сборка требует интернета; модели при работе загружаются из локальных файлов.

## Данные и веса

Код и JSON-каталог хранятся в Git. Веса `models/qwen/`,
окружение `.venv/` и векторы `cache/` исключены из Git.
Локальный Python в `.python/` также исключён из Git; для уже подготовленного
окружения на этом компьютере повторная установка не нужна.
На этом компьютере веса скопированы из `Downloads/guide-recommender/models`.
После клонирования репозитория на другую машину скопируйте их отдельно
в `recommender/models/`, либо после установки зависимостей выполните:

```bash
cd recommender
.venv/bin/python export_models.py --download
```

Модели предобучены; датасет используется для поиска, обучение здесь не выполняется.
Изменения основной базы мест автоматически сюда не попадают.
`VALIDATION.md` содержит результаты проверок исходного пакета на Windows.

## Интеграционные тесты

Из папки `recommender`, после установки окружения:

```bash
HF_HUB_OFFLINE=1 DEVICE=cpu .venv/bin/python -m unittest test_api -v
```

Проверено 13 ноября 2026 на macOS, Python 3.12.16 и CPU:
Qwen — 6 тестов прошли с настоящими локальными весами.
Обе конфигурации Compose проходят `config --quiet`; сборка контейнеров не проверялась,
поскольку Docker daemon не запущен.

## Как отправить проект в Git и перенести на сервер

1. Из корня проекта проверьте изменения: `git status --short`.
2. Добавьте код и датасет:
   `git add .gitignore .dockerignore README.md recommender`.
3. Проверьте `git diff --cached --stat`: весов, `.venv`, `.python`, `cache` и `.env`
   в списке быть не должно.
4. Создайте коммит: `git commit -m "Add standalone Qwen recommender"`.
5. Отправьте текущую ветку: `git push -u origin HEAD`.
6. На сервере с Docker клонируйте репозиторий и перейдите в его корень.
7. Отдельно скопируйте локальную папку `recommender/models/qwen/` на сервер
   в такую же папку внутри клонированного проекта. Весов в Git нет.
8. Запустите `docker compose -f recommender/compose.yaml up --build -d`.
9. Дождитесь готовности по логам и проверьте
   `curl http://127.0.0.1:8001/health` на сервере.

Для проверки Swagger со своего компьютера используйте SSH-туннель:
`ssh -L 8002:127.0.0.1:8001 USER@SERVER`.
Пока SSH работает, откройте http://127.0.0.1:8002/docs на своём компьютере.
Замените USER и SERVER на данные своего сервера. Порт 8002 выбран, чтобы
туннель не конфликтовал с локальным сервисом на 8001.

Это отдельный сервис: основной backend и PostgreSQL для этих шагов не нужны.
