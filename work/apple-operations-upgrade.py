from pathlib import Path
root = Path('apps/web/src/components')
def edit(name, replacements):
    file=root/name
    text=file.read_text(encoding='utf-8')
    for old,new in replacements:
        if old not in text: raise RuntimeError(f'{name}: missing {old[:90]}')
        text=text.replace(old,new)
    file.write_text(text,encoding='utf-8')

capture='''      data-keyboard-motion={keyboardMotion ? "true" : "false"}
      onPointerDownCapture={() => setKeyboardMotion(false)}
      onKeyDownCapture={() => setKeyboardMotion(true)}'''
entry='''initial={instantMotion || index >= 4 || animatedItems.current.has(ITEMID)
                      ? false : { opacity: 0.65, transform: "translateY(12px)" }}
                    animate={{ opacity: 1, transform: "translateY(0)" }}
                    transition={instantMotion ? { duration: 0 } : { ...springs.appleSpatial, delay: Math.min(index, 3) * 0.035 }}'''

edit('inventory-orders-workspace.tsx',[
('  const reducedMotion = useReducedMotion();','''  const reducedMotion = useReducedMotion();
  const [keyboardMotion, setKeyboardMotion] = useState(false);
  const instantMotion = reducedMotion || keyboardMotion;
  const animatedItems = useRef(new Set<string>());'''),
('  const [total, setTotal] = useState(0);','''  const [total, setTotal] = useState(0);
  useEffect(() => { orders.forEach(order => animatedItems.current.add(order.id)); }, [orders]);'''),
('      className={`inventory-orders-workspace mt-2 grid min-w-0 ${styles.workspace} ${styles.inventory}`}','      className={`inventory-orders-workspace mt-2 grid min-w-0 ${styles.workspace} ${styles.inventory}`}\n'+capture),
('reducedMotion ? { duration: 0 } : springs.snappy','instantMotion ? { duration: 0 } : springs.appleSelection'),
('{orders.map((order) => (','{orders.map((order, index) => ('),
('<article key={order.id} className="inventory-order-card">','<motion.article key={order.id} className="inventory-order-card"\n                    '+entry.replace('ITEMID','order.id')+'>'),
('            </article>\n          ))}','            </motion.article>\n          ))}'),
('            <section\n              ref={detailDialogRef}','''            <motion.section
              initial={instantMotion ? false : { opacity: 0.6, transform: "translateY(24px) scale(0.98)" }}
              animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
              transition={instantMotion ? { duration: 0 } : springs.appleSpatial}
              ref={detailDialogRef}'''),
('            <section\n              ref={formDialogRef}','''            <motion.section
              initial={instantMotion ? false : { opacity: 0.6, transform: "translateY(24px) scale(0.98)" }}
              animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
              transition={instantMotion ? { duration: 0 } : springs.appleSpatial}
              ref={formDialogRef}'''),
('            </section>\n          </div>,','            </motion.section>\n          </div>,'),
])
edit('monitoring-config-workspace.tsx',[
('import { createPortal } from "react-dom";','''import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { springs } from "../lib/motion-tokens";'''),
('  suspended = false,','  suspended = false,\n  instantMotion = false,'),
('  suspended?: boolean;','  suspended?: boolean;\n  instantMotion?: boolean;'),
('      <section\n        ref={dialogRef}','''      <motion.section
        initial={instantMotion ? false : { opacity: 0.6, transform: "translateY(24px) scale(0.98)" }}
        animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
        transition={instantMotion ? { duration: 0 } : springs.appleSpatial}
        ref={dialogRef}'''),
('        {children}\n      </section>','        {children}\n      </motion.section>'),
('  const [config, setConfig] = useState<MonitoringConfig | null>(null);','''  const reducedMotion = useReducedMotion();
  const [keyboardMotion, setKeyboardMotion] = useState(false);
  const instantMotion = reducedMotion || keyboardMotion;
  const animatedItems = useRef(new Set<string>());
  const [config, setConfig] = useState<MonitoringConfig | null>(null);
  useEffect(() => { config?.keywords.forEach(keyword => animatedItems.current.add(keyword.id)); }, [config]);'''),
('      aria-label="监控配置"','      aria-label="监控配置"\n'+capture),
('                  visibleKeywords.map((keyword) => (','                  visibleKeywords.map((keyword, index) => ('),
('                    <article\n                      className="mcfg-keyword-row"','                    <motion.article\n                      '+entry.replace('ITEMID','keyword.id')+'\n                      className="mcfg-keyword-row"'),
('                    </article>','                    </motion.article>'),
('                          <span />','''                          <motion.span initial={false}
                            animate={{ transform: keyword.enabled ? "translateX(22px)" : "translateX(0)" }}
                            transition={instantMotion ? { duration: 0 } : springs.appleSelection} />'''),
('                        <span>\n                          <strong>{category.name}</strong>','''                        {categoryFilter === category.id && <motion.span
                          className={styles.categoryIndicator} layoutId="monitoring-category-indicator"
                          transition={instantMotion ? { duration: 0 } : springs.appleSelection}
                          aria-hidden="true" />}
                        <span className={styles.tabLabel}>
                          <strong>{category.name}</strong>'''),
('                        <span>{category._count?.items ?? ""}</span>','                        <span className={styles.tabLabel}>{category._count?.items ?? ""}</span>'),
('        <ConfigDialog\n          title=','        <ConfigDialog\n          instantMotion={Boolean(instantMotion)}\n          title='),
])
edit('logistics-workspace.tsx',[
('import { useEffect, useMemo, useState } from "react";','import { useEffect, useMemo, useRef, useState } from "react";'),
('import { motionTokens } from "../lib/motion-tokens";','import { motionTokens, springs } from "../lib/motion-tokens";'),
('  const reducedMotion = useReducedMotion();','''  const reducedMotion = useReducedMotion();
  const [keyboardMotion, setKeyboardMotion] = useState(false);
  const instantMotion = reducedMotion || keyboardMotion;
  const animatedItems = useRef(new Set<string>());'''),
('  const [items, setItems] = useState<LogisticsItem[]>([]);','''  const [items, setItems] = useState<LogisticsItem[]>([]);
  useEffect(() => { items.forEach(item => animatedItems.current.add(item.id)); }, [items]);'''),
('      aria-labelledby="logistics-title"','      aria-labelledby="logistics-title"\n'+capture),
('              items.map((item) => {','              items.map((item, index) => {'),
('                  <article\n                    key={item.id}','                  <motion.article\n                    '+entry.replace('ITEMID','item.id')+'\n                    key={item.id}'),
('                  </article>','                  </motion.article>'),
('                      <span\n                        aria-hidden="true"\n                        className={`grid h-6','''                      <motion.span
                        initial={false}
                        animate={{ transform: checked ? "scale(1)" : "scale(0.86)" }}
                        transition={instantMotion ? { duration: 0 } : springs.appleSelection}
                        aria-hidden="true"
                        className={`grid h-6'''),
('                        ✓\n                      </span>','                        ✓\n                      </motion.span>'),
('initial={reducedMotion ? false : { opacity: 0 }}','initial={instantMotion ? false : { opacity: 0 }}'),
('duration: reducedMotion','duration: instantMotion'),
('reducedMotion ? false : { height: 0, opacity: 0 }','instantMotion ? false : { height: 0, opacity: 0 }'),
('                  <span aria-hidden="true">{showAdjustments ? "−" : "+"}</span>','''                  <motion.svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"
                    initial={false} animate={{ transform: showAdjustments ? "rotate(180deg)" : "rotate(0deg)" }}
                    transition={instantMotion ? { duration: 0 } : springs.appleSelection}
                    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </motion.svg>'''),
('''                      transition={{
                        duration: instantMotion
                          ? 0
                          : motionTokens.duration.fast,
                        ease: motionTokens.easing.smooth,
                      }}''','''                      transition={instantMotion ? { duration: 0 } : springs.appleSpatial}'''),
('''                reducedMotion
                  ? false
                  : { opacity: 0.6, transform: "translateY(4px)" }''','''                instantMotion
                  ? false
                  : { opacity: 0.6, transform: "translateY(16px)" }'''),
('''              transition={{
                duration: instantMotion ? 0 : motionTokens.duration.fast,
                ease: motionTokens.easing.smooth,
              }}''','''              transition={instantMotion ? { duration: 0 } : springs.appleSpatial}'''),
])
edit('procurement-calculator-workspace.tsx',[
('import { springs, motionTokens } from "../lib/motion-tokens";','import { springs, motionTokens } from "../lib/motion-tokens";'),
('  const reducedMotion = useReducedMotion();','''  const reducedMotion = useReducedMotion();
  const [keyboardMotion, setKeyboardMotion] = useState(false);
  const instantMotion = reducedMotion || keyboardMotion;'''),
('      aria-labelledby="procurement-calculator-title"','      aria-labelledby="procurement-calculator-title"\n'+capture),
('reducedMotion ? { duration: 0 } : springs.snappy','instantMotion ? { duration: 0 } : springs.appleSelection'),
('reducedMotion ? false : { opacity: 0.6, transform: "translateY(4px)" }','instantMotion ? false : { opacity: 0.6, transform: "translateY(12px) scale(0.985)" }'),
('animate={{ opacity: 1, transform: "translateY(0)" }}','animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}'),
('''        transition={{
          duration: reducedMotion ? 0 : motionTokens.duration.fast,
          ease: motionTokens.easing.smooth,
        }}''','''        transition={instantMotion ? { duration: 0 } : springs.appleSpatial}'''),
('''                className="procurement-calc-copy"
                disabled''','''                className="procurement-calc-copy"
                data-copied={copyMessage === "客户报价已复制" ? "true" : "false"}
                disabled'''),
('''            <p role="status" className="procurement-calc-caption">
              {copyMessage}
            </p>''','''            <motion.p role="status" className="procurement-calc-caption" key={copyMessage}
              initial={instantMotion || !copyMessage ? false : { opacity: 0.6 }}
              animate={{ opacity: 1 }} transition={{ duration: instantMotion ? 0 : motionTokens.duration.feedback }}>
              {copyMessage}
            </motion.p>'''),
])
edit('market-intel-workspace.tsx',[
('  const reducedMotion = useReducedMotion();','''  const reducedMotion = useReducedMotion();
  const [keyboardMotion, setKeyboardMotion] = useState(false);
  const instantMotion = reducedMotion || keyboardMotion;
  const animatedItems = useRef(new Set<string>());'''),
('  const [items, setItems] = useState<MarketIntel[]>([]);','''  const [items, setItems] = useState<MarketIntel[]>([]);
  useEffect(() => { items.forEach(item => animatedItems.current.add(item.id)); }, [items]);'''),
('      aria-labelledby="market-intel-heading"','      aria-labelledby="market-intel-heading"\n'+capture),
('reducedMotion ? { duration: 0 } : springs.snappy','instantMotion ? { duration: 0 } : springs.appleSelection'),
('table.getRowModel().rows.map((row) => (','table.getRowModel().rows.map((row, index) => ('),
('                    <tr\n                      key={row.id}','                    <motion.tr\n                      '+entry.replace('ITEMID','row.original.id')+'\n                      key={row.id}'),
('                    </tr>\n                  ))}\n                </tbody>','                    </motion.tr>\n                  ))}\n                </tbody>'),
('{items.map((item) => (\n              <button','{items.map((item, index) => (\n              <motion.button\n                '+entry.replace('ITEMID','item.id')),
('              </button>\n            ))}\n          </div>','              </motion.button>\n            ))}\n          </div>'),
('''                reducedMotion
                  ? false
                  : { opacity: 0.6, transform: "translateY(8px) scale(0.98)" }''','''                instantMotion
                  ? false
                  : { opacity: 0.6, transform: "translateY(24px) scale(0.98)" }'''),
('''              transition={{
                duration: reducedMotion ? 0 : motionTokens.duration.fast,
                ease: motionTokens.easing.smooth,
              }}''','''              transition={instantMotion ? { duration: 0 } : springs.appleSpatial}'''),
('              <div className="p-5 sm:p-7">','''              <motion.div className="p-5 sm:p-7" key={showOriginal ? "original" : "translated"}
                initial={instantMotion ? false : { opacity: 0.6 }} animate={{ opacity: 1 }}
                transition={{ duration: instantMotion ? 0 : motionTokens.duration.feedback }}>'''),
('              </div>\n            </motion.article>','              </motion.div>\n            </motion.article>'),
])
