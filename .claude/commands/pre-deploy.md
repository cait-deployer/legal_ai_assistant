Перевір готовність до деплою на n-ai01.nexchance.de.

1. Прочитай `git log origin/main..HEAD` — що йде на сервер
2. Визнач які сервіси потрібно перезапустити:
   - `backend/` змінено → `systemctl restart backend.service`
   - `app/` змінено → `npm run build && systemctl restart frontend.service`
   - `requirements.txt` змінено → `pip install -r requirements.txt` перед рестартом
3. Перевір чи нові settings ключі додані в Supabase `app_settings`
4. Перевір чи нові Python залежності є в `requirements.txt`

Видай:
## Що зміниться
[список файлів по категоріях]

## Команди деплою (в правильному порядку)
[готові команди для копіпасту]

## Ризики
[що може піти не так]
