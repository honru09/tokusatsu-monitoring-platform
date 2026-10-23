import importlib.util
import json
import time
import unittest
from pathlib import Path
from unittest.mock import patch

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
m=module('control','browser-control.py');language=module('language','configure-language.py')

class ImportTests(unittest.TestCase):
    def test_language_preserves_unrelated_preferences(self):
        original={'intl':{'accept_languages':'en-US'},'profile':{'name':'existing'},'extensions':{'settings':{'fixture':True}}}
        result=language.chinese_preferences(original)
        self.assertEqual(result['intl']['app_locale'],'zh-CN')
        self.assertTrue(result['intl']['accept_languages'].startswith('zh-CN'))
        self.assertEqual(result['extensions'],original['extensions'])
        self.assertEqual(original['intl']['accept_languages'],'en-US')

    def test_import_freshly_scans_without_requiring_caret(self):
        browser=m.BrowserControl();real=browser.page_action;calls=[]
        def action(name,payload):
            calls.append((name,payload))
            if name=='page-scan':return {'scanId':'fresh','fields':[{'id':'t','kind':'title','maxLength':30},{'id':'b','kind':'body','maxLength':20000}]}
            if name=='page-fill':return {'ok':True,'verified':True,'count':2}
        with patch.object(browser,'page_action',side_effect=action):
            result=real('page-import',{'title':'第一行标题','body':'正文\n下一行'})
        self.assertTrue(result['verified']);self.assertEqual(calls[0],('page-scan',{'editorOnly':True}))
        self.assertEqual(calls[1][1]['values'],{'t':'第一行标题','b':'正文\n下一行'})

    def test_incomplete_editor_never_writes(self):
        browser=m.BrowserControl();real=browser.page_action
        with patch.object(browser,'page_action',return_value={'fields':[]}) as inner:
            result=real('page-import',{'title':'标题','body':'正文'})
        self.assertEqual(result['code'],'editor_not_ready');self.assertEqual(inner.call_count,1)

if __name__=='__main__':unittest.main()
