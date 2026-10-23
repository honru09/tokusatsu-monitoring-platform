import importlib.util
import json
import time
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('browser_control',Path(__file__).with_name('browser-control.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class EditorVerificationTests(unittest.TestCase):
    def test_controller_requires_readback_for_success(self):
        for verified in [False,True]:
            calls=[]
            class FakeCDP:
                def __init__(self,target):pass
                def call(self,method,params=None):return {}
                def evaluate(self,expression):
                    args=json.loads(expression.split('})(')[-1].rsplit(')',1)[0])
                    calls.append(args['mode'])
                    return {'ok':verified,'count':1 if verified else 0} if args['mode']=='verify' else {'ok':True,'count':1}
                def close(self):pass
            browser=module.BrowserControl()
            target={'id':'target','url':'https://creator.xiaohongshu.com/editor'}
            browser.page_scans['scan']={**target,'target':'target','expires':time.time()+60,'fields':[{'id':'title','label':'标题','maxLength':30,'rich':False,'tag':'INPUT','type':'text'}]}
            with patch.object(browser,'targets',return_value=[target]),patch.object(module,'CDP',FakeCDP),patch.object(module.time,'sleep'):
                result=browser.page_action('page-fill',{'scanId':'scan','values':{'title':'测试标题'}})
            self.assertEqual(calls,['prepare','focus-field','verify'])
            self.assertEqual(result['verified'],verified)
            self.assertEqual(result['ok'],verified)

if __name__=='__main__':unittest.main()
