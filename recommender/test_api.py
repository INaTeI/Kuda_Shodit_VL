"""Integration checks using the actual local model selected with MODEL."""
import unittest
from fastapi.testclient import TestClient
from app import app


class ApiIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client=TestClient(app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None,None,None)

    def test_health(self):
        r=self.client.get('/health')
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['places_count'],188)
        self.assertEqual(r.json()['model'],'qwen')

    def test_sup_and_pool_only_return_matching_places(self):
        for query, category, needle in [('Хочу покататься на сапе', 'sup', 'sup'),
                                         ('Хочу поплавать в бассейне', 'бассейн', 'бассейн')]:
            response = self.client.post('/recommendations', json={'query': query}).json()
            self.assertEqual(response['filters']['category'], category)
            self.assertTrue(response['places'])
            engine = self.client.app.state.recommender
            for item in response['places']:
                place = engine.catalog[engine.by_id[item['place_id']]]
                self.assertIn(needle, place['values'][6].casefold())

    def test_exact_name_is_first_and_exclusions_still_apply(self):
        engine = self.client.app.state.recommender
        for name in ('Высота', 'PlayGround', 'Pixel Quest (Пиксель Квест)'):
            place = next(p for p in engine.catalog if p['values'][0] == name)
            result = self.client.post('/recommendations', json={'query': name}).json()
            self.assertEqual(result['places'][0]['place_id'], place['place_id'])
            excluded = self.client.post('/recommendations', json={
                'query': name, 'exclude_place_ids': [place['place_id']]}).json()
            self.assertNotIn(place['place_id'], [p['place_id'] for p in excluded['places']])

    def test_walking_excludes_indoor_entertainment(self):
        for query in ('хочу сходить погулять', 'Хочу прогуляться', 'Где гулять?'):
            with self.subTest(query=query):
                response = self.client.post('/recommendations', json={'query': query})
                self.assertEqual(response.status_code, 200)
                data = response.json()
                self.assertEqual(data['filters']['category'], 'прогулка')
                self.assertTrue(data['places'])
                allowed = {'парк', 'сквер', 'набережная', 'аллея', 'тропа', 'дендропарк',
                           'пляж', 'бухта', 'мыс', 'сопка', 'маяк', 'озеро'}
                engine = self.client.app.state.recommender
                for place in data['places']:
                    original = engine.catalog[engine.by_id[place['place_id']]]
                    types = {t.strip().casefold() for t in original['values'][6].split(';')}
                    self.assertTrue(types & allowed, place['name'])

    def test_negated_walk_and_alternative_are_not_forced_to_walk(self):
        for query in ('Не хочу гулять, хочу в кино', 'Погулять или сходить в кино'):
            response = self.client.post('/recommendations', json={'query': query})
            self.assertEqual(response.status_code, 200)
            self.assertNotEqual(response.json()['filters']['category'], 'прогулка')

    def test_bowling_and_exclusions(self):
        payload={'query':'Хочу поиграть в боулинг','category':'боулинг','limit':10}
        r=self.client.post('/recommendations',json=payload)
        self.assertEqual(r.status_code,200,r.text)
        data=r.json();self.assertEqual(len(data['places']),4)
        ids=[p['place_id'] for p in data['places']]
        payload['exclude_place_ids']=ids
        self.assertEqual(self.client.post('/recommendations',json=payload).json()['places'],[])

    def test_empty_strict_budget(self):
        r=self.client.post('/recommendations',json={'query':'кино','category':'кино','budget':0})
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['places'],[])

    def test_budget_in_query_and_explicit_override(self):
        response = self.client.post('/recommendations', json={
            'query': 'Хочу недорого поесть до 500 рублей'}).json()
        self.assertEqual(response['filters']['budget'], 500)
        self.assertEqual(response['filters']['budget_source'], 'query')
        self.assertEqual(response['filters']['category'], 'еда')
        for place in response['places']:
            self.assertIsNotNone(place['spending_max'])
            self.assertLessEqual(place['spending_max'], 500)
            self.assertNotIn('Сквер', place['name'])
        for budget in (0, None, 1000):
            response = self.client.post('/recommendations', json={
                'query': 'Хочу поесть до 500 рублей', 'budget': budget}).json()
            self.assertEqual(response['filters']['budget'], budget)
            self.assertEqual(response['filters']['budget_source'], 'request')

    def test_invalid_input(self):
        for body in [{'query':'   '},{'query':'кино','budget':-1},
                     {'query':'кофе','radius_km':2},{'query':'кофе','latitude':43},
                     {'query':'кофе','category':'wrong'},{'query':'кино','limit':100}]:
            with self.subTest(body=body):
                self.assertEqual(self.client.post('/recommendations',json=body).status_code,422)

    def test_similar_places(self):
        engine=self.client.app.state.recommender
        source=next(p for p in engine.catalog if p['values'][0]=='Поэма вкуса')
        url=f'/places/{source["place_id"]}/similar'
        r=self.client.post(url,json={'limit':5})
        self.assertEqual(r.status_code,200,r.text)
        data=r.json();self.assertTrue(data['places'])
        self.assertNotIn(source['place_id'],[p['place_id'] for p in data['places']])
        for p in data['places']:
            original=engine.catalog[engine.by_id[p['place_id']]]
            self.assertIn('кофейня',original['values'][6].split('; '))
        excluded=[p['place_id'] for p in data['places']]
        second=self.client.post(url,json={'exclude_place_ids':excluded}).json()
        self.assertFalse(set(excluded)&{p['place_id'] for p in second['places']})
        self.assertEqual(self.client.post(url,json={'budget':0}).json()['places'],[])
        self.assertEqual(self.client.post('/places/nonexistent/similar',json={}).status_code,404)
        self.assertEqual(self.client.post(url,json={'radius_km':3}).status_code,422)

    def test_similar_cross_type(self):
        engine=self.client.app.state.recommender
        source=next(p for p in engine.catalog if p['values'][0]=='Поэма вкуса')
        r=self.client.post(f'/places/{source["place_id"]}/similar',json={'same_type':False,'limit':20})
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(len(r.json()['places']),20)
        self.assertFalse(r.json()['filters']['same_type'])


if __name__=='__main__':unittest.main()
