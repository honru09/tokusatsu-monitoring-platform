from pathlib import Path
import re
file=Path('apps/web/src/components/operations-editorial.module.css')
text=file.read_text(encoding='utf-8')
def block(selector,values):
    global text
    start=text.index(selector+' {')+len(selector)+2
    end=text.index('}',start)
    body=text[start:end]
    for prop,value in values.items():
        pattern=r'(?m)^  '+re.escape(prop)+r':[\s\S]*?;'
        replacement=f'  {prop}: {value};'
        if re.search(pattern,body): body=re.sub(pattern,replacement,body,count=1)
        else: body=body.rstrip()+'\n'+replacement+'\n'
    text=text[:start]+body+text[end:]

block('.workspace',{'--operations-line':'var(--ui-line, rgb(60 60 67 / 13%))','--operations-muted':'var(--glass-ink-secondary, #58616c)','--operations-surface':'var(--ui-surface, rgb(255 255 255 / 94%))','--operations-shadow':'var(--ui-shadow, 0 8px 24px rgb(24 40 56 / 5%))'})
block('.heading',{'border-bottom':'0','padding':'8px 0 12px'})
block('.workspace .heading h2,\n.pageTitle',{'letter-spacing':'-0.025em'})
block('.workspace button',{'transition':'color var(--ui-feedback, 180ms ease), background-color var(--ui-feedback, 180ms ease), box-shadow var(--ui-feedback, 180ms ease), opacity var(--ui-feedback, 180ms ease), transform var(--ui-press-motion, 120ms var(--ease-apple-out))'})
block('.workspace button:active:not(:disabled)',{'transform':'scale(0.97)'})
block('.tabIndicator',{'inset':'3px','border-bottom':'0','border':'1px solid rgb(255 255 255 / 90%)','border-radius':'12px','background':'white','box-shadow':'0 2px 8px rgb(25 43 64 / 10%), inset 0 1px 0 white'})
block('.inventory :global(.inventory-order-hero)',{'border-bottom':'0 !important','padding':'8px 0 12px !important'})
block('.inventory :global(.inventory-order-status-chips)',{'padding':'4px','border-radius':'16px','background':'rgb(230 236 242 / 80%) !important','border':'1px solid rgb(255 255 255 / 65%) !important','box-shadow':'inset 0 1px 0 rgb(255 255 255 / 80%) !important'})
block('.inventory :global(.inventory-order-status-chips button)',{'border-radius':'14px'})
block('.inventory :global(.inventory-order-search)',{'background':'var(--operations-surface)','box-shadow':'var(--operations-shadow)'})
block('.inventory :global(.inventory-order-list)',{'border-top':'0','border':'1px solid rgb(255 255 255 / 90%)','background':'var(--operations-surface)','border-radius':'22px','box-shadow':'var(--operations-shadow)','overflow':'hidden'})
block('.inventory :global(.inventory-order-card)',{'background':'transparent','animation':'none !important'})
block('.inventory :global(.inventory-order-card-thumb)',{'border-radius':'14px','box-shadow':'inset 0 0 0 1px rgb(0 0 0 / 4%)'})
block('.inventory :global(.inventory-order-track)',{'height':'5px','border-radius':'8px'})
block('.inventory :global(.inventory-order-track-fill-ink),\n.inventory :global(.inventory-order-track-fill-moss)',{'border-radius':'8px'})
block('.inventory :global(.io-btn-sell)',{'background':'rgb(0 113 227 / 8%)','border':'1px solid rgb(0 113 227 / 12%)','box-shadow':'inset 0 1px 0 rgb(255 255 255 / 90%)'})
block('.inventory :global(.io-btn-primary)',{'box-shadow':'inset 0 1px 0 rgb(255 255 255 / 22%), 0 4px 12px rgb(0 113 227 / 18%)'})
block('.inventory :global(.inventory-order-empty),\n.inventory :global(.inventory-order-loading)',{'background':'var(--operations-surface)','border-radius':'22px','border-block':'1px solid rgb(255 255 255 / 85%)','box-shadow':'var(--operations-shadow)'})
block('.monitoring :global(.mcfg-keywords)',{'background':'var(--operations-surface)','border-block':'0','border':'1px solid rgb(255 255 255 / 85%)','border-radius':'22px','box-shadow':'var(--operations-shadow)'})
block('.monitoring :global(.mcfg-keyword-row)',{'animation':'none !important'})
block('.monitoring :global(.mcfg-categories)',{'padding':'20px','background':'var(--operations-surface)','border':'1px solid rgb(255 255 255 / 85%)','border-radius':'22px','box-shadow':'var(--operations-shadow)'})
block('.monitoring :global(.mcfg-category-list)',{'gap':'8px','border-top':'0'})
block('.monitoring :global(.mcfg-category-row)',{'border-bottom':'0','padding':'0'})
block('.monitoring :global(.mcfg-category-filter)',{'position':'relative','isolation':'isolate','border-left':'0','border-radius':'14px'})
block('.monitoring :global(.mcfg-category-filter[aria-pressed="true"])',{'border-left-color':'transparent','background':'transparent','color':'var(--ui-accent, #0071e3)'})
block('.calculator :global(.procurement-calc-tabs)',{'gap':'4px','padding':'4px','background':'rgb(230 236 242 / 80%)','border-radius':'16px','border-bottom':'0','border':'1px solid rgb(255 255 255 / 65%)','box-shadow':'inset 0 1px 0 rgb(255 255 255 / 80%)','width':'fit-content','max-width':'100%'})
block('.calculator :global(.procurement-calc-tabs button)',{'border-radius':'14px','flex':'0 1 220px'})
block('.calculator :global(.procurement-calc-group)',{'border':'1px solid rgb(255 255 255 / 85%)','border-top':'1px solid rgb(255 255 255 / 85%)','border-radius':'22px','background':'var(--operations-surface)','box-shadow':'var(--operations-shadow)'})
block('.calculator :global(.procurement-calc-result)',{'border':'1px solid rgb(255 255 255 / 85%)','border-top':'1px solid rgb(255 255 255 / 85%)','border-radius':'22px','background':'var(--operations-surface)','box-shadow':'var(--operations-shadow)'})
block('.calculator :global(.procurement-calc-ceiling)',{'border':'1px solid rgb(255 255 255 / 85%)','border-top':'1px solid rgb(255 255 255 / 85%)','border-radius':'22px','background':'var(--operations-surface)','box-shadow':'var(--operations-shadow)'})
block('.calculator :global(.procurement-calc-copy)',{'transition':'background-color var(--ui-feedback), box-shadow var(--ui-feedback), transform var(--ui-press-motion)','box-shadow':'inset 0 1px 0 rgb(255 255 255 / 20%), 0 4px 12px rgb(0 113 227 / 18%)'})
block('.catalogue',{'background':'var(--operations-surface)','border-block':'0','border':'1px solid rgb(255 255 255 / 85%)','border-radius':'22px','box-shadow':'var(--operations-shadow)'})
block('.logisticsList',{'gap':'8px','padding':'2px'})
block('.workspace .logisticsItem',{'padding':'12px 4px','border':'1px solid rgb(60 60 67 / 8%)','border-bottom':'1px solid rgb(60 60 67 / 8%)','border-radius':'16px !important','background':'rgb(245 245 247 / 65%)','transition':'background-color var(--ui-feedback), border-color var(--ui-feedback), box-shadow var(--ui-feedback)','animation':'none !important'})
block('.workspace .logisticsItem[data-selected="true"]',{'background':'rgb(0 113 227 / 7%) !important','border-color':'rgb(0 113 227 / 24%)','box-shadow':'inset 0 1px 0 white, 0 2px 8px rgb(0 113 227 / 6%)'})
block('.shippingEditor',{'background':'var(--operations-surface)','border-top':'1px solid rgb(255 255 255 / 85%)','border':'1px solid rgb(255 255 255 / 85%)','border-radius':'22px','box-shadow':'var(--operations-shadow)'})
block('.shippingEditor :global(.logistics-adjust-panel)',{'border':'1px solid var(--operations-line)','border-top':'1px solid var(--operations-line)','border-radius':'16px','padding':'16px','background':'rgb(245 245 247 / 70%)'})
block('.logisticsResult',{'border-top':'1px solid rgb(255 255 255 / 85%)','border':'1px solid rgb(255 255 255 / 85%)','border-radius':'22px','background':'var(--operations-surface)','box-shadow':'var(--operations-shadow)'})
block('.intelTabs',{'border-bottom':'0','gap':'4px','padding':'4px','border-radius':'16px','background':'rgb(230 236 242 / 80%)','box-shadow':'inset 0 1px 0 rgb(255 255 255 / 80%)'})
block('.intelTab',{'border-radius':'14px'})
block('.intelTable',{'background':'var(--operations-surface)','border-block':'0','border':'1px solid rgb(255 255 255 / 85%)','border-radius':'22px','box-shadow':'var(--operations-shadow)','overflow':'hidden'})
block('.intelMobileList',{'gap':'12px','border-top':'0'})
block('.intelMobileRow',{'border':'1px solid rgb(255 255 255 / 85%)','border-bottom':'1px solid rgb(255 255 255 / 85%)','border-radius':'20px','background':'var(--operations-surface)','box-shadow':'var(--operations-shadow)'})
block('.intelDialog',{'border-radius':'22px','background':'var(--glass-fill-sheet, rgb(255 255 255 / 96%))','box-shadow':'var(--ui-shadow-raised)'})
block('.operationDialog',{'border-radius':'22px !important','background':'var(--glass-fill-sheet, rgb(255 255 255 / 96%)) !important','animation':'none !important','box-shadow':'var(--ui-shadow-raised) !important'})
block('.operationDialog :global(.inventory-order-inset)',{'border-radius':'16px'})
block('.intelDialog header',{'background':'var(--ui-glass, rgb(255 255 255 / 76%))','backdrop-filter':'blur(24px) saturate(160%)','-webkit-backdrop-filter':'blur(24px) saturate(160%)'})
text=text.replace('var(--ui-control-radius, 8px)','var(--ui-control-radius, 14px)')
text=text.replace('''    order: -1;
    padding: 0;''','''    order: -1;
    padding: 16px;''')
