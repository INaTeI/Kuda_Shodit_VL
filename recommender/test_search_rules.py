import unittest

from search_rules import detect_categories, explicit_text_budget


class SearchRulesTest(unittest.TestCase):
    def test_only_unambiguous_ruble_limit_is_inferred(self):
        for query, expected in [('до 1 500 ₽', 1500), ('до 500,50 рублей', 500.5),
                                ('до 500 метров', None), ('просто недорого', None),
                                ('до 500 рублей или до 1000 рублей', None),
                                ('не до 500 рублей', None)]:
            with self.subTest(query=query):
                self.assertEqual(explicit_text_budget(query), expected)

    def test_sup_is_not_detected_inside_unrelated_words(self):
        self.assertEqual(detect_categories('Хочу купить сапоги'), ([], []))

    def test_negated_pool_is_an_exclusion(self):
        self.assertEqual(detect_categories('Не хочу в бассейн'), ([], ['бассейн']))


if __name__ == '__main__':
    unittest.main()
