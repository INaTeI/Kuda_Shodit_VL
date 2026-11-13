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
