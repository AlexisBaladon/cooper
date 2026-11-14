import unittest

from pydantic import ValidationError

from app.main import CompareRequest, compare, health


class ApiTests(unittest.TestCase):
    def test_health(self):
        self.assertEqual(health(), {"status": "ok"})

    def test_compare_is_explicitly_illustrative(self):
        result = compare(CompareRequest(priority="agua", rain_change_percent=-20))
        self.assertEqual(result["status"], "illustrative_only")
        self.assertEqual(len(result["options"]), 3)
        self.assertTrue(all(option["missing"] for option in result["options"]))

    def test_invalid_priority_rejected(self):
        with self.assertRaises(ValidationError):
            CompareRequest(priority="profit")

    def test_rain_change_is_bounded(self):
        with self.assertRaises(ValidationError):
            CompareRequest(rain_change_percent=-60)


if __name__ == "__main__":
    unittest.main()