text=text.replace('''  .logisticsSelect > span:first-child {
    width: 56px;
    height: 56px;
    border-radius: 4px;''','''  .logisticsSelect > span:first-child {
    width: 56px;
    height: 56px;
    border-radius: 14px;''')
text=text.replace('''  .inventory :global(.inventory-order-card) {
    padding: 20px 16px;''','''  .inventory :global(.inventory-order-list) {
    gap: 12px;
    background: transparent;
    border: 0;
    box-shadow: none;
    overflow: visible;
  }
  .inventory :global(.inventory-order-card) {
    border: 1px solid rgb(255 255 255 / 85%);
    border-radius: 20px !important;
    background: var(--operations-surface);
    box-shadow: var(--operations-shadow) !important;
    padding: 20px 16px;''')
text=text.replace('''  .calculator :global(.procurement-calc-tabs button) {
    flex: 1;''','''  .calculator :global(.procurement-calc-tabs) {
    width: 100%;
  }
  .calculator :global(.procurement-calc-tabs button) {
    flex: 1;''')
extra='''
.categoryIndicator {
  position: absolute;
  inset: 0;
  border: 1px solid rgb(0 113 227 / 14%);
  border-radius: 14px;
  background: rgb(0 113 227 / 8%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 90%);
  pointer-events: none;
}
.calculator :global(.procurement-calc-copy[data-copied="true"]) {
  background: #16743c;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 20%), 0 4px 12px rgb(22 116 60 / 15%);
}
.workspace[data-keyboard-motion="true"] button,
.workspace[data-keyboard-motion="true"] :global(.mcfg-switch)::before,
.workspace[data-keyboard-motion="true"] .logisticsItem,
.workspace button:focus-visible:active {
  transition-duration: 0ms;
  transform: none;
}
'''
text=text.replace('@media (hover: hover) and (pointer: fine) {',extra+'\n@media (hover: hover) and (pointer: fine) {',1)
file.write_text(text,encoding='utf-8')
file=Path('apps/web/src/styles/monitoring-config.css')
text=file.read_text(encoding='utf-8').replace('--mcfg-accent: #0067d6;','--mcfg-accent: var(--ui-accent, #0071e3);').replace('--mcfg-secondary: #5e5e65;','--mcfg-secondary: var(--glass-ink-secondary, #58616c);').replace('border-radius: 24px;','border-radius: 22px;').replace('animation: mcfg-materialize 160ms ease-out;','animation: none;').replace('transition: transform 160ms ease;','transition: none;').replace('  transform: translateX(22px);','  /* Motion owns the thumb transform and carries velocity on reversal. */').replace('transition: background-color 140ms ease;','transition: background-color var(--ui-feedback, 180ms ease);')
file.write_text(text,encoding='utf-8')
