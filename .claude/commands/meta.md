Ти працюєш з системою збагачення метаданих URAI (Liga Zakon-якість).

## Архітектура збагачення

1. **enrich_opendata_meta.py** — фетчить картки з `data.rada.gov.ua/laws/card/{nreg}.json`, будує reverse-dead index, записує `rada_*` поля у `.meta.json`
2. **update_qdrant_meta.py** — читає `.meta.json` → `set_payload()` у Qdrant без переіндексації
3. **Admin UI** → `/admin/meta` — браузер збагачених документів + контроль запуску

## Ключові поля `rada_*` у payload Qdrant

| Поле | Тип | Що означає |
|------|-----|-----------|
| `rada_is_dead` | bool | документ втратив чинність (Liga Zakon-логіка) |
| `rada_is_dead_by_status` | bool | втратив за полем status (1,3,7,9) |
| `rada_is_dead_by_link` | bool | скасований зворотнім зв'язком (Liga Zakon reverse index) |
| `rada_status` | int | код стану з data.rada.gov.ua |
| `rada_status_name` | str | назва стану |
| `rada_adopted_date` | str | дата прийняття (YYYY-MM-DD) |
| `rada_last_edition` | str | дата останньої редакції |
| `rada_dead_since` | str | дата втрати чинності |
| `rada_replaced_by` | list[str] | nreg документів-замінників |
| `rada_cancelled_by` | list[str] | nreg документів що скасували |
| `rada_theme` | str | тема (з temy.txt) |
| `rada_classifiers` | list[str] | класифікатори (з klasname.txt) |
| `rada_org` | str | орган що прийняв |
| `rada_doc_type` | str | тип документу |
| `rada_no_text` | bool | текст відсутній (tags=4) |

## Dead-detection логіка

- **By status**: `rada_status in {1, 3, 7, 9}` (втратив/зупинено/не застосовується)
- **By link (reverse index)**: документ B є dead якщо будь-який документ A має link до B з типом відносини `in {4, 7, 19, 22, 25, 29}` (скасовує/зупиняє/визнає недійсним)
- В `/ask`: `_is_expired()` перевіряє `rada_is_dead` → виключає з результатів

## Endpoints

- `POST /admin/enrich/start` — `{"sources": ["rada","kmu"], "force": false}`
- `POST /admin/enrich/stop`
- `GET /admin/enrich/status` → `{enrich: {...}, qdrant_meta: {...}}`
- `POST /admin/enrich/qdrant/apply` — патч Qdrant після збагачення
- `POST /admin/enrich/qdrant/stop`
- `GET /admin/meta/list?source=rada&dead=true&q=...&limit=50&offset=0`

## Що перевірити при змінах

- `enrich_opendata_meta.py`: DEAD_LINK_TYPES, DEAD_STATUSES, `_build_enriched()`, фази 1–3
- `update_qdrant_meta.py`: ENRICH_FIELDS список, filter по `law_id`
- `server.py`: `_is_expired()` — чи перевіряє `rada_is_dead`
- `app/chat/page.tsx`: тип `Citation` — чи є всі `rada_*` поля
- Після зміни полів у `_build_enriched` → оновити ENRICH_FIELDS у `update_qdrant_meta.py` і тип Citation на фронті
