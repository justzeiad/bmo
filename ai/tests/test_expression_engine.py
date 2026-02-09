import unittest
from ai.core.expression_engine import ExpressionEngine

class TestExpressionEngine(unittest.TestCase):
    def test_from_emotion(self):
        engine = ExpressionEngine()
        exp = engine.from_emotion("excited", 1.2, speaking=True)
        self.assertEqual(exp["emotion"], "excited")
        self.assertEqual(exp["intensity"], 1.0)
        self.assertTrue(exp["speaking"])

if __name__ == "__main__":
    unittest.main()
