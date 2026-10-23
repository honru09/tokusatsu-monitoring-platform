import io, json, pathlib, urllib.request, zipfile, hashlib
revision = '462d6bd1ea8d9b3b0f1156df8ab7f4432da34d03'
root = pathlib.Path('D:/tokusatsu-monitoring-platform/.agents/skills/image-to-ui-skill').resolve()
data = urllib.request.urlopen(f'https://codeload.github.com/zhu-guli326/image2_UI/zip/{revision}', timeout=60).read()
allowed_dirs = {'references', 'scripts', 'runtime', 'schemas', 'agents'}
allowed_files = {'SKILL.md', 'LICENSE', 'README.md', 'PRODUCTION.md', 'package.json', 'validate.ps1'}
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    for entry in archive.infolist():
        parts = pathlib.PurePosixPath(entry.filename).parts[1:]
        if not parts or entry.is_dir() or (parts[0] not in allowed_dirs and '/'.join(parts) not in allowed_files):
            continue
        target = root.joinpath(*parts).resolve()
        if not target.is_relative_to(root):
            raise RuntimeError('Unsafe archive path')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.read(entry))
skill_hash = hashlib.sha256((root / 'SKILL.md').read_bytes()).hexdigest()
(root / 'PROVENANCE.json').write_text(json.dumps({'repository': 'https://github.com/zhu-guli326/image2_UI', 'revision': revision, 'skillSha256': skill_hash, 'install': 'safe filtered archive; official installer failed on Windows path length', 'omitted': ['npm cache', 'demo images', 'repo tests'], 'runtimeExecuted': False}, indent=2), encoding='utf-8')
print(json.dumps({'installed': str(root), 'sha256': skill_hash}))
