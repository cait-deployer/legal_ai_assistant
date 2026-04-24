import requests

API_URL = "https://legalaid.wiki/api.php"
HEADERS = {"User-Agent": "LawyerAssistantBot/1.0 (Mariia Project)"}

def check_stats():
    print("🔍 Запитуємо офіційну статистику бази WikiLegalAid...")
    
    # Запит до API для отримання загальної статистики
    params = {
        "action": "query",
        "meta": "siteinfo",
        "siprop": "statistics",
        "format": "json"
    }
    
    try:
        r = requests.get(API_URL, params=params, headers=HEADERS, timeout=10)
        r.raise_for_status()
        data = r.json()
        stats = data.get("query", {}).get("statistics", {})
        
        print("\n📊 ОФІЦІЙНІ ДАНІ СЕРВЕРА:")
        print(f"  Всього сторінок (з шаблонами, категоріями тощо): {stats.get('pages', 0)}")
        print(f"  👉 РЕАЛЬНИХ СТАТЕЙ (саме те, що ми будемо парсити): {stats.get('articles', 0)}")
        print("-" * 50)
        
    except Exception as e:
        print(f"❌ Помилка підключення: {e}")

def sample_allpages():
    print("🧪 Робимо тестовий запит до allpages (перші 10 статей)...")
    
    params = {
        "action": "query",
        "list": "allpages",
        "aplimit": 10,
        "format": "json"
    }
    
    try:
        r = requests.get(API_URL, params=params, headers=HEADERS, timeout=10)
        pages = r.json().get("query", {}).get("allpages", [])
        
        for i, p in enumerate(pages, 1):
            print(f"  {i}. {p['title']}")
            
        print("\n💡 Якщо ти бачиш тут статті — API працює ідеально, він дістане їх усі по черзі!")
        
    except Exception as e:
        print(f"❌ Помилка тестового запиту: {e}")

if __name__ == "__main__":
    check_stats()
    sample_allpages()