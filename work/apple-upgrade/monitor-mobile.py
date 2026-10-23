from pathlib import Path
text=Path('work/apple-upgrade/operations-browser.cjs').read_text(encoding='utf-8')
text=text.replace('work/apple-upgrade/operations-browser','work/apple-upgrade/monitor-mobile')
text=text.replace('for (const viewport of viewports) {','for (const viewport of viewports.filter(v => (v.width===390 && v.height===844 && !v.reducedMotion) || (v.width===320 && v.height===667))) {')
text=text.replace('for (const [key, heading, selector] of workspaces) {','for (const [key, heading, selector] of workspaces.filter(([key]) => key === "monitoring")) {')
text=text.replace('if (viewport.width === 390 && viewport.height === 844 && !viewport.reducedMotion) {','if (false) {')
Path('work/apple-upgrade/monitor-mobile.cjs').write_text(text,encoding='utf-8')
