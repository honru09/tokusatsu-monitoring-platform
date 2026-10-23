import importlib.util
import tempfile
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('media_bridge',Path(__file__).with_name('media-bridge.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class BridgeTests(unittest.TestCase):
    def test_names_and_types(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'a.png').write_bytes(b'fixture');(root/'b.jpg').write_bytes(b'fixture')
            self.assertEqual(len(m.media_paths(['a.png','b.jpg'],root)),2)
            for names in [['../a.png'],['a.png','a.png'],['C:\\a.png'],['a.html'],[]]:
                with self.assertRaises((ValueError,FileNotFoundError)):m.media_paths(names,root)
        self.assertTrue(m.accepts('image/*',['a.png','b.jpg']))
        self.assertFalse(m.accepts('video/mp4',['a.png']))

    def test_single_file_control_is_not_forced_to_multi(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'a.png').write_bytes(b'a');(root/'b.png').write_bytes(b'b')
            bridge=m.MediaBridge(None,lambda _:True,lambda:[],root)
            bridge.scans['scan']={'expires':float('inf'),'inputs':[{'id':'one','multiple':False,'accept':'image/*'}]}
            self.assertEqual(bridge.attach({'scanId':'scan','inputId':'one','names':['a.png','b.png']})['code'],'single_input')

if __name__=='__main__':unittest.main()
