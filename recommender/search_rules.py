"""Deterministic candidate filters, separate from semantic ranking."""
import math
import re
import unicodedata

# Supported explicit requests. Arbitrary prose still needs a category selector in the web UI.
CATEGORIES = {
    'еда': (r'\b(?:поесть|покушать|пообедать|поужинать|позавтракать|еда|еду)\b',
            ('ресторан', 'кафе', 'столовая', 'пиццерия', 'бистро', 'кофейня',
             'кондитерская', 'фастфуд', 'пекарня')),
    'sup': (r'\b(?:sup|сап(?:е|ах|ом|ы|ов)?)\b', ('sup', 'сап')),
    'бассейн': (r'\bбассейн\w*\b', ('бассейн',)),
    'прогулка': (r'\b(?:погуля\w*|гуля\w*|прогуля\w*|прогул\w*)\b',
                 ('парк', 'сквер', 'набережная', 'аллея', 'тропа', 'дендропарк',
                  'пляж', 'бухта', 'мыс', 'сопка', 'маяк', 'озеро')),
    'кино': (r'\b(?:кинотеатр\w*|кино|фильм\w*)\b', ('кинотеатр',)),
    'боулинг': (r'\bбоулинг\w*\b', ('боулинг',)),
    'vr': (r'\bvr\b|виртуальн\w*\s+реальност\w*', ('vr-клуб', 'виртуальной реальности')),
    'караоке': (r'\bкараоке\b', ('караоке',)),
    'лазертаг': (r'\bла[зс]ертаг\w*\b', ('лазертаг',)),
    'пейнтбол': (r'\bпейнтбол\w*\b', ('пейнтбол',)),
    'картинг': (r'\bкартинг\w*\b', ('картинг',)),
    'батуты': (r'\bбатут\w*\b', ('батут',)),
    'скалодром': (r'\b(?:скалодром\w*|скалолазан\w*|боулдеринг\w*)\b', ('скалодром',)),
    'зоопарк': (r'\bзоопарк\w*\b', ('зоопарк',)),
    'океанариум': (r'\bокеанариум\w*\b', ('океанариум',)),
    'компьютерный клуб': (r'компьютерн\w*\s+клуб\w*|\bкиберспорт\w*\b', ('компьютерный клуб', 'киберспорт')),
    'квест': (r'\bквест\w*\b', ('квест',)),
    'кофейня': (r'\bкофейн\w*\b', ('кофейня',)),
    'ресторан': (r'\bресторан\w*\b', ('ресторан',)),
    'бар': (r'\bбар(?:а|е|ы|ов|ом)?\b', ('бар', 'паб')),
}


def normalize_name(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().replace('ё', 'е').split())


def rank_indices(catalog, query, indices, scores):
    name = normalize_name(query)
    return sorted(indices, key=lambda i: (normalize_name(catalog[i]['values'][0]) != name,
                                         -float(scores[i]), catalog[i]['place_id']))


def explicit_text_budget(query):
    """Only a single explicit upper bound in rubles; never guess 'cheap'."""
    pattern = r'\bдо\s+(\d{1,9}(?:[ \u00a0]\d{3})*(?:[.,]\d{1,2})?)\s*(?:₽|руб(?:лей|ля|ль|\.)?|р\.)(?!\w)'
    values = set()
    for match in re.finditer(pattern, query.casefold()):
        if re.search(r'\bне\s*$', query[:match.start()].casefold()):
            continue
        value = float(match[1].replace(' ', '').replace('\u00a0', '').replace(',', '.'))
        if math.isfinite(value):
            values.add(value)
    return next(iter(values)) if len(values) == 1 else None


def matches_category(place, category):
    values = place['values']
    types = str(values[6] or '').lower().replace('ё', 'е')
    # Tags may explicitly attest an activity, but never use names or general descriptions.
    tags = {s.strip().lower() for s in str(values[7] or '').split(';')}
    needles = CATEGORIES[category][1]
    if category == 'прогулка':
        return bool({part.strip() for part in types.split(';')} & set(needles))
    if category == 'бар':
        return bool(re.search(r'\b(?:бар|паб|гриль-бар|суши-бар)\b', types))
    return any(n in types or n in tags for n in needles)


