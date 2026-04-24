"""
scrape_zir_v2.py — Покращений скрапер для ЗІР.
Враховує дублювання ID eventName та витягає Повну відповідь.
"""
import os
import json
import time
import argparse
from pathlib import Path
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

# ── Config ─────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ZIR_DIR = os.path.join(BASE_DIR, "laws_raw", "zir")
os.makedirs(ZIR_DIR, exist_ok=True)

SEARCH_URL = "https://zir.tax.gov.ua/main/bz/search/?src=ques"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true", help="Тільки 5 штук")
    parser.add_argument("--visible", action="store_true", help="Показувати браузер")
    args = parser.parse_args()

    with sync_playwright() as p:
        print(f"🚀 Запуск браузера (Режим: {'Видимий' if args.visible else 'Фоновий'})...")
        browser = p.chromium.launch(headless=not args.visible)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        print(f"🌐 Відкриваємо ЗІР...")
        page.goto(SEARCH_URL, wait_until="networkidle")
        
        # Чекаємо на появу результатів пошуку
        page.wait_for_selector(".bz-search-res-item", timeout=30000)
        
        # Отримуємо список посилань на детальні сторінки
        links = page.locator(".bz-search-res-title a").all()
        print(f"✅ Знайдено {len(links)} питань на першій сторінці.")

        if args.test:
            links = links[:5]
            print(f"🧪 TEST MODE: Обробляємо лише {len(links)} документів.")

        # Зберігаємо URL-адреси, щоб не "загубити" їх при переході назад
        target_urls = [l.get_attribute("href") for l in links]
        
        ok = err = 0
        for i, path in enumerate(target_urls):
            full_url = f"https://zir.tax.gov.ua{path}"
            q_id = path.split("=")[-1]
            
            print(f"⬇️ Провалюємось у документ {i+1} (ID: {q_id})...")
            
            try:
                page.goto(full_url, wait_until="domcontentloaded")
                # Чекаємо саме на поле з відповіддю
                page.wait_for_selector("fieldset:has(legend:has-text('Відповідь'))", timeout=15000)

                # 🎯 ВИРІШЕННЯ ПРОБЛЕМИ ОДНАКОВИХ ID (згідно з твоїми скринами)
                # Витягаємо питання з першого fieldset
                question_text = page.locator("fieldset:has(legend:has-text('Питання')) #eventName").inner_text().strip()
                
                # Витягаємо відповідь з другого fieldset
                answer_content = page.locator("fieldset:has(legend:has-text('Відповідь')) #eventName").inner_text().strip()
                
                # Категорія (якщо є на сторінці)
                category = "Податкове законодавство" # Дефолт
                
                # Формуємо фінальний текст для Юрая
                final_content = f"ПИТАННЯ:\n{question_text}\n\nВІДПОВІДЬ:\n{answer_content}"

                meta = {
                    "law_id": f"zir_{q_id}",
                    "title": question_text[:200],
                    "source_url": full_url,
                    "scraped_at": datetime.now(timezone.utc).isoformat()
                }

                # Збереження
                Path(ZIR_DIR, f"zir_{q_id}.txt").write_text(final_content, encoding="utf-8")
                Path(ZIR_DIR, f"zir_{q_id}.meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
                
                print(f"   ✅ Успішно збережено.")
                ok += 1
                
            except Exception as e:
                print(f"   ❌ Помилка на документі {q_id}: {e}")
                err += 1
            
            time.sleep(1) # Феншуйна пауза

        browser.close()
        print(f"\n📊 РЕЗУЛЬТАТ: ✅ {ok} збережено | ❌ {err} помилок")
        print(f"📂 Перевір папку: {ZIR_DIR}")

if __name__ == "__main__":
    main()