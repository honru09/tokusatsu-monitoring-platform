from pathlib import Path
p = Path('apps/web/src/components/resale-workspace.tsx')
s = p.read_text(encoding='utf-8')
s = s.replace('data-detail-open={detailVisible && commerceView}', 'data-detail-open={detailVisible}')
s = s.replace('<h2 id="resale-title">闲鱼上架</h2>', '<span className={styles.eyebrow}>MERCARI → 闲鱼</span><h2 id="resale-title">闲鱼运营</h2>')
needle = '        <details\n          className={styles.workspaceTools}'
s = s.replace(needle, '''        <div className={styles.headerActions}>
          <button type="button" className={styles.publishAction} onClick={() => { setSettingsOpen(false); setView("candidates"); }}>添加货源<span aria-hidden="true"> ＋</span></button>
          <button type="button" className={styles.quietAction} onClick={() => openOperations("metrics")}>经营概览<span aria-hidden="true"> ↗</span></button>
        <details
          className={styles.workspaceTools}''', 1)
s = s.replace('        </details>\n      </header>', '        </details>\n        </div>\n      </header>', 1)
a = s.index('      <div className={styles.toolbar}>\n        <div className={styles.tabs} aria-label="商品视图">')
b = s.index('        <div className={styles.toolbar}>', s.index('      <div className={styles.commerce}', a))
s = s[:a] + '''      <ResaleToolSheet open={active && view !== "listings"} title={view === "candidates" || view === "market" ? "货源与市场" : "商品经营"} onClose={() => setView("listings")}>
        <div className={styles.toolNavigation} aria-label="当前任务">
          {(view === "candidates" || view === "market" ? [["candidates", "Mercari 货源"], ["market", "闲鱼参考"]] : [["maintenance", "商品维护"], ["metrics", "运营数据"]]).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key as typeof view)}>{label}{view === key && <motion.span className={styles.activeLine} layoutId="resale-tool-active" transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth }} />}</button>)}
        </div>
        {operationListingId && view !== "candidates" && view !== "market" && <div className={styles.selectedContext}><span>当前商品</span><strong>{selected?.id === operationListingId ? selected.title : "已选择运营商品"}</strong><button type="button" onClick={() => void openListing(operationListingId)}>返回商品</button></div>}
        <div hidden={view !== "candidates"} inert={view !== "candidates"}>
          <div className={styles.sourceIntro}><p>从采购库收录 Mercari 商品，继续编辑同一份上架草稿。</p>{onOpenMonitoring && <button type="button" onClick={() => { setView("listings"); onOpenMonitoring(); }}>配置货源监测</button>}<button type="button" disabled={!accountId || Boolean(pending) || !candidates.length} onClick={() => void importCandidates(candidates.map(item => item.id))}>收录本页</button></div>
          <form className={styles.sourceSearch} onSubmit={event => { event.preventDefault(); setCandidateQuery(candidateSearch.trim()); setCandidatePage(1); }}><input aria-label="搜索 Mercari 货源" placeholder="搜索 Mercari 商品" value={candidateSearch} onChange={event => setCandidateSearch(event.target.value)} /><button type="submit">搜索</button></form>
          {candidateLoading && <p role="status" className={styles.hint}>读取货源中…</p>}
          <div className={styles.candidateList} aria-label="Mercari 候选列表">{candidates.map(item => <article className={styles.candidateRow} key={item.id}>{item.images[0] ? <img src={item.images[0].url} alt="" loading="lazy" /> : <span className={styles.noImage}>暂无图片</span>}<div className={styles.rowCopy}><strong>{item.titleZh || item.titleRaw}</strong><span>Mercari · ¥{item.priceCurrent.toLocaleString()} 日元</span><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">查看原商品</a></div><div className={styles.candidateAction}>{item.suggestedPriceCny != null && <span>建议售价 <b>{cny(item.suggestedPriceCny)}</b></span>}<button type="button" className={styles.publishAction} disabled={Boolean(pending) || !accountId} onClick={() => void importCandidates([item.id])}>收录并编辑</button></div></article>)}</div>
          {!candidateLoading && !candidates.length && <div className={styles.empty}><h3>暂无符合条件的货源</h3><p>调整关键词或前往采购库配置 Mercari 监测。</p><button type="button" onClick={() => setView("market")}>查看闲鱼参考</button></div>}
          <nav className={styles.pagination} aria-label="货源分页"><button type="button" disabled={candidatePage <= 1} onClick={() => setCandidatePage(value => value - 1)}>上一页</button><span>第 {candidatePage} 页 · {candidateTotal} 件</span><button type="button" disabled={candidatePage * 30 >= candidateTotal} onClick={() => setCandidatePage(value => value + 1)}>下一页</button></nav>
        </div>
        {payload && <ResaleOperationsPanel request={request} apiBaseUrl={apiBaseUrl} accountId={accountId} active={active && ["market", "maintenance", "metrics"].includes(view)} view={view === "maintenance" || view === "metrics" ? view : "market"} paused={payload.settings.paused} selectedListingId={operationListingId} onOpenListing={openListing} onSelectListing={setOperationListingId} onOpenCandidates={() => setView("candidates")} />}
      </ResaleToolSheet>
      <div className={styles.collectionHeading}><h3>我的商品<span>{total}</span></h3><span className={styles.hint}>草稿、发布与经营在同一份商品中衔接</span></div>
      <div className={styles.commerce}>
''' + s[b:]
# The main collection always stays in place; tool queries own separate state.
a = s.index('      <div className={styles.commerce}>')
b = s.index('\nfunction SettingsPanel(', a)
body = s[a:b]
body = body.replace('{view === "listings" && (', '{(').replace('{view === "listings" && <button', '{<button')
body = body.replace('              aria-label={\n                view === "listings" ? "上架商品列表" : "Mercari 候选列表"\n              }', '              aria-label="上架商品列表"')
c = body.index('              {view === "candidates" && (')
d = body.index('              {view === "listings"\n                ? payload?.listings.map', c)
body = body[:c] + body[d:]
body = body.replace('{view === "listings"\n                ? payload?.listings.map', '{payload?.listings.map', 1)
c = body.index('                : candidates.map((item) => (')
d = body.index('              {!(view === "listings"', c)
body = body[:c].rstrip() + '}\n' + body[d:]
c = body.index('              {!(view === "listings"')
d = body.index('              <nav className={styles.pagination}', c)
body = body[:c] + '''              {!payload?.listings.length && <div className={styles.empty}><h3>{query || status ? "暂无符合条件的商品" : "还没有上架草稿"}</h3><p>{query || status ? "调整搜索词或商品状态继续查看。" : "从 Mercari 收录货源，再编辑并发布。"}</p><button type="button" className={styles.publishAction} onClick={() => setView("candidates")}>添加货源</button></div>}
''' + body[d:]
body = body.replace('                  onOpenSource={onOpenSource}', '                  onOpenSource={onOpenSource}\n                  onOpenOperations={(next) => openOperations(next, selected.id)}')
body = body.replace('<h3>选择商品开始编辑</h3>\n                  <p>文案、图片和售价可人工调整，自动流程随时可接管。</p>', '<h3>选一件商品，继续操作</h3>\n                  <p>图片、文案、发布和经营都跟随商品。\n                    当前列表与筛选会为你保留。</p>')
s = s[:a] + body + s[b:]
p.write_text(s, encoding='utf-8')
