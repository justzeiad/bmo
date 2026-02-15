import unittest
from ai.llm.emotion_parser import extract_emotion_block

class TestEmotionParser(unittest.TestCase):
    def test_extract_emotion(self):
        text = "Hello\n\nEMOTION: {\"emotion\": \"happy\", \"intensity\": 0.8}"
        data, cleaned = extract_emotion_block(text)
        self.assertEqual(cleaned, "Hello")
        self.assertEqual(data["emotion"], "happy")
        self.assertAlmostEqual(data["intensity"], 0.8)

    def test_extract_plain_emotion_and_strip_narration(self):
        text = "BMO grins: EMOTION: happy"
        data, cleaned = extract_emotion_block(text)
        self.assertEqual(cleaned, "")
        self.assertEqual(data["emotion"], "happy")
        self.assertAlmostEqual(data["intensity"], 0.6)

    def test_extract_alias_emotion_word(self):
        text = "EMOTION: Joyful"
        data, cleaned = extract_emotion_block(text)
        self.assertEqual(cleaned, "")
        self.assertEqual(data["emotion"], "happy")
        self.assertAlmostEqual(data["intensity"], 0.6)

if __name__ == "__main__":
    unittest.main()
