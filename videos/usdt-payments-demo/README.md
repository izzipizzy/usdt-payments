# Видеопрезентация usdt-payments

85 секунд, 1920×1080, 30 кадров/с. Русская нейронная озвучка DmitryNeural и синхронные субтитры.

[Готовый MP4](../../docs/media/usdt-payments-demo-ru.mp4) · [Субтитры SRT](../../docs/media/usdt-payments-demo-ru.srt)

## Просмотр и сборка

Нужны Node.js 22+ и npm. Из этой папки:

```sh
npm ci
npm run dev
```

В Remotion Studio выберите UsdtPayments. Для экспорта:

```sh
npm run render
```

Видео сохраняется в docs/media в корне репозитория. При первом рендере Remotion может скачать браузер.

## Содержание

Приём платежа на адрес счёта → подтверждённое поступление → сбор на основной кошелёк → пул TRX и itrx → выплата через промежуточный адрес → свои ключи, 2FA и ежедневный бэкап.

Скриншоты: реальный интерфейс с демонстрационными данными из документации проекта. Адреса, суммы и транзакции вымышленные.

## Изменение озвучки

Текст: narration.txt. Звук включён в public/audio, поэтому для обычной сборки синтезировать его повторно не нужно. Хронометраж: audio-manifest.json.

Для повторного синтеза на macOS нужны Python 3.9+, edge-tts 7.2.8 и системный afconvert:

```sh
python3 -m venv .venv-audio
.venv-audio/bin/pip install edge-tts==7.2.8
.venv-audio/bin/python generate-neural-audio.py
```

Скрипт обновляет WAV, тайминги, компонент субтитров и SRT в docs/media. После изменения озвучки соберите MP4 заново.
