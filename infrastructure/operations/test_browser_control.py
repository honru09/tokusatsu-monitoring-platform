import importlib.util
import pathlib
import threading
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("browser_control", pathlib.Path(__file__).with_name("browser-control.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ControlTests(unittest.TestCase):
    def test_server_remains_available_while_browser_is_starting(self):
        browser = Mock(process=None)
        browser.restore.side_effect = ValueError("Browser is starting; retry shortly")
        with patch.object(module.Path, "read_text", return_value="t" * 48), \
                patch.object(module, "BrowserControl", return_value=browser), \
                patch.object(module, "ThreadingHTTPServer") as server, \
                patch.object(module.threading, "Thread") as thread, \
                patch.object(module.signal, "signal"):
            module.serve()
            server.return_value.serve_forever.assert_called_once()
            server.return_value.server_close.assert_called_once()
            self.assertEqual(thread.call_count, 2)
            self.assertIn(browser.watchdog, [call.kwargs["target"] for call in thread.call_args_list])
            self.assertTrue(all(call.kwargs["daemon"] for call in thread.call_args_list))
            self.assertEqual(thread.return_value.start.call_count, 2)
            browser.restore.assert_not_called()

    def test_watchdog_retries_slow_start_without_replacing_healthy_browser(self):
        browser = module.BrowserControl()
        stop = Mock()
        stop.is_set.return_value = False
        stop.wait.side_effect = [False, False, True]
        with patch.object(module, "windows", side_effect=[[], [], ["0x123"]]), \
                patch.object(module, "minimized", return_value=False), \
                patch.object(browser, "restore", side_effect=[
                    ValueError("Browser is starting; retry shortly"),
                    {"restored": True},
                ]) as restore:
            browser.watchdog(stop)
            self.assertEqual(restore.call_count, 2)
            self.assertEqual(stop.wait.call_count, 3)

    def test_minimized_window_restored_without_restarting_profile(self):
        browser = module.BrowserControl()
        with patch.object(module, "windows", return_value=["0x123"]), patch.object(module, "run") as run, patch.object(module.subprocess, "Popen") as start:
            self.assertTrue(browser.restore()["restored"])
            run.assert_any_call("wmctrl", "-ia", "0x123")
            start.assert_not_called()

    def test_official_domain_exact_match(self):
        self.assertTrue(module.official("https://creator.xiaohongshu.com/login"))
        for address in ["http://creator.xiaohongshu.com/", "https://creator.xiaohongshu.com.evil.com/", "https://user:pass@creator.xiaohongshu.com/", "https://creator.xiaohongshu.com:1234/"]:
            self.assertFalse(module.official(address))

    def test_login_rejects_expired_and_wrong_target_without_cdp(self):
        browser = module.BrowserControl()
        with self.assertRaises(ValueError):
            browser.login_action("login-fill", {"scanId": "missing", "values": {}})


if __name__ == "__main__":
    unittest.main()