def detect_categories(query):
    positive, negative = [], []
    for name, (pattern, _) in CATEGORIES.items():
        for match in re.finditer(pattern, query.lower()):
            prefix = query[max(0, match.start()-40):match.start()].lower()
            target = negative if re.search(r'(?:\bне|\bбез|\bкроме)\s+(?:хочу\s+|в\s+|идти\s+|никаких\s+)*$', prefix) else positive
            if name not in target:
                target.append(name)
    return positive, negative


def number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (TypeError, ValueError):
        return None


def distance_km(lat, lon, place):
    try:
        p_lat, p_lon = float(place['values'][4]), float(place['values'][5])
        if not (-90 <= p_lat <= 90 and -180 <= p_lon <= 180):
            return None
    except (TypeError, ValueError):
        return None
    a, b = math.radians(lat), math.radians(p_lat)
    dlat, dlon = b-a, math.radians(p_lon-lon)
    x = math.sin(dlat/2)**2 + math.cos(a)*math.cos(b)*math.sin(dlon/2)**2
    return 6371.0088 * 2 * math.asin(min(1, math.sqrt(x)))


SWEETS = r'\b(?:сладк\w*|десерт\w*|эклер\w*|пирожн\w*|торт\w*|конфет\w*|круассан\w*)\b'
HOT_DRINK = r'\b(?:кофе|чай|чая|чаем|какао|капучино|латте|эспрессо|американо)\b'


def wants_sweets_and_drink(query):
    q = query.lower()
    if re.search(r'\b(?:или|либо|не|без|кроме)\b', q):
        return False  # Don't silently turn alternatives or negation into a conjunction.
    return bool(re.search(SWEETS,q) and (
        re.search(HOT_DRINK,q) or re.search(r'горяч\w*\s+напит\w*',q)))


def has_sweets_and_drink(place):
    v = place['values']
    # Only factual retrieval text; a venue's name alone cannot confirm its menu.
    text = place.get('search_text') or ' '.join(str(v[i] or '') for i in (1,2,7))
    return bool(re.search(SWEETS,text,re.I) and re.search(HOT_DRINK,text,re.I))


def candidates(catalog, query, category=None, budget=None, lat=None, lon=None, radius=None):
    positive, negative = detect_categories(query)
    if 'еда' in positive and any(value in positive for value in ('ресторан', 'кофейня')):
        positive.remove('еда')
    # Multiple activities may describe alternatives or a route: don't silently guess AND/OR.
    selected = category or (positive[0] if len(positive) == 1 else None)
    sweet_drink = wants_sweets_and_drink(query)
    warnings = []
    if len(positive) > 1 and not category:
        warnings.append('Упомянуто несколько категорий; для строгого отбора укажите --category.')
    if not selected and not sweet_drink:
        warnings.append('Строгая категория не выбрана: используется смысловой поиск, возможны неподходящие варианты.')
    indices, distances, costs = [], {}, {}
    excluded = {'category':0, 'menu_unconfirmed':0, 'budget_unknown':0, 'budget_exceeded':0, 'location_unknown':0, 'too_far':0}
    for i, p in enumerate(catalog):
        if (selected and not matches_category(p, selected)) or any(matches_category(p,n) for n in negative):
            excluded['category'] += 1
            continue
        v = p['values']
        if sweet_drink and not has_sweets_and_drink(p):
            excluded['menu_unconfirmed'] += 1
            continue
        # The supplied columns are total estimated spending per person, not admission alone.
        low, high = number(v[12]), number(v[13])
        if budget is not None:
            if low is None or high is None or low > high:
                excluded['budget_unknown'] += 1
                continue
            if high > budget:
                excluded['budget_exceeded'] += 1
                continue
        costs[i] = {'min':low, 'max':high}
        if lat is not None and lon is not None:
            dist = distance_km(lat, lon, p)
            if radius is not None and dist is None:
                excluded['location_unknown'] += 1
                continue
            if radius is not None and dist > radius:
                excluded['too_far'] += 1
                continue
            distances[i] = dist
        indices.append(i)
    return indices, {'category':selected,'required_features':['сладкое','кофе, чай или какао'] if sweet_drink else [],
                     'excluded_categories':negative,'warnings':warnings,
                     'excluded_counts':excluded,'budget':budget,'radius_km':radius}, distances, costs
