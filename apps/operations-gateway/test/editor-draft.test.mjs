import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitPublishingText} from '../client/editor-draft.mjs';
test('first line becomes title; remaining paragraphs stay in the body',()=>{
  assert.deepEqual(splitPublishingText('标题\r\n第一段\r\n\r\n第二段'),{title:'标题',body:'第一段\n\n第二段'});
  assert.deepEqual(splitPublishingText('\uFEFF标题\n正文'),{title:'标题',body:'正文'});
  assert.deepEqual(splitPublishingText('只有标题'),{title:'只有标题',body:''});
  assert.deepEqual(splitPublishingText(''),{title:'',body:''});
  assert.deepEqual(splitPublishingText('\n正文'),{title:'',body:'正文'});
  assert.equal(splitPublishingText('长'.repeat(100)+'\n正文').title.length,100);
});
