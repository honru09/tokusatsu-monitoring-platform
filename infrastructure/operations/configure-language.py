"""Set language before Chromium starts; preserve every unrelated profile preference."""
import json
import os
from copy import deepcopy
from pathlib import Path

def chinese_preferences(value, local_state=False):
    updated=deepcopy(value)
    if not isinstance(updated,dict):
        raise ValueError("Invalid Chromium preferences")
    intl=updated.setdefault("intl",{})
    if not isinstance(intl,dict):
        raise ValueError("Invalid Chromium language preferences")
    intl["app_locale"]="zh-CN"
    if not local_state:
        intl["accept_languages"]="zh-CN,zh,en-US,en"
        intl["selected_languages"]="zh-CN,zh,en-US,en"
    return updated

def update(path,local_state=False):
    old=json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    result=chinese_preferences(old,local_state)
    if old==result:return
    if path.exists():
        backup=path.with_name(path.name+".before-chinese")
        if not backup.exists():
            with backup.open("x",encoding="utf-8") as handle:json.dump(old,handle,ensure_ascii=False)
            backup.chmod(0o600)
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+".language-tmp")
    with temporary.open("w",encoding="utf-8") as handle:json.dump(result,handle,ensure_ascii=False)
    temporary.chmod(0o600)
    os.replace(temporary,path)

if __name__=="__main__":
    root=Path(os.environ.get("OPS_CHROMIUM_PROFILE","/profile/chromium"))
    root.mkdir(parents=True,exist_ok=True)
    update(root/"Local State",True)
    for profile in {root/"Default",*(p for p in root.glob("Profile *") if p.is_dir())}:
        update(profile/"Preferences")
