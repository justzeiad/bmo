import unittest
from ai.core.session import Session
from ai.core.dialog_manager import DialogManager

class TestDialogFlow(unittest.TestCase):
    def test_build_input(self):
        session = Session(session_id="s1", user_id="u1")
        session.add_turn("user", "Hi")
        session.add_turn("assistant", "Hello")
        dm = DialogManager()
        messages = dm.build_input(session, "How are you?")
        self.assertEqual(messages[-1]["role"], "user")
        self.assertEqual(messages[-1]["content"], "How are you?")

if __name__ == "__main__":
    unittest.main()
