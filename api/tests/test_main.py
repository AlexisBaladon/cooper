import unittest

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


class ApiTests(unittest.TestCase):
    def test_health(self):
        self.assertEqual(client.get("/health").json(), {"status": "ok"})

    def test_compare_is_explicitly_illustrative(self):
        response = client.post("/compare", json={"priority": "agua", "rain_change_percent": -20})
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["status"], "illustrative_only")
        self.assertEqual(len(result["options"]), 3)
        self.assertTrue(all(option["missing"] for option in result["options"]))

    def test_invalid_priority_rejected(self):
        self.assertEqual(client.post("/compare", json={"priority": "profit"}).status_code, 422)

    def test_invalid_power_coordinates_rejected_before_network(self):
        self.assertEqual(client.get("/climate/power?latitude=100&longitude=0&year=2024").status_code, 422)


if __name__ == "__main__":
    unittest.main()
