from pathlib import Path
for name in ['resale-workspace.cjs', 'resale-ai-flow.cjs', 'resale-operations.cjs']:
    p=Path('playwright-tests')/name
    s=p.read_text(encoding='utf-8').replace("name: '闲鱼上架', exact: true", "name: '闲鱼运营', exact: true").replace("name:'闲鱼上架',exact:true", "name:'闲鱼运营',exact:true")
    if name=='resale-operations.cjs':
        s=s.replace("if(suffix==='/test-first')return json({listing:first,events:[]});", "if(suffix==='/test-first')return json({listing:first,events:[]});\n          if(suffix==='/test-published')return json({listing:sold,events:[]});")
        s=s.replace("await workspace.getByRole('button',{name:'闲鱼监测',exact:true}).click();", "await workspace.getByRole('button',{name:'添加货源 ＋',exact:true}).click();\n      await workspace.getByRole('button',{name:'闲鱼参考',exact:true}).click();")
        s=s.replace("await workspace.getByRole('button',{name:'商品维护',exact:true}).click();", "await workspace.getByRole('button',{name:'关闭运营工具',exact:true}).click();\n      await workspace.getByRole('button',{name:'经营概览 ↗',exact:true}).click();\n      await workspace.getByRole('button',{name:'商品维护',exact:true}).click();", 1)
        s=s.replace("await workspace.getByRole('button',{name:'运营数据',exact:true}).click();\n      await workspace.getByText", "await workspace.getByRole('button',{name:'运营数据',exact:true}).click();\n      assert.equal(await workspace.getByLabel('记录商品',{exact:true}).inputValue(),'test-published');\n      await workspace.getByText", 1)
        # Test real ID propagation through the published product, without changing real data.
        s=s.replace("await workspace.getByText('查看每日观测汇总（北京时间）',{exact:true}).click();", "await workspace.getByText('查看每日观测汇总（北京时间）',{exact:true}).click();\n      await workspace.getByRole('button',{name:'返回商品',exact:true}).click();\n      await workspace.getByRole('button',{name:'维护商品 ↗',exact:true}).click();\n      assert.equal(await workspace.getByLabel('维护商品',{exact:true}).inputValue(),'test-published');\n      assert.equal(await workspace.getByLabel('目标售价（人民币）',{exact:true}).inputValue(),'90');\n      await workspace.getByRole('button',{name:'运营数据',exact:true}).click();\n      assert.equal(await workspace.getByLabel('记录商品',{exact:true}).inputValue(),'test-published');\n      assert.equal(await metricForm.getByLabel('浏览量',{exact:true}).inputValue(),'0');")
        # Leaving a tool closes only its presentation, and keeps the monitor draft mounted.
        last="await workspace.getByRole('button',{name:'添加货源 ＋',exact:true}).click();\n      await workspace.getByRole('button',{name:'闲鱼参考',exact:true}).click();\n      assert.equal(await monitorForm"
        s=s.replace(last,"await workspace.getByRole('button',{name:'关闭运营工具',exact:true}).click();\n      await workspace.getByRole('button',{name:'添加货源 ＋',exact:true}).click();\n      await workspace.getByRole('button',{name:'闲鱼参考',exact:true}).click();\n      assert.equal(await monitorForm")
        s=s.replace("'monitor-draft-preserved'", "'monitor-draft-preserved','published-listing-to-maintenance-to-metrics','per-listing-operation-drafts-preserved'")
    p.write_text(s,encoding='utf-8')
